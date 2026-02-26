#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Configuration - Choose your LLM provider
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'huggingface'; // 'openai' or 'huggingface'
const API_KEY = process.env.LLM_API_KEY;

// Validate API key
if (!API_KEY) {
  console.error('Error: LLM_API_KEY environment variable is not set');
  console.error('Please set your API key:');
  console.error('  For Hugging Face: LLM_API_KEY=your_hf_token node chat-server.js');
  console.error('  For OpenAI: LLM_API_KEY=your_openai_key LLM_PROVIDER=openai node chat-server.js');
  process.exit(1);
}

const setupConfigPath = path.join(__dirname, 'chat-setup-config.json');
let setupConfig;
try {
  setupConfig = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8'));
} catch (error) {
  console.error(`Error loading shared setup config at ${setupConfigPath}:`, error.message);
  process.exit(1);
}

const familyConfigs = setupConfig.families || {};
const guideConfigs = Object.entries(setupConfig.guides || {}).reduce((acc, [guideKey, guide]) => {
  const relativeDir = String(guide.relativeDir || '').replace(/\\/g, '/').split('/').filter(Boolean);
  acc[guideKey] = {
    name: guide.name,
    family: guide.family,
    dir: path.join(__dirname, ...relativeDir)
  };
  return acc;
}, {});

const resolveDefaultGuideForFamily = (familyKey) => {
  const normalizedFamily = String(familyKey || '').trim().toLowerCase();
  const familyConfig = familyConfigs[normalizedFamily];
  const familyDefault = familyConfig && familyConfig.defaultGuide;
  if (familyDefault && guideConfigs[familyDefault]) {
    return familyDefault;
  }

  const firstForFamily = Object.entries(guideConfigs)
    .find(([, guide]) => guide.family === normalizedFamily)?.[0];
  if (firstForFamily) {
    return firstForFamily;
  }

  return Object.keys(guideConfigs)[0];
};

const defaultGuide = resolveDefaultGuideForFamily('cpap');
const manualCache = new Map();
let airsenseErrorActionsCache = null;
const telemetryStoreMode = String(process.env.TELEMETRY_STORE || 'file').trim().toLowerCase();
const telemetryUsePostgres = telemetryStoreMode === 'postgres';
const telemetryDatabaseUrl = process.env.DATABASE_URL;
const telemetryFallbackToFile = String(process.env.TELEMETRY_FALLBACK_FILE || 'true').trim().toLowerCase() !== 'false';
let telemetryPgPool = null;
let telemetryLastWriteStatus = {
  at: null,
  mode: telemetryUsePostgres ? 'postgres' : 'file',
  ok: null,
  fallbackUsed: false,
  error: null
};
const telemetryDir = path.join(__dirname, 'data');
const telemetryFilePath = path.join(telemetryDir, 'telemetry-events.ndjson');
const participantTelemetryDir = path.join(telemetryDir, 'participants');

const excludedHtmlFiles = new Set(['chat.html', 'chat-setup.html', 'search.html']);

const baseDir = guideConfigs[defaultGuide].dir;

const app = express();
app.use(express.json());
app.use('/api/telemetry', express.text({ type: '*/*' }));
app.use(express.static(baseDir));
app.use('/CPAP-devices', express.static(path.join(__dirname, 'CPAP-devices')));
app.use('/images', express.static(path.join(__dirname, 'images')));

const ensureTelemetryStorage = () => {
  if (!fs.existsSync(telemetryDir)) {
    fs.mkdirSync(telemetryDir, { recursive: true });
  }
  if (!fs.existsSync(telemetryFilePath)) {
    fs.writeFileSync(telemetryFilePath, '');
  }
  if (!fs.existsSync(participantTelemetryDir)) {
    fs.mkdirSync(participantTelemetryDir, { recursive: true });
  }
};

const sanitizeParticipantId = (participantId) => String(participantId || '')
  .trim()
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .slice(0, 80);

const getParticipantTelemetryPath = (participantId) => {
  const safeId = sanitizeParticipantId(participantId);
  if (!safeId) return null;
  return path.join(participantTelemetryDir, `${safeId}.ndjson`);
};

const csvEscape = (value) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const telemetryCsvColumns = [
  'received_at',
  'timestamp',
  'session_id',
  'participant_id',
  'event_type',
  'task_id',
  'task_label',
  'task_status',
  'question_id',
  'page_path',
  'page_title',
  'guide',
  'family',
  'query',
  'result_count',
  'target_href',
  'link_text',
  'chat_message',
  'response_message',
  'response_length',
  'duration_ms',
  'referrer'
];

const telemetrySqlColumns = [
  'received_at',
  'timestamp',
  'session_id',
  'participant_id',
  'event_type',
  'task_id',
  'task_label',
  'task_status',
  'question_id',
  'page_path',
  'page_title',
  'guide',
  'family',
  'query',
  'result_count',
  'target_href',
  'link_text',
  'chat_message',
  'response_message',
  'response_length',
  'duration_ms',
  'referrer'
];

const projectTelemetryRecord = (record) => ({
  received_at: record.received_at || '',
  timestamp: record.timestamp || '',
  session_id: record.session_id || '',
  participant_id: record.participant_id || '',
  event_type: record.event_type || '',
  task_id: record.task_id || '',
  task_label: record.task_label || '',
  task_status: record.task_status || '',
  question_id: record.question_id || '',
  page_path: record.page_path || '',
  page_title: record.page_title || '',
  guide: record.guide || '',
  family: record.family || '',
  query: record.query || '',
  result_count: record.result_count ?? '',
  target_href: record.target_href || '',
  link_text: record.link_text || '',
  chat_message: record.chat_message || '',
  response_message: record.response_message || '',
  response_length: record.response_length ?? '',
  duration_ms: record.duration_ms ?? '',
  referrer: record.referrer || ''
});

const readTelemetryRecordsFromNdjson = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const records = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      records.push(projectTelemetryRecord(parsed));
    } catch {
      // ignore malformed lines
    }
  }

  return records;
};

const buildTelemetryCsv = (records) => {
  const header = telemetryCsvColumns.join(',');
  const rows = records.map((record) => telemetryCsvColumns.map((column) => csvEscape(record[column])).join(','));
  return [header, ...rows].join('\n');
};

const parseDateSafely = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseIntegerSafely = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const getTelemetryPgPool = () => {
  if (!telemetryUsePostgres) return null;
  if (telemetryPgPool) return telemetryPgPool;

  if (!telemetryDatabaseUrl) {
    throw new Error('TELEMETRY_STORE=postgres requires DATABASE_URL');
  }

  const { Pool } = require('pg');
  telemetryPgPool = new Pool({
    connectionString: telemetryDatabaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  telemetryPgPool.on('error', (error) => {
    console.error('Postgres pool error:', error);
  });

  return telemetryPgPool;
};

const normalizeTelemetryRecordForSql = (record) => {
  const projected = projectTelemetryRecord(record);
  return {
    ...projected,
    received_at: parseDateSafely(record.received_at || projected.received_at || new Date().toISOString()),
    timestamp: parseDateSafely(record.timestamp || projected.timestamp),
    result_count: parseIntegerSafely(projected.result_count),
    response_length: parseIntegerSafely(projected.response_length),
    duration_ms: parseIntegerSafely(projected.duration_ms)
  };
};

const insertTelemetryRecordPostgres = async (record) => {
  const pool = getTelemetryPgPool();
  const normalized = normalizeTelemetryRecordForSql(record);

  const placeholders = telemetrySqlColumns.map((_, index) => `$${index + 1}`).join(', ');
  const queryText = `INSERT INTO telemetry_events (${telemetrySqlColumns.join(', ')}) VALUES (${placeholders})`;
  const values = telemetrySqlColumns.map((column) => normalized[column]);

  await pool.query(queryText, values);
};

const readTelemetryRecordsPostgres = async (participantId) => {
  const pool = getTelemetryPgPool();
  const baseQuery = `
    SELECT ${telemetrySqlColumns.join(', ')}
    FROM telemetry_events
  `;

  const hasParticipantFilter = Boolean(String(participantId || '').trim());
  const queryText = hasParticipantFilter
    ? `${baseQuery} WHERE participant_id = $1 ORDER BY received_at ASC`
    : `${baseQuery} ORDER BY received_at ASC`;
  const queryValues = hasParticipantFilter ? [String(participantId).trim()] : [];

  const result = await pool.query(queryText, queryValues);
  return result.rows.map(projectTelemetryRecord);
};

const writeTelemetryRecordToFiles = (record) => {
  ensureTelemetryStorage();
  fs.appendFileSync(telemetryFilePath, `${JSON.stringify(record)}\n`, 'utf8');

  const participantLogPath = getParticipantTelemetryPath(record.participant_id);
  if (participantLogPath) {
    fs.appendFileSync(participantLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  }
};

const storeTelemetryRecord = async (record) => {
  if (telemetryUsePostgres) {
    try {
      await insertTelemetryRecordPostgres(record);
      telemetryLastWriteStatus = {
        at: new Date().toISOString(),
        mode: 'postgres',
        ok: true,
        fallbackUsed: false,
        error: null
      };
    } catch (error) {
      if (!telemetryFallbackToFile) {
        telemetryLastWriteStatus = {
          at: new Date().toISOString(),
          mode: 'postgres',
          ok: false,
          fallbackUsed: false,
          error: String(error.message || error)
        };
        throw error;
      }
      console.error('Postgres telemetry write failed, falling back to file store:', error.message);
      writeTelemetryRecordToFiles(record);
      telemetryLastWriteStatus = {
        at: new Date().toISOString(),
        mode: 'postgres',
        ok: false,
        fallbackUsed: true,
        error: String(error.message || error)
      };
    }
    return;
  }

  writeTelemetryRecordToFiles(record);
  telemetryLastWriteStatus = {
    at: new Date().toISOString(),
    mode: 'file',
    ok: true,
    fallbackUsed: false,
    error: null
  };
};

const readTelemetryRecordsForExport = async (participantId) => {
  if (telemetryUsePostgres) {
    try {
      const postgresRecords = await readTelemetryRecordsPostgres(participantId);
      if (postgresRecords.length > 0 || !telemetryFallbackToFile) {
        return postgresRecords;
      }

      const sourcePath = participantId
        ? getParticipantTelemetryPath(participantId)
        : telemetryFilePath;
      const fileRecords = readTelemetryRecordsFromNdjson(sourcePath);
      if (fileRecords.length > 0) {
        console.warn('Telemetry export served from file fallback because postgres returned no records.');
      }
      return fileRecords;
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      const sourcePath = participantId
        ? getParticipantTelemetryPath(participantId)
        : telemetryFilePath;
      console.error('Telemetry export postgres read failed, using file fallback:', error.message);
      return readTelemetryRecordsFromNdjson(sourcePath);
    }
  }

  ensureTelemetryStorage();
  const sourcePath = participantId
    ? getParticipantTelemetryPath(participantId)
    : telemetryFilePath;
  return readTelemetryRecordsFromNdjson(sourcePath);
};

const withTelemetryCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const buildManualContent = (searchIndex) => searchIndex.pages
  .map(page => `# ${page.title}\n\n${page.description}\n\n${page.content}`)
  .join('\n\n---\n\n');

const listGuideHtmlFiles = (guideDir) => fs.readdirSync(guideDir)
  .filter((name) => name.toLowerCase().endsWith('.html'))
  .filter((name) => !excludedHtmlFiles.has(name.toLowerCase()))
  .map((name) => path.join(guideDir, name));

const getLatestHtmlMtimeMs = (guideDir) => {
  const htmlFiles = listGuideHtmlFiles(guideDir);
  return htmlFiles.reduce((latest, filePath) => {
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    return mtimeMs > latest ? mtimeMs : latest;
  }, 0);
};

const ensureFreshSearchIndex = (guideKey, guide) => {
  const searchIndexPath = path.join(guide.dir, 'search-index.json');
  const latestHtmlMtimeMs = getLatestHtmlMtimeMs(guide.dir);

  let indexMtimeMs = 0;
  if (fs.existsSync(searchIndexPath)) {
    indexMtimeMs = fs.statSync(searchIndexPath).mtimeMs;
  }

  if (!fs.existsSync(searchIndexPath) || latestHtmlMtimeMs > indexMtimeMs) {
    const buildScriptPath = path.join(__dirname, 'build-search-index.js');
    const relativeGuideDir = path.relative(__dirname, guide.dir);
    execFileSync(process.execPath, [buildScriptPath, relativeGuideDir], {
      stdio: 'ignore'
    });
    console.log(`Rebuilt search index for ${guideKey} because source pages changed.`);
  }

  return {
    searchIndexPath,
    indexMtimeMs: fs.statSync(searchIndexPath).mtimeMs
  };
};

const loadManualContent = (guideKey) => {
  const guide = guideConfigs[guideKey] || guideConfigs[defaultGuide];
  if (!guide) {
    throw new Error(`Unknown guide: ${guideKey}`);
  }

  const { searchIndexPath, indexMtimeMs } = ensureFreshSearchIndex(guideKey, guide);
  const cachedEntry = manualCache.get(guideKey);
  if (cachedEntry && cachedEntry.indexMtimeMs === indexMtimeMs) {
    return cachedEntry;
  }

  const searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8'));
  const manualContent = buildManualContent(searchIndex);

  const cached = {
    manualContent,
    guideName: guide.name,
    indexMtimeMs
  };
  manualCache.set(guideKey, cached);
  return cached;
};

const normalizeGuideKeys = (primaryGuide, guideList, family) => {
  const raw = Array.isArray(guideList)
    ? guideList
    : typeof guideList === 'string'
      ? guideList.split(',')
      : [];

  const familyKey = String(family || '').trim().toLowerCase();
  const familyGuideKeys = familyKey
    ? Object.entries(guideConfigs)
      .filter(([, config]) => config.family === familyKey)
      .map(([guideKey]) => guideKey)
    : Object.keys(guideConfigs);

  const defaultForFamily = resolveDefaultGuideForFamily(familyKey) || defaultGuide;

  const fallback = primaryGuide ? [primaryGuide] : [defaultForFamily];
  const keys = (raw.length ? raw : fallback)
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => Boolean(guideConfigs[item]))
    .filter((item) => familyGuideKeys.includes(item));

  if (!keys.length) {
    return [defaultForFamily];
  }

  return [...new Set(keys)];
};

const loadManualBundle = (guideKeys) => {
  const docs = guideKeys.map(loadManualContent);
  return {
    guideName: docs.map((doc) => doc.guideName).join(' + '),
    manualContent: docs
      .map((doc) => `## Guide: ${doc.guideName}\n\n${doc.manualContent}`)
      .join('\n\n====\n\n')
  };
};

const stripHtmlToText = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const getAirsenseErrorActions = () => {
  const airsenseGuide = guideConfigs['airsense-10'];
  if (!airsenseGuide) {
    return { specificByCode: {}, generic0xx: null };
  }

  const troubleshootingPath = path.join(airsenseGuide.dir, 'troubleshooting.html');
  if (!fs.existsSync(troubleshootingPath)) {
    return { specificByCode: {}, generic0xx: null };
  }

  const mtimeMs = fs.statSync(troubleshootingPath).mtimeMs;
  if (airsenseErrorActionsCache && airsenseErrorActionsCache.mtimeMs === mtimeMs) {
    return airsenseErrorActionsCache.actions;
  }

  const html = fs.readFileSync(troubleshootingPath, 'utf8');
  const rowPattern = /<strong>([^<]*(?:Error\s*\d{3}|0XX)[^<]*)<\/strong>[\s\S]*?<table[\s\S]*?<\/table>/gi;
  const specificByCode = {};
  let generic0xx = null;

  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const heading = stripHtmlToText(rowMatch[1]);
    const block = rowMatch[0];
    const tdMatches = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((match) => stripHtmlToText(match[1]));

    const solutions = tdMatches
      .filter((_, index) => index % 2 === 1)
      .filter(Boolean);
    const solutionText = [...new Set(solutions)].join(' ');

    if (!solutionText) {
      continue;
    }

    const specificCodeMatch = heading.match(/Error\s*(\d{3})\b/i);
    if (specificCodeMatch) {
      specificByCode[specificCodeMatch[1]] = solutionText;
      continue;
    }

    if (/0XX/i.test(heading)) {
      generic0xx = solutionText;
    }
  }

  const actions = { specificByCode, generic0xx };
  airsenseErrorActionsCache = { mtimeMs, actions };
  return actions;
};

const parseExplicitErrorCode = (message) => {
  const text = String(message || '');
  const patterns = [
    /\berror\s*[-: ]?\s*(\d{3})\b/i,
    /\bsystem\s*fault\s*[-: ]?\s*(\d{3})\b/i,
    /\bfault\s*[-: ]?\s*(\d{3})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  const hasFaultIntent = /\bsystem\s*fault\b|\bfault\b/i.test(text);
  if (hasFaultIntent) {
    const fallbackMatch = text.match(/\b(0\d{2})\b/);
    if (fallbackMatch) {
      return fallbackMatch[1];
    }
  }

  return null;
};

const getDeterministicErrorCodeResponse = (message, guideKeys) => {
  const errorCode = parseExplicitErrorCode(message);
  if (!errorCode) return null;

  const isAirsenseGuide = Array.isArray(guideKeys) && guideKeys.includes('airsense-10');
  if (!isAirsenseGuide) return null;

  const { specificByCode, generic0xx } = getAirsenseErrorActions();

  if (specificByCode[errorCode]) {
    return 'For “System fault, refer to user guide, Error ' + errorCode + '”, follow the Troubleshooting action: ' + specificByCode[errorCode];
  }

  if (/^0\d{2}$/.test(errorCode) && generic0xx) {
    return 'For “System fault, refer to user guide, Error ' + errorCode + '”, this is treated as an Error 0XX case. ' + generic0xx;
  }

  return null;
};

// Warm cache for the default guide
try {
  loadManualContent(defaultGuide);
  console.log('Loaded manual content from search-index.json');
} catch (error) {
  console.error('Error loading search index:', error.message);
  process.exit(1);
}

/**
 * Call Hugging Face Inference API
 */
async function callHuggingFace(userMessage, manualContent, guideName) {
  const systemPrompt = `You are a helpful assistant for the ${guideName} user manual. 
Answer questions based on the following manual content. Be concise, helpful, and always cite which section of the manual you're referring to.
If the manual doesn't contain information about the question, say so clearly.

Manual Content:
${manualContent}`;

  const hfChatModel = process.env.HF_CHAT_MODEL || 'HuggingFaceH4/zephyr-7b-beta';
  const hfTextModel = process.env.HF_TEXT_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3';
  const hfBaseUrl = process.env.HF_BASE_URL || 'https://router.huggingface.co/hf';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  try {
    const response = await fetch(`${hfBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: hfChatModel,
        messages,
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Hugging Face API error';
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && typeof errorJson.error === 'object') {
          errorMessage = JSON.stringify(errorJson.error);
        } else {
          errorMessage = errorJson.error || errorJson.message || JSON.stringify(errorJson);
        }
      } catch {
        if (errorText) errorMessage = errorText;
      }
      if (response.status === 404) {
        return await callHuggingFaceChatRetry(systemPrompt, userMessage, hfChatModel, hfTextModel, hfBaseUrl);
      }
      if (errorMessage.includes('not a chat model') || errorMessage.includes('model_not_supported')) {
        return await callHuggingFaceCompletion(systemPrompt, userMessage, hfTextModel, hfBaseUrl);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    if (error.message.includes('not a chat model') || error.message.includes('model_not_supported')) {
      return await callHuggingFaceCompletion(systemPrompt, userMessage, hfTextModel, hfBaseUrl);
    }
    throw new Error(`Hugging Face API error: ${error.message}`);
  }
}

async function callHuggingFaceChatRetry(systemPrompt, userMessage, chatModel, textModel, hfBaseUrl) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  const response = await fetch(`${hfBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chatModel,
      messages,
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Hugging Face API error';
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error && typeof errorJson.error === 'object') {
        errorMessage = JSON.stringify(errorJson.error);
      } else {
        errorMessage = errorJson.error || errorJson.message || JSON.stringify(errorJson);
      }
    } catch {
      if (errorText) errorMessage = errorText;
    }
    if (errorMessage.includes('not a chat model') || errorMessage.includes('model_not_supported')) {
      return await callHuggingFaceCompletion(systemPrompt, userMessage, textModel, hfBaseUrl);
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callHuggingFaceCompletion(systemPrompt, userMessage, model, hfBaseUrl = 'https://router.huggingface.co/hf') {
  const prompt = `${systemPrompt}\n\nUser question: ${userMessage}\n\nAssistant answer:`;

  const response = await fetch(`${hfBaseUrl}/v1/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Hugging Face API error';
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorJson.message || JSON.stringify(errorJson);
    } catch {
      if (errorText) errorMessage = errorText;
    }
    if (response.status === 404) {
      return await callHuggingFaceCompletionFallback(prompt, model, hfBaseUrl);
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.choices?.[0]?.text?.trim() || data.choices?.[0]?.message?.content || '';
}

async function callHuggingFaceCompletionFallback(prompt, model, hfBaseUrl) {
  const response = await fetch(`${hfBaseUrl}/v1/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Hugging Face API error';
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorJson.message || JSON.stringify(errorJson);
    } catch {
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.choices?.[0]?.text?.trim() || data.choices?.[0]?.message?.content || '';
}

/**
 * Call OpenAI API
 */
async function callOpenAI(userMessage, manualContent, guideName) {
  const systemPrompt = `You are a helpful assistant for the ${guideName} user manual. 
Answer questions based on the following manual content. Be concise, helpful, and always cite which section of the manual you're referring to.
If the manual doesn't contain information about the question, say so clearly.

Manual Content:
${manualContent}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message || 'OpenAI API error');
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

/**
 * Main chat endpoint
 */
app.post('/api/chat', async (req, res) => {
  const { message, guide, guides, family } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    console.log(`[${new Date().toISOString()}] User: ${message}`);

    const primaryGuide = (guide || defaultGuide).toLowerCase();
    const familyKey = String(family || '').trim().toLowerCase();
    const guideKeys = normalizeGuideKeys(primaryGuide, guides, familyKey);

    const deterministicResponse = getDeterministicErrorCodeResponse(message, guideKeys);
    if (deterministicResponse) {
      console.log(`[${new Date().toISOString()}] Guides: ${guideKeys.join(', ')}`);
      console.log(`[${new Date().toISOString()}] Assistant: ${deterministicResponse.substring(0, 100)}...`);
      return res.json({ response: deterministicResponse });
    }

    const { manualContent, guideName } = loadManualBundle(guideKeys);

    let response;
    if (LLM_PROVIDER === 'openai') {
      response = await callOpenAI(message, manualContent, guideName);
    } else {
      response = await callHuggingFace(message, manualContent, guideName);
    }

    console.log(`[${new Date().toISOString()}] Guides: ${guideKeys.join(', ')}`);
    console.log(`[${new Date().toISOString()}] Assistant: ${response.substring(0, 100)}...`);

    res.json({ response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to generate response',
      details: process.env.DEBUG ? error.toString() : undefined
    });
  }
});

app.options('/api/telemetry', (req, res) => {
  withTelemetryCors(res);
  res.status(204).end();
});

app.post('/api/telemetry', async (req, res) => {
  withTelemetryCors(res);

  try {
    let payload = null;
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      payload = req.body;
    } else if (typeof req.body === 'string' && req.body.trim()) {
      try {
        const parsed = JSON.parse(req.body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed;
        }
      } catch {
        payload = null;
      }
    }

    if (!payload || !payload.event_type) {
      return res.status(400).json({ error: 'event_type is required' });
    }

    ensureTelemetryStorage();

    const record = {
      ...payload,
      received_at: new Date().toISOString()
    };

    await storeTelemetryRecord(record);

    res.status(204).end();
  } catch (error) {
    console.error('Telemetry write error:', error);
    res.status(500).json({ error: 'Failed to store telemetry event' });
  }
});

app.get('/api/telemetry/export.csv', async (req, res) => {
  withTelemetryCors(res);

  try {
    const participantId = String(req.query.participant_id || '').trim();
    const records = await readTelemetryRecordsForExport(participantId);
    const csv = buildTelemetryCsv(records);

    const filename = participantId
      ? `telemetry-${sanitizeParticipantId(participantId)}.csv`
      : 'telemetry-events.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Telemetry export error:', error);
    res.status(500).json({ error: 'Failed to export telemetry events' });
  }
});

app.get('/api/telemetry/export/participant/:participantId.csv', async (req, res) => {
  withTelemetryCors(res);

  try {
    const participantId = String(req.params.participantId || '').trim();
    const records = await readTelemetryRecordsForExport(participantId);
    const csv = buildTelemetryCsv(records);
    const safeId = sanitizeParticipantId(participantId) || 'participant';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="telemetry-${safeId}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Participant telemetry export error:', error);
    res.status(500).json({ error: 'Failed to export participant telemetry events' });
  }
});

app.get('/api/setup-config', (req, res) => {
  const requestedFamily = String(req.query.family || '').trim().toLowerCase();
  const resolvedFamily = requestedFamily && familyConfigs[requestedFamily]
    ? requestedFamily
    : (familyConfigs.cpap ? 'cpap' : Object.keys(familyConfigs)[0]);

  if (!resolvedFamily || !familyConfigs[resolvedFamily]) {
    return res.status(500).json({ error: 'No family configuration available' });
  }

  const familyConfig = familyConfigs[resolvedFamily];
  const allowGuide = (value) => {
    const key = String(value || '').trim().toLowerCase();
    return Boolean(guideConfigs[key] && guideConfigs[key].family === resolvedFamily);
  };
  const filterOptions = (items) => (Array.isArray(items) ? items.filter((item) => allowGuide(item.value)) : []);

  res.json({
    family: resolvedFamily,
    label: familyConfig.label || resolvedFamily.toUpperCase(),
    backHref: familyConfig.backHref || '/index.html',
    defaultGuide: allowGuide(familyConfig.defaultGuide)
      ? familyConfig.defaultGuide
      : resolveDefaultGuideForFamily(resolvedFamily),
    devices: filterOptions(familyConfig.devices),
    masks: filterOptions(familyConfig.masks),
    accessories: filterOptions(familyConfig.accessories)
  });
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    provider: LLM_PROVIDER,
    hasApiKey: !!API_KEY
  });
});

app.get('/api/telemetry/status', async (req, res) => {
  const base = {
    mode: telemetryUsePostgres ? 'postgres' : 'file',
    fallbackToFile: telemetryFallbackToFile,
    hasDatabaseUrl: Boolean(telemetryDatabaseUrl),
    lastWrite: telemetryLastWriteStatus
  };

  if (!telemetryUsePostgres) {
    return res.json({ ...base, dbReachable: null });
  }

  try {
    const pool = getTelemetryPgPool();
    await pool.query('SELECT 1');
    return res.json({ ...base, dbReachable: true });
  } catch (error) {
    return res.status(503).json({
      ...base,
      dbReachable: false,
      error: String(error.message || error)
    });
  }
});

/**
 * Start server
 */
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`\n✓ Chat server running on http://localhost:${PORT}`);
  console.log(`✓ Provider: ${LLM_PROVIDER}`);
  const { manualContent } = loadManualContent(defaultGuide);
  console.log(`✓ Manual content loaded: ${Math.round(manualContent.length / 1024)}KB`);
  console.log('\nOpen http://localhost:3000/chat.html in your browser to start chatting!');
  console.log('To access from a phone on the same Wi-Fi, use http://<your-pc-ip>:' + PORT + '/chat.html\n');
});