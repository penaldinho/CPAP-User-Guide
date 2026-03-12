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
    dir: path.join(__dirname, ...relativeDir),
    relativeDir: relativeDir.join('/')
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
const physicalTrialFilePath = path.join(telemetryDir, 'physical-trial-events.ndjson');
const observerNotesFilePath = path.join(telemetryDir, 'observer-notes.ndjson');
const participantAllocationFilePath = path.join(telemetryDir, 'participant-allocation.json');
const participantAllocationPassword = process.env.PARTICIPANT_ALLOCATION_PASSWORD || 'edfred';
const participantAllocationResetPassword = process.env.PARTICIPANT_ALLOCATION_RESET_PASSWORD || participantAllocationPassword;

const excludedHtmlFiles = new Set(['chat.html', 'chat-setup.html', 'search.html']);

const baseDir = guideConfigs[defaultGuide].dir;

const app = express();
app.use(express.json());

const isParticipantAllocationProtectedPath = (requestPath) => {
  const normalizedPath = String(requestPath || '').trim();
  if (!normalizedPath) return false;

  if (normalizedPath === '/research/participant-allocation.html') {
    return true;
  }

  if (normalizedPath === '/api/participant-allocation' || normalizedPath.startsWith('/api/participant-allocation/')) {
    return true;
  }

  return false;
};

const parseBasicAuthHeader = (authorizationHeader) => {
  const value = String(authorizationHeader || '').trim();
  if (!value.toLowerCase().startsWith('basic ')) {
    return null;
  }

  const encoded = value.slice(6).trim();
  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const delimiterIndex = decoded.indexOf(':');
    if (delimiterIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, delimiterIndex),
      password: decoded.slice(delimiterIndex + 1)
    };
  } catch {
    return null;
  }
};

app.use((req, res, next) => {
  if (!isParticipantAllocationProtectedPath(req.path)) {
    return next();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Reset-Password');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const credentials = parseBasicAuthHeader(req.headers.authorization);
  const providedPassword = String(credentials && credentials.password || '');

  if (providedPassword === participantAllocationPassword) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Participant Allocation", charset="UTF-8"');
  return res.status(401).send('Authentication required');
});

app.use(express.static(baseDir));
app.use('/CPAP-devices', express.static(path.join(__dirname, 'CPAP-devices')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/research', express.static(path.join(__dirname, 'research')));

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
  if (!fs.existsSync(physicalTrialFilePath)) {
    fs.writeFileSync(physicalTrialFilePath, '');
  }
  if (!fs.existsSync(observerNotesFilePath)) {
    fs.writeFileSync(observerNotesFilePath, '');
  }
  if (!fs.existsSync(participantAllocationFilePath)) {
    fs.writeFileSync(participantAllocationFilePath, JSON.stringify(defaultParticipantAllocationRecords, null, 2), 'utf8');
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
  'video_provider',
  'video_id',
  'video_title',
  'video_url',
  'video_action',
  'video_current_time_ms',
  'video_duration_ms',
  'video_percent',
  'task_action_index',
  'duration_ms',
  'trial_mode',
  'referrer',
  'task_instance_seq',
  'task_instance_started_at',
  'task_instance_ended_at',
  'task_total_duration_ms',
  'task_elapsed_ms_at_event',
  'task_page_dwell_ms'
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
  'video_provider',
  'video_id',
  'video_title',
  'video_url',
  'video_action',
  'video_current_time_ms',
  'video_duration_ms',
  'video_percent',
  'task_action_index',
  'duration_ms',
  'trial_mode',
  'referrer'
];

const physicalTrialCsvColumns = [
  'received_at',
  'timestamp',
  'session_id',
  'participant_id',
  'task_id',
  'task_label',
  'event_type',
  'observer_id',
  'manual_page',
  'duration_ms',
  'notes',
  'source',
  'trial_mode'
];

const physicalTrialSqlColumns = [
  'received_at',
  'timestamp',
  'session_id',
  'participant_id',
  'task_id',
  'task_label',
  'event_type',
  'observer_id',
  'manual_page',
  'duration_ms',
  'notes',
  'source',
  'trial_mode'
];

const observerNotesSqlColumns = [
  'received_at',
  'timestamp',
  'session_id',
  'participant_id',
  'task_id',
  'task_label',
  'manual_page',
  'scenario_score',
  'task_length_ms',
  'help_instances_count',
  'error_severity',
  'error_text',
  'notes',
  'action_type',
  'source',
  'trial_mode'
];

const defaultParticipantAllocationRecords = [
  { participant_id: 'TEST', allocation_group: 'digital' },
  { participant_id: 'P01', allocation_group: 'digital' },
  { participant_id: 'P02', allocation_group: 'physical' },
  { participant_id: 'P03', allocation_group: 'physical' },
  { participant_id: 'P04', allocation_group: 'digital' },
  { participant_id: 'P05', allocation_group: 'digital' },
  { participant_id: 'P06', allocation_group: 'physical' },
  { participant_id: 'P07', allocation_group: 'digital' },
  { participant_id: 'P08', allocation_group: 'physical' },
  { participant_id: 'P09', allocation_group: 'physical' },
  { participant_id: 'P10', allocation_group: 'digital' },
  { participant_id: 'P11', allocation_group: 'physical' },
  { participant_id: 'P12', allocation_group: 'digital' },
  { participant_id: 'P13', allocation_group: 'digital' },
  { participant_id: 'P14', allocation_group: 'physical' },
  { participant_id: 'P15', allocation_group: 'physical' },
  { participant_id: 'P16', allocation_group: 'digital' },
  { participant_id: 'P17', allocation_group: 'physical' },
  { participant_id: 'P18', allocation_group: 'digital' },
  { participant_id: 'P19', allocation_group: 'digital' },
  { participant_id: 'P20', allocation_group: 'physical' },
  { participant_id: 'P21', allocation_group: 'digital' },
  { participant_id: 'P22', allocation_group: 'physical' },
  { participant_id: 'P23', allocation_group: 'digital' },
  { participant_id: 'P24', allocation_group: 'physical' },
  { participant_id: 'P25', allocation_group: 'physical' },
  { participant_id: 'P26', allocation_group: 'digital' },
  { participant_id: 'P27', allocation_group: 'physical' },
  { participant_id: 'P28', allocation_group: 'digital' },
  { participant_id: 'P29', allocation_group: 'physical' },
  { participant_id: 'P30', allocation_group: 'digital' }
];

const defaultParticipantAllocationById = Object.fromEntries(
  defaultParticipantAllocationRecords.map((row) => [row.participant_id, row.allocation_group])
);

const participantIdSortValue = (participantId) => {
  const normalizedId = String(participantId || '').trim().toUpperCase();
  if (normalizedId === 'TEST') {
    return 0;
  }

  const match = /^P(\d+)$/i.exec(normalizedId);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

const normalizeParticipantAllocationRecord = (record) => {
  const participantId = String(record && record.participant_id || '').trim().toUpperCase();
  const fallbackGroup = defaultParticipantAllocationById[participantId];
  const allocationGroupRaw = String(record && record.allocation_group || fallbackGroup || '').trim().toLowerCase();
  const allocationGroup = allocationGroupRaw === 'physical' ? 'physical' : 'digital';
  const sessionOpenedAtDate = parseDateSafely(record && record.session_opened_at);
  const sessionClosedAtDate = parseDateSafely(record && record.session_closed_at);
  const sessionStatusRaw = String(record && record.session_status || '').trim().toLowerCase();
  let sessionStatus = ['not_started', 'in_progress', 'closed'].includes(sessionStatusRaw)
    ? sessionStatusRaw
    : (sessionClosedAtDate ? 'closed' : (sessionOpenedAtDate ? 'in_progress' : 'not_started'));
  const completed = parseBooleanSafely(record && record.completed) === true;
  const completedAtDate = parseDateSafely(record && record.completed_at);
  const createdAtDate = parseDateSafely(record && record.created_at);
  const updatedAtDate = parseDateSafely(record && record.updated_at);

  const sessionOpenedAt = sessionOpenedAtDate ? sessionOpenedAtDate.toISOString() : null;
  const sessionClosedAt = sessionClosedAtDate ? sessionClosedAtDate.toISOString() : null;

  if (sessionStatus === 'not_started') {
    sessionStatus = 'not_started';
  }

  return {
    participant_id: participantId,
    allocation_group: allocationGroup,
    session_status: sessionStatus,
    session_opened_at: sessionOpenedAt,
    session_closed_at: sessionClosedAt,
    completed,
    completed_at: completed && completedAtDate ? completedAtDate.toISOString() : null,
    created_at: createdAtDate ? createdAtDate.toISOString() : null,
    updated_at: updatedAtDate ? updatedAtDate.toISOString() : null
  };
};

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
  video_provider: record.video_provider || '',
  video_id: record.video_id || '',
  video_title: record.video_title || '',
  video_url: record.video_url || '',
  video_action: record.video_action || '',
  video_current_time_ms: record.video_current_time_ms ?? '',
  video_duration_ms: record.video_duration_ms ?? '',
  video_percent: record.video_percent ?? '',
  task_action_index: record.task_action_index ?? '',
  duration_ms: record.duration_ms ?? '',
  trial_mode: record.trial_mode || 'digital',
  referrer: record.referrer || ''
});

const projectPhysicalTrialRecord = (record) => ({
  received_at: record.received_at || '',
  timestamp: record.timestamp || '',
  session_id: record.session_id || '',
  participant_id: record.participant_id || '',
  task_id: record.task_id || '',
  task_label: record.task_label || '',
  event_type: record.event_type || '',
  observer_id: record.observer_id || '',
  manual_page: record.manual_page || '',
  duration_ms: Number.isFinite(parseIntegerSafely(record.duration_ms)) ? parseIntegerSafely(record.duration_ms) : null,
  notes: record.notes || '',
  source: record.source || 'physical_manual',
  trial_mode: record.trial_mode || 'physical'
});

const projectObserverNoteRecord = (record) => ({
  received_at: record.received_at || '',
  timestamp: record.timestamp || '',
  session_id: record.session_id || '',
  participant_id: record.participant_id || '',
  task_id: record.task_id || '',
  task_label: record.task_label || '',
  manual_page: record.manual_page || '',
  scenario_score: Number.isFinite(parseIntegerSafely(record.scenario_score)) ? parseIntegerSafely(record.scenario_score) : null,
  task_length_ms: Number.isFinite(parseIntegerSafely(record.task_length_ms)) ? parseIntegerSafely(record.task_length_ms) : null,
  help_instances_count: Number.isFinite(parseIntegerSafely(record.help_instances_count)) ? parseIntegerSafely(record.help_instances_count) : 0,
  error_severity: record.error_severity || '',
  error_text: record.error_text || '',
  notes: record.notes || '',
  action_type: record.action_type || '',
  source: record.source || 'observations_logger',
  trial_mode: record.trial_mode ?? null
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

const readDistinctParticipantIdsFromNdjson = () => {
  ensureTelemetryStorage();
  if (!fs.existsSync(telemetryFilePath)) {
    return [];
  }

  const raw = fs.readFileSync(telemetryFilePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const participants = new Set();

  for (const line of lines) {
    try {
      const parsed = projectTelemetryRecord(JSON.parse(line));
      const participantId = String(parsed.participant_id || '').trim();
      if (participantId) {
        participants.add(participantId);
      }
    } catch {
      // ignore malformed lines
    }
  }

  return Array.from(participants.values());
};

const readParticipantAllocationRecordsFromFile = () => {
  ensureTelemetryStorage();
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(participantAllocationFilePath, 'utf8'));
  } catch {
    parsed = [];
  }

  const incoming = Array.isArray(parsed) ? parsed : [];
  const rowsById = new Map();

  incoming.forEach((row) => {
    const normalized = normalizeParticipantAllocationRecord(row);
    if (!normalized.participant_id) {
      return;
    }
    rowsById.set(normalized.participant_id, normalized);
  });

  for (const seed of defaultParticipantAllocationRecords) {
    if (!rowsById.has(seed.participant_id)) {
      rowsById.set(seed.participant_id, normalizeParticipantAllocationRecord(seed));
    }
  }

  const rows = Array.from(rowsById.values())
    .sort((a, b) => participantIdSortValue(a.participant_id) - participantIdSortValue(b.participant_id));

  fs.writeFileSync(participantAllocationFilePath, JSON.stringify(rows, null, 2), 'utf8');
  return rows;
};

const writeParticipantAllocationRecordsToFile = (rows) => {
  ensureTelemetryStorage();
  fs.writeFileSync(participantAllocationFilePath, JSON.stringify(rows, null, 2), 'utf8');
};

const getRecordTimeMs = (record) => {
  const value = record.timestamp || record.received_at;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const addDerivedTaskMetrics = (records) => {
  const activeTaskInstances = new Map();
  const sequenceBySessionTask = new Map();
  const rowTaskInstance = new Array(records.length).fill(null);

  const nextSequence = (sessionTaskKey) => {
    const next = (sequenceBySessionTask.get(sessionTaskKey) || 0) + 1;
    sequenceBySessionTask.set(sessionTaskKey, next);
    return next;
  };

  records.forEach((record, index) => {
    const sessionId = String(record.session_id || '').trim();
    const taskId = String(record.task_id || '').trim();
    if (!taskId) {
      return;
    }

    const sessionTaskKey = `${sessionId}::${taskId}`;
    const eventType = String(record.event_type || '').trim().toLowerCase();
    const eventTimeMs = getRecordTimeMs(record);
    let instance = activeTaskInstances.get(sessionTaskKey);

    if (eventType === 'task_start') {
      instance = {
        sequence: nextSequence(sessionTaskKey),
        startedAt: record.timestamp || record.received_at || '',
        startedAtMs: eventTimeMs,
        endedAt: '',
        endedAtMs: null,
        totalDurationMs: null
      };
      activeTaskInstances.set(sessionTaskKey, instance);
    } else if (!instance) {
      instance = {
        sequence: nextSequence(sessionTaskKey),
        startedAt: '',
        startedAtMs: null,
        endedAt: '',
        endedAtMs: null,
        totalDurationMs: null
      };
      activeTaskInstances.set(sessionTaskKey, instance);
    }

    rowTaskInstance[index] = instance;

    if (eventType === 'task_end') {
      instance.endedAt = record.timestamp || record.received_at || instance.endedAt || '';
      instance.endedAtMs = eventTimeMs;

      const explicitDuration = parseIntegerSafely(record.duration_ms);
      if (explicitDuration !== null) {
        instance.totalDurationMs = explicitDuration;
      } else if (Number.isFinite(instance.startedAtMs) && Number.isFinite(instance.endedAtMs)) {
        instance.totalDurationMs = Math.max(0, instance.endedAtMs - instance.startedAtMs);
      }

      activeTaskInstances.delete(sessionTaskKey);
    }
  });

  return records.map((record, index) => {
    const instance = rowTaskInstance[index];
    if (!instance) {
      return {
        ...record,
        task_instance_seq: '',
        task_instance_started_at: '',
        task_instance_ended_at: '',
        task_total_duration_ms: '',
        task_elapsed_ms_at_event: '',
        task_page_dwell_ms: ''
      };
    }

    const eventTimeMs = getRecordTimeMs(record);
    let elapsedMs = '';
    if (Number.isFinite(instance.startedAtMs) && Number.isFinite(eventTimeMs)) {
      const cappedEventTime = Number.isFinite(instance.endedAtMs)
        ? Math.min(eventTimeMs, instance.endedAtMs)
        : eventTimeMs;
      elapsedMs = Math.max(0, cappedEventTime - instance.startedAtMs);
    }

    return {
      ...record,
      task_instance_seq: instance.sequence,
      task_instance_started_at: instance.startedAt,
      task_instance_ended_at: instance.endedAt,
      task_total_duration_ms: instance.totalDurationMs ?? '',
      task_elapsed_ms_at_event: elapsedMs,
      task_page_dwell_ms: String(record.event_type || '').trim().toLowerCase() === 'page_exit'
        ? (record.duration_ms ?? '')
        : ''
    };
  });
};

const buildTelemetryCsv = (records) => {
  const recordsWithMetrics = addDerivedTaskMetrics(records);
  const header = telemetryCsvColumns.join(',');
  const rows = recordsWithMetrics.map((record) => telemetryCsvColumns.map((column) => csvEscape(record[column])).join(','));
  return [header, ...rows].join('\n');
};

const buildPhysicalTrialCsv = (records) => {
  const header = physicalTrialCsvColumns.join(',');
  const rows = records.map((record) => physicalTrialCsvColumns.map((column) => csvEscape(record[column])).join(','));
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

const parseJsonObjectSafely = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const parseLikertSafely = (value) => {
  const parsed = parseIntegerSafely(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
    return null;
  }
  return parsed;
};

const parseBoundedIntegerSafely = (value, min, max) => {
  const parsed = parseIntegerSafely(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (Number.isFinite(min) && parsed < min) {
    return null;
  }
  if (Number.isFinite(max) && parsed > max) {
    return null;
  }
  return parsed;
};

const parseBooleanSafely = (value) => {
  if (value === true || value === false) {
    return value;
  }

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return null;
};

const includesChoice = (values, expected) => {
  if (!Array.isArray(values)) {
    return false;
  }
  const normalizedExpected = String(expected || '').trim().toLowerCase();
  return values.some((value) => String(value || '').trim().toLowerCase() === normalizedExpected);
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
  let responseParts = null;

  if (record && record.response_parts && typeof record.response_parts === 'object' && !Array.isArray(record.response_parts)) {
    responseParts = record.response_parts;
  } else if (record && typeof record.response_parts === 'string') {
    responseParts = parseJsonObjectSafely(record.response_parts);
  }

  return {
    ...projected,
    response_parts: responseParts,
    trial_mode: String(record && record.trial_mode || projected.trial_mode || 'digital').trim().toLowerCase() === 'physical' ? 'physical' : 'digital',
    received_at: parseDateSafely(record.received_at || projected.received_at || new Date().toISOString()),
    timestamp: parseDateSafely(record.timestamp || projected.timestamp),
    result_count: parseIntegerSafely(projected.result_count),
    response_length: parseIntegerSafely(projected.response_length),
    video_current_time_ms: parseIntegerSafely(projected.video_current_time_ms),
    video_duration_ms: parseIntegerSafely(projected.video_duration_ms),
    video_percent: parseIntegerSafely(projected.video_percent),
    task_action_index: parseIntegerSafely(projected.task_action_index),
    duration_ms: parseIntegerSafely(projected.duration_ms)
  };
};

const getAnswerPartText = (answerParts, key) => {
  if (!answerParts || typeof answerParts !== 'object' || Array.isArray(answerParts)) {
    return null;
  }

  const normalizedKey = String(key || '').trim().toLowerCase();
  if (!normalizedKey) {
    return null;
  }

  const candidateKeys = [
    normalizedKey,
    normalizedKey.toUpperCase(),
    `part_${normalizedKey}`,
    `part_${normalizedKey}_answer_text`,
    `part${normalizedKey}`,
    `part${normalizedKey}_answer_text`
  ];

  for (const candidate of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(answerParts, candidate)) {
      const value = String(answerParts[candidate] || '').trim();
      if (value) {
        return value;
      }
    }
  }

  return null;
};

const buildAnswerTextFromParts = (answerParts) => {
  if (!answerParts || typeof answerParts !== 'object' || Array.isArray(answerParts)) {
    return '';
  }

  const ordered = ['a', 'b', 'c', 'd']
    .map((key) => ({ key, value: getAnswerPartText(answerParts, key) }))
    .filter((entry) => String(entry.value || '').trim());

  if (!ordered.length) {
    return '';
  }

  return ordered.map((entry) => `(${entry.key}) ${entry.value}`).join('\n');
};

const normalizePhysicalTrialRecordForSql = (record) => {
  const projected = projectPhysicalTrialRecord(record);
  return {
    ...projected,
    trial_mode: String(record && record.trial_mode || projected.trial_mode || 'physical').trim().toLowerCase() === 'digital' ? 'digital' : 'physical',
    duration_ms: parseIntegerSafely(projected.duration_ms),
    received_at: parseDateSafely(record.received_at || projected.received_at || new Date().toISOString()),
    timestamp: parseDateSafely(record.timestamp || projected.timestamp)
  };
};

const normalizeObserverNoteRecordForSql = (record) => {
  const projected = projectObserverNoteRecord(record);
  const actionType = String(projected.action_type || '').trim().toLowerCase();
  const helpInstancesCount = parseBoundedIntegerSafely(projected.help_instances_count, 0, 1000000);
  const trialModeRaw = String(projected.trial_mode || '').trim().toLowerCase();
  return {
    ...projected,
    action_type: actionType,
    error_severity: ['minor', 'major'].includes(String(projected.error_severity || '').trim().toLowerCase())
      ? String(projected.error_severity || '').trim().toLowerCase()
      : null,
    error_text: String(projected.error_text || '').trim(),
    source: String(projected.source || 'observations_logger').trim() || 'observations_logger',
    trial_mode: trialModeRaw === 'digital' ? 'digital' : (trialModeRaw === 'physical' ? 'physical' : null),
    scenario_score: parseIntegerSafely(projected.scenario_score),
    task_length_ms: parseIntegerSafely(projected.task_length_ms),
    help_instances_count: Number.isFinite(helpInstancesCount) ? helpInstancesCount : 0,
    received_at: parseDateSafely(record.received_at || projected.received_at || new Date().toISOString()),
    timestamp: parseDateSafely(record.timestamp || projected.timestamp)
  };
};

const computeTaskActionIndexPostgres = async (client, normalizedRecord) => {
  const eventType = String(normalizedRecord.event_type || '').trim().toLowerCase();
  const taskId = String(normalizedRecord.task_id || '').trim();
  const participantId = String(normalizedRecord.participant_id || '').trim();

  if (!taskId || !participantId) {
    return null;
  }

  if (eventType === 'task_start') {
    return 0;
  }

  const lockKey = `${participantId}|${taskId}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

  const lastStartResult = await client.query(
    `
      SELECT id
      FROM telemetry_events
      WHERE participant_id = $1
        AND task_id = $2
        AND event_type = 'task_start'
      ORDER BY id DESC
      LIMIT 1
    `,
    [participantId, taskId]
  );

  const lastStartId = lastStartResult.rows[0] ? Number(lastStartResult.rows[0].id) : null;

  const maxIndexResult = await client.query(
    `
      SELECT MAX(task_action_index) AS max_index
      FROM telemetry_events
      WHERE participant_id = $1
        AND task_id = $2
        AND ($3::BIGINT IS NULL OR id >= $3::BIGINT)
    `,
    [participantId, taskId, Number.isFinite(lastStartId) ? lastStartId : null]
  );

  const maxIndex = parseIntegerSafely(maxIndexResult.rows[0] && maxIndexResult.rows[0].max_index);
  if (maxIndex === null) {
    return 1;
  }

  return maxIndex + 1;
};

const insertTelemetryRecordPostgres = async (record) => {
  const pool = getTelemetryPgPool();
  const normalized = normalizeTelemetryRecordForSql(record);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    normalized.task_action_index = await computeTaskActionIndexPostgres(client, normalized);

    const placeholders = telemetrySqlColumns.map((_, index) => `$${index + 1}`).join(', ');
    const queryText = `INSERT INTO telemetry_events (${telemetrySqlColumns.join(', ')}) VALUES (${placeholders}) RETURNING id`;
    const values = telemetrySqlColumns.map((column) => normalized[column]);
    const insertResult = await client.query(queryText, values);
    const telemetryEventId = insertResult.rows[0] ? Number(insertResult.rows[0].id) : null;

    const eventType = String(normalized.event_type || '').trim().toLowerCase();
    const questionId = String(normalized.question_id || normalized.task_id || '').trim();
    const answerText = String(normalized.response_message || '').trim();
    const answerParts = normalized.response_parts && typeof normalized.response_parts === 'object' && !Array.isArray(normalized.response_parts)
      ? normalized.response_parts
      : null;
    const partAAnswerText = getAnswerPartText(answerParts, 'a');
    const participantId = String(normalized.participant_id || '').trim();

    if (eventType === 'short_form_answer_submitted' && questionId && participantId && (answerText || answerParts)) {
      await client.query(
        `
          INSERT INTO short_form_results (
            telemetry_event_id,
            received_at,
            timestamp,
            session_id,
            participant_id,
            task_id,
            task_label,
            question_id,
            duration_ms,
            answer_text,
            part_a_answer_text,
            trial_mode
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          Number.isFinite(telemetryEventId) ? telemetryEventId : null,
          normalized.received_at,
          normalized.timestamp,
          normalized.session_id,
          participantId,
          normalized.task_id,
          normalized.task_label,
          questionId,
          parseBoundedIntegerSafely(normalized.duration_ms, 0, 86400000),
          answerText || '',
          partAAnswerText,
          normalized.trial_mode || 'digital'
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const insertPhysicalTrialRecordPostgres = async (record) => {
  const pool = getTelemetryPgPool();
  const normalized = normalizePhysicalTrialRecordForSql(record);

  const placeholders = physicalTrialSqlColumns.map((_, index) => `$${index + 1}`).join(', ');
  const queryText = `INSERT INTO physical_trial_events (${physicalTrialSqlColumns.join(', ')}) VALUES (${placeholders})`;
  const values = physicalTrialSqlColumns.map((column) => normalized[column]);

  await pool.query(queryText, values);
};

const insertObserverNoteRecordPostgres = async (record) => {
  const pool = getTelemetryPgPool();
  const normalized = normalizeObserverNoteRecordForSql(record);

  const placeholders = observerNotesSqlColumns.map((_, index) => `$${index + 1}`).join(', ');
  const queryText = `INSERT INTO observer_notes (${observerNotesSqlColumns.join(', ')}) VALUES (${placeholders})`;
  const values = observerNotesSqlColumns.map((column) => normalized[column]);

  await pool.query(queryText, values);
};

const insertObserverStepMarkRecordPostgres = async (record) => {
  const pool = getTelemetryPgPool();
  const payload = record && typeof record === 'object' ? record : {};

  const queryText = `
    INSERT INTO observer_step_marks (
      received_at,
      timestamp,
      session_id,
      participant_id,
      task_id,
      task_label,
      criterion_id,
      criterion_label,
      criterion_outcome,
      criterion_step_time_ms,
      observer_note,
      source,
      trial_mode,
      raw_payload
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
    )
  `;

  const values = [
    parseDateSafely(payload.received_at || new Date().toISOString()),
    parseDateSafely(payload.timestamp),
    String(payload.session_id || '').trim(),
    String(payload.participant_id || '').trim(),
    String(payload.task_id || '').trim(),
    String(payload.task_label || '').trim(),
    String(payload.criterion_id || '').trim(),
    String(payload.criterion_label || '').trim(),
    String(payload.criterion_outcome || '').trim().toLowerCase(),
    parseBoundedIntegerSafely(payload.criterion_step_time_ms, 0, 24 * 60 * 60 * 1000),
    String(payload.observer_note || '').trim(),
    String(payload.source || 'observations_logger').trim() || 'observations_logger',
    (() => {
      const trialModeRaw = String(payload.trial_mode || '').trim().toLowerCase();
      if (trialModeRaw === 'digital') return 'digital';
      if (trialModeRaw === 'physical') return 'physical';
      return null;
    })(),
    JSON.stringify(payload)
  ];

  await pool.query(queryText, values);
};

const insertQuestionnaireRecordPostgres = async (record) => {
  const pool = getTelemetryPgPool();
  const normalized = normalizePhysicalTrialRecordForSql(record);
  const taskId = String(normalized.task_id || '').trim();
  const eventType = String(normalized.event_type || '').trim().toLowerCase();
  const response = parseJsonObjectSafely(normalized.notes);

  if (eventType !== 'note' || !response) {
    return;
  }

  const isShortFormTask = /^short_form_q[1-4]$/i.test(taskId);
  const shortFormResponse = response && response.short_form_response && typeof response.short_form_response === 'object' && !Array.isArray(response.short_form_response)
    ? response.short_form_response
    : null;

  if (isShortFormTask && shortFormResponse) {
    const partAAnswerText = getAnswerPartText(shortFormResponse, 'a');
    const answerText = buildAnswerTextFromParts(shortFormResponse);

    await pool.query(
      `
        INSERT INTO short_form_results (
          telemetry_event_id,
          received_at,
          timestamp,
          session_id,
          participant_id,
          task_id,
          task_label,
          question_id,
          duration_ms,
          answer_text,
          part_a_answer_text,
          trial_mode
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        null,
        normalized.received_at,
        normalized.timestamp,
        normalized.session_id || '',
        normalized.participant_id || '',
        taskId,
        normalized.task_label || taskId,
        taskId,
        parseBoundedIntegerSafely(normalized.duration_ms, 0, 86400000),
        answerText,
        partAAnswerText,
        'physical'
      ]
    );
    return;
  }

  if (taskId === 'pre-trial-questionnaire') {
    const deviceExperience = Array.isArray(response.device_experience) ? response.device_experience : [];
    const queryText = `
      INSERT INTO pre_trial_questionnaire (
        received_at,
        timestamp,
        session_id,
        participant_id,
        observer_id,
        questionnaire_duration_ms,
        q1_age_years,
        q2_gender,
        q2_gender_other_text,
        q3_education,
        q4_occupation,
        q6_digital_literacy,
        q7_digital_guidance,
        q8_physical_guidance,
        q9_problem_solving,
        q10_format_preference,
        q10_format_mix_details,
        consent_to_participate,
        q5_device_experience_none,
        q5_device_experience_blood_pressure_monitor,
        q5_device_experience_blood_glucose_monitor,
        q5_device_experience_inhaler_nebuliser,
        q5_device_experience_sleep_fitness_tracker,
        q5_device_experience_other,
        q5_device_experience_other_text,
        free_text_notes,
        raw_response
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
      )
    `;

    const values = [
      normalized.received_at,
      normalized.timestamp,
      normalized.session_id || '',
      normalized.participant_id || '',
      normalized.observer_id || '',
      parseBoundedIntegerSafely(response.questionnaire_duration_ms, 0, 86400000),
      parseBoundedIntegerSafely(response.age_years, 0, 120),
      String(response.gender || '').trim(),
      String(response.gender_other_text || '').trim(),
      String(response.education || '').trim(),
      String(response.occupation || '').trim(),
      parseLikertSafely(response.tech_comfort_1_to_5),
      parseLikertSafely(response.baseline_q6_1_to_5),
      parseLikertSafely(response.baseline_q7_1_to_5),
      parseLikertSafely(response.baseline_q8_1_to_5),
      String(response.format_preference || '').trim(),
      String(response.format_mix_details || '').trim(),
      parseBooleanSafely(response.consent_to_participate),
      includesChoice(deviceExperience, 'none'),
      includesChoice(deviceExperience, 'blood_pressure_monitor'),
      includesChoice(deviceExperience, 'blood_glucose_monitor'),
      includesChoice(deviceExperience, 'inhaler_nebuliser'),
      includesChoice(deviceExperience, 'sleep_fitness_tracker'),
      includesChoice(deviceExperience, 'other'),
      String(response.device_experience_other || '').trim(),
      String(response.free_text_notes || '').trim(),
      JSON.stringify(response)
    ];

    await pool.query(queryText, values);
    return;
  }

  if (taskId === 'post-trial-questionnaire') {
    const queryText = `
      INSERT INTO post_trial_questionnaire (
        received_at,
        timestamp,
        session_id,
        participant_id,
        observer_id,
        questionnaire_duration_ms,
        q1_instructions_ease,
        q2_info_ease,
        q3_step_by_step_help,
        q4_instructions_satisfaction,
        q5_confidence_setup,
        q6_confidence_troubleshooting,
        q7_mental_effort,
        q8_tlx_frustration,
        q9_tlx_perceived_performance,
        q10_tlx_temporal_demand,
        q11_format_preference,
        q11_format_mix_details,
        free_text_notes,
        raw_response
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
    `;

    const values = [
      normalized.received_at,
      normalized.timestamp,
      normalized.session_id || '',
      normalized.participant_id || '',
      normalized.observer_id || '',
      parseBoundedIntegerSafely(response.questionnaire_duration_ms, 0, 86400000),
      parseLikertSafely(response.post_q1_1_to_5),
      parseLikertSafely(response.post_q2_1_to_5),
      parseLikertSafely(response.post_q3_1_to_5),
      parseLikertSafely(response.post_q4_1_to_5),
      parseLikertSafely(response.post_q5_1_to_5),
      parseLikertSafely(response.post_q6_1_to_5),
      parseLikertSafely(response.post_q7_1_to_5),
      parseLikertSafely(response.post_q8_frustration_1_to_5),
      parseLikertSafely(response.post_q9_performance_1_to_5),
      parseLikertSafely(response.post_q10_temporal_1_to_5),
      String(response.format_preference || '').trim(),
      String(response.format_mix_details || '').trim(),
      String(response.free_text_notes || '').trim(),
      JSON.stringify(response)
    ];

    await pool.query(queryText, values);
  }
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

const readDistinctParticipantIdsPostgres = async () => {
  const pool = getTelemetryPgPool();
  const result = await pool.query(
    `
      SELECT DISTINCT participant_id
      FROM telemetry_events
      WHERE NULLIF(TRIM(participant_id), '') IS NOT NULL
    `
  );

  return result.rows
    .map((row) => String(row.participant_id || '').trim())
    .filter(Boolean);
};

const ensureParticipantAllocationSchemaPostgres = async () => {
  const pool = getTelemetryPgPool();

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS participant_allocation (
        participant_id TEXT PRIMARY KEY,
        allocation_group TEXT NOT NULL,
        session_status TEXT NOT NULL DEFAULT 'not_started',
        session_opened_at TIMESTAMPTZ,
        session_closed_at TIMESTAMPTZ,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT participant_allocation_group_check CHECK (allocation_group IN ('physical', 'digital')),
        CONSTRAINT participant_allocation_session_status_check CHECK (session_status IN ('not_started', 'in_progress', 'closed'))
      )
    `
  );

  const alterStatements = [
    'ALTER TABLE participant_allocation ADD COLUMN IF NOT EXISTS completed BOOLEAN',
    'ALTER TABLE participant_allocation ADD COLUMN IF NOT EXISTS session_status TEXT',
    'ALTER TABLE participant_allocation ADD COLUMN IF NOT EXISTS session_opened_at TIMESTAMPTZ',
    'ALTER TABLE participant_allocation ADD COLUMN IF NOT EXISTS session_closed_at TIMESTAMPTZ',
    'ALTER TABLE participant_allocation ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ',
    'ALTER TABLE participant_allocation ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ',
    'ALTER TABLE participant_allocation ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ',
    "ALTER TABLE participant_allocation ALTER COLUMN completed SET DEFAULT FALSE",
    "ALTER TABLE participant_allocation ALTER COLUMN session_status SET DEFAULT 'not_started'"
  ];

  for (const statement of alterStatements) {
    await pool.query(statement);
  }

  await pool.query(
    `
      UPDATE participant_allocation
      SET completed = FALSE
      WHERE completed IS NULL
    `
  );

  await pool.query(
    `
      UPDATE participant_allocation
      SET session_status = 'not_started'
      WHERE session_status IS NULL OR TRIM(session_status) = ''
    `
  );

  await pool.query(
    `
      UPDATE participant_allocation
      SET created_at = NOW()
      WHERE created_at IS NULL
    `
  );

  await pool.query(
    `
      UPDATE participant_allocation
      SET updated_at = NOW()
      WHERE updated_at IS NULL
    `
  );

  await pool.query('CREATE INDEX IF NOT EXISTS idx_participant_allocation_group ON participant_allocation (allocation_group)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_participant_allocation_completed ON participant_allocation (completed, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_participant_allocation_session_status ON participant_allocation (session_status, updated_at DESC)');
};

const ensureParticipantAllocationDefaultsPostgres = async () => {
  const pool = getTelemetryPgPool();
  await ensureParticipantAllocationSchemaPostgres();
  const queryText = `
    INSERT INTO participant_allocation (
      participant_id,
      allocation_group,
      session_status,
      session_opened_at,
      session_closed_at,
      completed,
      completed_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'not_started', NULL, NULL, FALSE, NULL, NOW(), NOW())
    ON CONFLICT (participant_id) DO NOTHING
  `;

  for (const row of defaultParticipantAllocationRecords) {
    await pool.query(queryText, [row.participant_id, row.allocation_group]);
  }
};

const readParticipantAllocationRecordsPostgres = async () => {
  const pool = getTelemetryPgPool();
  await ensureParticipantAllocationDefaultsPostgres();

  const result = await pool.query(
    `
      SELECT participant_id, allocation_group, session_status, session_opened_at, session_closed_at, completed, completed_at, created_at, updated_at
      FROM participant_allocation
      ORDER BY participant_id ASC
    `
  );

  return result.rows
    .map(normalizeParticipantAllocationRecord)
    .sort((a, b) => participantIdSortValue(a.participant_id) - participantIdSortValue(b.participant_id));
};

const readParticipantAllocationRecordPostgres = async (participantId) => {
  const normalizedId = String(participantId || '').trim().toUpperCase();
  if (!normalizedId) {
    return null;
  }

  const pool = getTelemetryPgPool();
  await ensureParticipantAllocationDefaultsPostgres();

  const result = await pool.query(
    `
      SELECT participant_id, allocation_group, session_status, session_opened_at, session_closed_at, completed, completed_at, created_at, updated_at
      FROM participant_allocation
      WHERE participant_id = $1
      LIMIT 1
    `,
    [normalizedId]
  );

  return result.rows[0] ? normalizeParticipantAllocationRecord(result.rows[0]) : null;
};

const readPhysicalTrialRecordsPostgres = async (participantId) => {
  const pool = getTelemetryPgPool();
  const baseQuery = `
    SELECT ${physicalTrialSqlColumns.join(', ')}
    FROM physical_trial_events
  `;

  const hasParticipantFilter = Boolean(String(participantId || '').trim());
  const queryText = hasParticipantFilter
    ? `${baseQuery} WHERE participant_id = $1 ORDER BY received_at ASC`
    : `${baseQuery} ORDER BY received_at ASC`;
  const queryValues = hasParticipantFilter ? [String(participantId).trim()] : [];

  const result = await pool.query(queryText, queryValues);
  return result.rows.map(projectPhysicalTrialRecord);
};

const writeTelemetryRecordToFiles = (record) => {
  ensureTelemetryStorage();
  fs.appendFileSync(telemetryFilePath, `${JSON.stringify(record)}\n`, 'utf8');

  const participantLogPath = getParticipantTelemetryPath(record.participant_id);
  if (participantLogPath) {
    fs.appendFileSync(participantLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  }
};

const writePhysicalTrialRecordToFiles = (record) => {
  ensureTelemetryStorage();
  fs.appendFileSync(physicalTrialFilePath, `${JSON.stringify(record)}\n`, 'utf8');
};

const writeObserverNoteRecordToFiles = (record) => {
  ensureTelemetryStorage();
  fs.appendFileSync(observerNotesFilePath, `${JSON.stringify(record)}\n`, 'utf8');
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

const storePhysicalTrialRecord = async (record) => {
  if (telemetryUsePostgres) {
    try {
      await insertPhysicalTrialRecordPostgres(record);
      return;
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Postgres physical trial write failed, falling back to file store:', error.message);
      writePhysicalTrialRecordToFiles(record);
      return;
    }
  }

  writePhysicalTrialRecordToFiles(record);
};

const storeObserverNoteRecord = async (record) => {
  if (telemetryUsePostgres) {
    try {
      await insertObserverNoteRecordPostgres(record);
      return;
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Postgres observer notes write failed, falling back to file store:', error.message);
      writeObserverNoteRecordToFiles(record);
      return;
    }
  }

  writeObserverNoteRecordToFiles(record);
};

const storeObserverStepMarkRecord = async (record) => {
  if (telemetryUsePostgres) {
    try {
      await insertObserverStepMarkRecordPostgres(record);
      return;
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Postgres observer step mark write failed, falling back to file store:', error.message);
      writeObserverNoteRecordToFiles(record);
      return;
    }
  }

  writeObserverNoteRecordToFiles(record);
};

const storeQuestionnaireRecord = async (record) => {
  if (!telemetryUsePostgres) {
    return;
  }

  try {
    await insertQuestionnaireRecordPostgres(record);
  } catch (error) {
    if (!telemetryFallbackToFile) {
      throw error;
    }
    console.error('Postgres questionnaire write failed:', error.message);
  }
};

const isDedicatedQuestionnaireTaskId = (taskId) => {
  const key = String(taskId || '').trim().toLowerCase();
  return key === 'pre-trial-questionnaire' || key === 'post-trial-questionnaire';
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

const readPhysicalTrialRecordsFromNdjson = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const records = [];

  for (const line of lines) {
    try {
      records.push(projectPhysicalTrialRecord(JSON.parse(line)));
    } catch {
      // ignore malformed lines
    }
  }

  return records;
};

const readParticipantAllocationRecords = async () => {
  if (telemetryUsePostgres) {
    try {
      const postgresRows = await readParticipantAllocationRecordsPostgres();
      if (postgresRows.length > 0 || !telemetryFallbackToFile) {
        return postgresRows;
      }
      return readParticipantAllocationRecordsFromFile();
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Participant allocation postgres read failed, using file fallback:', error.message);
      return readParticipantAllocationRecordsFromFile();
    }
  }

  return readParticipantAllocationRecordsFromFile();
};

const readParticipantAllocationRecord = async (participantId) => {
  const normalizedId = String(participantId || '').trim().toUpperCase();
  if (!normalizedId) {
    return null;
  }

  if (telemetryUsePostgres) {
    try {
      const postgresRow = await readParticipantAllocationRecordPostgres(normalizedId);
      if (postgresRow || !telemetryFallbackToFile) {
        return postgresRow;
      }

      const fileRows = readParticipantAllocationRecordsFromFile();
      return fileRows.find((row) => String(row && row.participant_id || '').trim().toUpperCase() === normalizedId) || null;
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Participant allocation single-record read failed in postgres, using file fallback:', error.message);
    }
  }

  const fileRows = readParticipantAllocationRecordsFromFile();
  return fileRows.find((row) => String(row && row.participant_id || '').trim().toUpperCase() === normalizedId) || null;
};

const buildParticipantStateForTaskState = (record) => {
  const normalized = record ? normalizeParticipantAllocationRecord(record) : null;
  if (!normalized) {
    return null;
  }

  const sessionStatus = String(normalized.session_status || '').trim().toLowerCase();
  const completed = normalized.completed === true;
  const isTerminal = completed || sessionStatus === 'closed';

  return {
    participant_id: normalized.participant_id,
    session_status: sessionStatus || 'not_started',
    session_closed_at: normalized.session_closed_at || null,
    completed,
    completed_at: normalized.completed_at || null,
    is_terminal: isTerminal
  };
};

const updateParticipantAllocationRecord = async (participantId, action, completed, allocationGroup) => {
  const normalizedId = String(participantId || '').trim().toUpperCase();
  if (!normalizedId) {
    throw new Error('participant_id is required');
  }

  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!['set_completed', 'open_session', 'close_session', 'set_allocation_group'].includes(normalizedAction)) {
    throw new Error('action must be set_completed, open_session, close_session, or set_allocation_group');
  }

  const normalizedAllocationGroup = String(allocationGroup || '').trim().toLowerCase();
  if (normalizedAction === 'set_allocation_group' && !['physical', 'digital'].includes(normalizedAllocationGroup)) {
    throw new Error('allocation_group must be physical or digital when action is set_allocation_group');
  }

  if (telemetryUsePostgres) {
    try {
      const pool = getTelemetryPgPool();
      await ensureParticipantAllocationDefaultsPostgres();
      let updateResult;

      if (normalizedAction === 'set_completed') {
        const completionTime = completed ? new Date().toISOString() : null;
        updateResult = await pool.query(
          `
            UPDATE participant_allocation
            SET
              completed = $2,
              completed_at = $3,
              updated_at = NOW()
            WHERE participant_id = $1
            RETURNING participant_id, allocation_group, session_status, session_opened_at, session_closed_at, completed, completed_at, created_at, updated_at
          `,
          [normalizedId, completed, completionTime]
        );
      }

      if (normalizedAction === 'open_session') {
        updateResult = await pool.query(
          `
            UPDATE participant_allocation
            SET
              session_status = 'in_progress',
              session_opened_at = COALESCE(session_opened_at, NOW()),
              session_closed_at = NULL,
              updated_at = NOW()
            WHERE participant_id = $1
            RETURNING participant_id, allocation_group, session_status, session_opened_at, session_closed_at, completed, completed_at, created_at, updated_at
          `,
          [normalizedId]
        );
      }

      if (normalizedAction === 'close_session') {
        updateResult = await pool.query(
          `
            UPDATE participant_allocation
            SET
              session_status = 'closed',
              session_closed_at = NOW(),
              updated_at = NOW()
            WHERE participant_id = $1
            RETURNING participant_id, allocation_group, session_status, session_opened_at, session_closed_at, completed, completed_at, created_at, updated_at
          `,
          [normalizedId]
        );
      }

      if (normalizedAction === 'set_allocation_group') {
        updateResult = await pool.query(
          `
            UPDATE participant_allocation
            SET
              allocation_group = $2,
              updated_at = NOW()
            WHERE participant_id = $1
            RETURNING participant_id, allocation_group, session_status, session_opened_at, session_closed_at, completed, completed_at, created_at, updated_at
          `,
          [normalizedId, normalizedAllocationGroup]
        );
      }

      const updated = updateResult.rows[0] ? normalizeParticipantAllocationRecord(updateResult.rows[0]) : null;
      if (updated) {
        return updated;
      }

      throw new Error('participant_id not found in allocation table');
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Participant allocation postgres update failed, using file fallback:', error.message);
    }
  }

  const rows = readParticipantAllocationRecordsFromFile();
  const index = rows.findIndex((row) => String(row.participant_id || '').trim().toUpperCase() === normalizedId);
  if (index < 0) {
    throw new Error('participant_id not found in allocation table');
  }

  const nowIso = new Date().toISOString();
  const current = rows[index] && typeof rows[index] === 'object' ? rows[index] : {};

  let next = {
    ...current,
    updated_at: nowIso
  };

  if (normalizedAction === 'set_completed') {
    next = {
      ...next,
      completed: Boolean(completed),
      completed_at: completed ? nowIso : null
    };
  }

  if (normalizedAction === 'open_session') {
    next = {
      ...next,
      session_status: 'in_progress',
      session_opened_at: current.session_opened_at || nowIso,
      session_closed_at: null
    };
  }

  if (normalizedAction === 'close_session') {
    next = {
      ...next,
      session_status: 'closed',
      session_closed_at: nowIso
    };
  }

  if (normalizedAction === 'set_allocation_group') {
    next = {
      ...next,
      allocation_group: normalizedAllocationGroup
    };
  }

  rows[index] = {
    ...normalizeParticipantAllocationRecord(next),
    updated_at: nowIso
  };

  writeParticipantAllocationRecordsToFile(rows);
  return rows[index];
};

const resetParticipantAllocationSessionStatuses = async (participantIds, resetAll) => {
  const normalizedIds = Array.isArray(participantIds)
    ? participantIds
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
    : [];

  if (!resetAll && normalizedIds.length === 0) {
    throw new Error('participant_ids is required when reset_all is false');
  }

  if (telemetryUsePostgres) {
    try {
      const pool = getTelemetryPgPool();
      await ensureParticipantAllocationDefaultsPostgres();

      let result;
      if (resetAll) {
        result = await pool.query(
          `
            UPDATE participant_allocation
            SET
              session_status = 'not_started',
              session_opened_at = NULL,
              session_closed_at = NULL,
              completed = FALSE,
              completed_at = NULL,
              updated_at = NOW()
            RETURNING participant_id
          `
        );
      } else {
        result = await pool.query(
          `
            UPDATE participant_allocation
            SET
              session_status = 'not_started',
              session_opened_at = NULL,
              session_closed_at = NULL,
              completed = FALSE,
              completed_at = NULL,
              updated_at = NOW()
            WHERE participant_id = ANY($1::text[])
            RETURNING participant_id
          `,
          [normalizedIds]
        );
      }

      return {
        reset_count: result.rowCount || 0,
        reset_participant_ids: (result.rows || []).map((row) => String(row.participant_id || '').trim().toUpperCase()).filter(Boolean)
      };
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Participant allocation session reset failed in postgres, using file fallback:', error.message);
    }
  }

  const rows = readParticipantAllocationRecordsFromFile();
  const targets = resetAll
    ? new Set(rows.map((row) => String(row.participant_id || '').trim().toUpperCase()).filter(Boolean))
    : new Set(normalizedIds);

  let resetCount = 0;
  const nowIso = new Date().toISOString();
  const nextRows = rows.map((row) => {
    const participantId = String(row.participant_id || '').trim().toUpperCase();
    if (!participantId || !targets.has(participantId)) {
      return row;
    }

    resetCount += 1;
    return {
      ...row,
      session_status: 'not_started',
      session_opened_at: null,
      session_closed_at: null,
      completed: false,
      completed_at: null,
      updated_at: nowIso
    };
  });

  writeParticipantAllocationRecordsToFile(nextRows);
  return {
    reset_count: resetCount,
    reset_participant_ids: Array.from(targets.values())
  };
};

const readPhysicalTrialRecordsForExport = async (participantId) => {
  if (telemetryUsePostgres) {
    try {
      const postgresRecords = await readPhysicalTrialRecordsPostgres(participantId);
      if (postgresRecords.length > 0 || !telemetryFallbackToFile) {
        return postgresRecords;
      }

      const fileRecords = readPhysicalTrialRecordsFromNdjson(physicalTrialFilePath);
      if (fileRecords.length > 0) {
        console.warn('Physical trial export served from file fallback because postgres returned no records.');
      }
      return fileRecords;
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Physical trial export postgres read failed, using file fallback:', error.message);
      return readPhysicalTrialRecordsFromNdjson(physicalTrialFilePath);
    }
  }

  ensureTelemetryStorage();
  return readPhysicalTrialRecordsFromNdjson(physicalTrialFilePath);
};

const scenarioTaskCapMs = 5 * 60 * 1000;
const shortFormTaskCapMs = 90 * 1000;
const defaultTaskStaleThresholdMs = 15 * 60 * 1000;

const getTaskCapMs = (taskId) => {
  const key = String(taskId || '').trim().toLowerCase();
  if (!key) return null;
  if (/^scenario_card_\d+$/.test(key)) return scenarioTaskCapMs;
  if (/^short_form_q[1-4]$/.test(key)) return shortFormTaskCapMs;
  return null;
};

const buildStaleTaskResult = (participantId, taskId, taskLabel, startedAtIso, startedAtMs) => {
  const nowMs = Date.now();
  const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : null;
  const inferredEndedAtMs = nowMs;

  return {
    participant_id: participantId,
    active_task: null,
    last_task: {
      task_id: String(taskId || '').trim(),
      task_label: String(taskLabel || '').trim(),
      task_status: 'inactive_inferred',
      duration_ms: Number.isFinite(durationMs) ? durationMs : null,
      ended_at: Number.isFinite(inferredEndedAtMs) ? new Date(inferredEndedAtMs).toISOString() : String(startedAtIso || '').trim()
    }
  };
};

const coerceActiveTaskStateOrInferEnded = (participantId, taskId, taskLabel, startedAtValue) => {
  const startedAtIso = startedAtValue ? new Date(startedAtValue).toISOString() : '';
  const startedAtMs = Date.parse(String(startedAtIso || ''));
  const nowMs = Date.now();
  const staleThresholdMs = defaultTaskStaleThresholdMs;

  if (Number.isFinite(startedAtMs) && (nowMs - startedAtMs) > staleThresholdMs) {
    return buildStaleTaskResult(participantId, taskId, taskLabel, startedAtIso, startedAtMs);
  }

  return {
    participant_id: participantId,
    active_task: {
      task_id: String(taskId || '').trim(),
      task_label: String(taskLabel || '').trim(),
      started_at: startedAtIso
    },
    last_task: null
  };
};

const readLatestTaskStatePostgres = async (participantId) => {
  const pool = getTelemetryPgPool();
  const result = await pool.query(
    `
      SELECT
        event_type,
        task_id,
        task_label,
        task_status,
        duration_ms,
        COALESCE("timestamp", received_at) AS event_at
      FROM telemetry_events
      WHERE participant_id = $1
        AND NULLIF(task_id, '') IS NOT NULL
        AND event_type IN ('task_start', 'task_end')
      ORDER BY COALESCE("timestamp", received_at) DESC, id DESC
      LIMIT 1
    `,
    [participantId]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      participant_id: participantId,
      active_task: null,
      last_task: null
    };
  }

  const eventType = String(row.event_type || '').trim().toLowerCase();
  if (eventType === 'task_start') {
    return coerceActiveTaskStateOrInferEnded(
      participantId,
      String(row.task_id || '').trim(),
      String(row.task_label || '').trim(),
      row.event_at
    );
  }

  return {
    participant_id: participantId,
    active_task: null,
    last_task: {
      task_id: String(row.task_id || '').trim(),
      task_label: String(row.task_label || '').trim(),
      task_status: String(row.task_status || '').trim(),
      duration_ms: parseIntegerSafely(row.duration_ms),
      ended_at: row.event_at ? new Date(row.event_at).toISOString() : ''
    }
  };
};

const readLatestTaskStateFromNdjson = (participantId) => {
  const sourcePath = getParticipantTelemetryPath(participantId) || telemetryFilePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      participant_id: participantId,
      active_task: null,
      last_task: null
    };
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = projectTelemetryRecord(JSON.parse(lines[i]));
      const eventType = String(parsed.event_type || '').trim().toLowerCase();
      const taskId = String(parsed.task_id || '').trim();
      if (!taskId || (eventType !== 'task_start' && eventType !== 'task_end')) {
        continue;
      }

      const eventAt = parsed.timestamp || parsed.received_at || '';
      if (eventType === 'task_start') {
        return coerceActiveTaskStateOrInferEnded(
          participantId,
          taskId,
          String(parsed.task_label || '').trim(),
          eventAt
        );
      }

      return {
        participant_id: participantId,
        active_task: null,
        last_task: {
          task_id: taskId,
          task_label: String(parsed.task_label || '').trim(),
          task_status: String(parsed.task_status || '').trim(),
          duration_ms: parseIntegerSafely(parsed.duration_ms),
          ended_at: eventAt ? new Date(eventAt).toISOString() : ''
        }
      };
    } catch {
      // ignore malformed row
    }
  }

  return {
    participant_id: participantId,
    active_task: null,
    last_task: null
  };
};

const readLatestTaskState = async (participantId) => {
  const normalizedParticipant = String(participantId || '').trim();
  if (!normalizedParticipant) {
    return {
      participant_id: '',
      active_task: null,
      last_task: null,
      participant_state: null
    };
  }

  const participantState = buildParticipantStateForTaskState(await readParticipantAllocationRecord(normalizedParticipant));
  const finalizeTaskState = (state) => {
    const baseState = state && typeof state === 'object'
      ? state
      : {
          participant_id: normalizedParticipant,
          active_task: null,
          last_task: null
        };

    if (participantState && participantState.is_terminal) {
      return {
        participant_id: normalizedParticipant,
        active_task: null,
        last_task: null,
        participant_state: participantState
      };
    }

    return {
      participant_id: normalizedParticipant,
      active_task: baseState.active_task || null,
      last_task: baseState.last_task || null,
      participant_state: participantState
    };
  };

  if (telemetryUsePostgres) {
    try {
      const postgresState = await readLatestTaskStatePostgres(normalizedParticipant);
      if (postgresState.active_task || postgresState.last_task || !telemetryFallbackToFile) {
        return finalizeTaskState(postgresState);
      }
      return finalizeTaskState(readLatestTaskStateFromNdjson(normalizedParticipant));
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Task state postgres read failed, using file fallback:', error.message);
      return finalizeTaskState(readLatestTaskStateFromNdjson(normalizedParticipant));
    }
  }

  ensureTelemetryStorage();
  return finalizeTaskState(readLatestTaskStateFromNdjson(normalizedParticipant));
};

const readDistinctParticipantIds = async () => {
  if (telemetryUsePostgres) {
    try {
      const postgresParticipants = await readDistinctParticipantIdsPostgres();
      if (postgresParticipants.length > 0 || !telemetryFallbackToFile) {
        return postgresParticipants;
      }
      return readDistinctParticipantIdsFromNdjson();
    } catch (error) {
      if (!telemetryFallbackToFile) {
        throw error;
      }
      console.error('Distinct participant read failed in postgres, using file fallback:', error.message);
      return readDistinctParticipantIdsFromNdjson();
    }
  }

  return readDistinctParticipantIdsFromNdjson();
};

const forceEndAllActiveTasks = async () => {
  const participantIds = await readDistinctParticipantIds();
  const forced = [];

  for (const participantId of participantIds) {
    const state = await readLatestTaskState(participantId);
    const activeTask = state && state.active_task ? state.active_task : null;
    const activeTaskId = String(activeTask && activeTask.task_id || '').trim();
    if (!activeTaskId) {
      continue;
    }

    const startedAtMs = Date.parse(String(activeTask.started_at || ''));
    const capMs = getTaskCapMs(activeTaskId);
    const rawDurationMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : null;
    const durationMs = Number.isFinite(rawDurationMs)
      ? (Number.isFinite(capMs) ? Math.min(rawDurationMs, capMs) : rawDurationMs)
      : null;
    const nowIso = new Date().toISOString();

    await storeTelemetryRecord({
      participant_id: participantId,
      event_type: 'task_end',
      task_id: activeTaskId,
      task_label: String(activeTask.task_label || '').trim(),
      task_status: 'force_ended_all',
      duration_ms: Number.isFinite(durationMs) ? durationMs : null,
      trial_mode: 'digital',
      timestamp: nowIso,
      received_at: nowIso
    });

    forced.push({
      participant_id: participantId,
      task_id: activeTaskId
    });
  }

  return {
    participants_scanned: participantIds.length,
    forced_count: forced.length,
    forced
  };
};

const withTelemetryCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const buildManualContent = (searchIndex) => searchIndex.pages
  .map(page => `# ${page.title}\n\n${page.description}\n\n${page.content}`)
  .join('\n\n---\n\n');

const buildSectionTitles = (searchIndex) => {
  const titles = (searchIndex.pages || []).flatMap((page) => [
    page.title,
    ...(Array.isArray(page.headings) ? page.headings : [])
  ]);

  return [...new Set(
    titles
      .map((title) => String(title || '').trim())
      .filter(Boolean)
  )];
};

const imageMatchStopwords = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'with', 'from', 'into', 'onto', 'over', 'under',
  'your', 'their', 'this', 'that', 'these', 'those', 'what', 'which', 'when', 'where', 'while', 'will', 'would',
  'could', 'should', 'have', 'has', 'had', 'been', 'being', 'about', 'there', 'here', 'just', 'also', 'only',
  'them', 'they', 'their', 'there', 'does', 'doing', 'done', 'than', 'then', 'into', 'through', 'using', 'used',
  'user', 'guide', 'manual', 'page', 'section', 'please', 'show', 'need', 'want', 'help', 'asks', 'asked', 'question',
  'image', 'images', 'picture', 'photo'
]);

const imageTokenAliases = {
  temp: ['temperature'],
  temperature: ['temp'],
  tube: ['tubing'],
  tubing: ['tube'],
  fit: ['fitting', 'adjust'],
  fitting: ['fit', 'adjust'],
  assemble: ['assembly', 'reassemble'],
  assembly: ['assemble', 'reassemble'],
  reassemble: ['assemble', 'assembly'],
  disassemble: ['disassembly', 'remove'],
  disassembly: ['disassemble', 'remove'],
  instruction: ['instructions', 'steps', 'how'],
  instructions: ['instruction', 'steps', 'how'],
  step: ['steps', 'instruction', 'instructions'],
  steps: ['step', 'instruction', 'instructions'],
  climate: ['ctrl', 'control'],
  ctrl: ['climate', 'control'],
  control: ['climate', 'ctrl'],
  oxygen: ['supplemental'],
  supplemental: ['oxygen'],
  humidity: ['humidifier'],
  humidifier: ['humidity'],
  disconnect: ['remove', 'detach'],
  remove: ['disconnect'],
  connect: ['attach', 'setup'],
  attach: ['connect']
};

const buildSearchIndexPath = path.join(__dirname, 'build-search-index.js');

const commonImageQueryCorrections = {
  masjk: 'mask',
  maks: 'mask',
  devic: 'device',
  humidfier: 'humidifier',
  tubig: 'tubing'
};

const normalizeSearchText = (text) => String(text || '')
  .toLowerCase()
  .replace(/&#10;|\r?\n/g, ' ')
  .replace(/\bset\s+up\b/g, 'setup')
  .replace(/\bset(?:\s+(?:the|this|that|my|your|our|their|his|her|its|it|device|machine|cpap|unit)){1,4}\s+up\b/g, 'setup')
  .replace(/\bturn\s+on\b/g, 'enable')
  .replace(/\bturn\s+off\b/g, 'disable')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/\b[a-z]+\b/g, (token) => commonImageQueryCorrections[token] || token)
  .trim();

const hasExplicitImageIntent = (query) => /\b(image|images|diagram|picture|photo|show|visual|what does it look like|is there an image)\b/i.test(String(query || ''));

const isProceduralImageQuery = (query) => /\b(how|setup|set up|connect|disconnect|attach|remove|adjust|change|return|clean|fit|fitting|assemble|assembly|reassemble|disassemble|disassembly|replace|insert|turn on|turn off)\b/i.test(String(query || ''));

const isFittingQuery = (query) => /\b(fit|fitting|mask fit|fit mask|fit my mask|fit the mask|fitting instructions)\b/i.test(String(query || ''));
const excludesFittingStep = (query) => /\b(before fitting|stop(?:ping)? before fitting|without fitting|not fitting|excluding fitting)\b/i.test(String(query || ''));

const isAssemblyQuery = (query) => /\b(assemble|assembly|reassemble|put the mask together|mask assembly)\b/i.test(String(query || ''));

const isDisassemblyQuery = (query) => /\b(disassemble|disassembly|take the mask apart|remove the mask parts)\b/i.test(String(query || ''));

const isProceduralImageCandidate = (image) => {
  const combined = `${image?.alt || ''} ${image?.context || ''} ${image?.heading || ''} ${image?.pageTitle || ''}`;
  return /\b\d+\.|\b(step|steps|setup|connect|disconnect|attach|remove|adjust|change|return|clean|fit|assembly|reassemble|replace|insert)\b/i.test(combined);
};

const isGenericOverviewImageCandidate = (image) => {
  const combined = `${image?.alt || ''} ${image?.heading || ''} ${image?.pageTitle || ''}`;
  return /\b(overview|about your device|device overview|diagram showing the device|device diagram)\b/i.test(combined);
};

const isComponentDiagramCandidate = (image) => {
  const combined = `${image?.alt || ''} ${image?.heading || ''} ${image?.pageTitle || ''}`;
  return /\b(mask parts|components|component|part diagram|parts diagram|understanding your mask components)\b/i.test(combined);
};

const isFittingImageCandidate = (image) => {
  const combined = `${image?.alt || ''} ${image?.heading || ''} ${image?.pageTitle || ''} ${image?.context || ''}`;
  return /\b(fit your mask|fitting your mask|how to fit|mask fit|fit the mask)\b/i.test(combined);
};

const isAssemblyImageCandidate = (image) => {
  const combined = `${image?.alt || ''} ${image?.heading || ''} ${image?.pageTitle || ''} ${image?.context || ''}`;
  return /\b(mask assembly|assembly diagram|reassembling your mask|how to reassemble)\b/i.test(combined);
};

const isDisassemblyImageCandidate = (image) => {
  const combined = `${image?.alt || ''} ${image?.heading || ''} ${image?.pageTitle || ''} ${image?.context || ''}`;
  return /\b(disassembly for cleaning|disassembly|disassemble|take .* apart|remove the seal|remove the swivel|unhook the headgear clips)\b/i.test(combined);
};

const singularizeToken = (token) => {
  const value = String(token || '');
  if (value.endsWith('ies') && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith('s') && value.length > 4 && !value.endsWith('ss')) {
    return value.slice(0, -1);
  }
  return value;
};

const tokenizeForImageMatch = (text, { expandAliases = false } = {}) => {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return [];
  }

  const tokens = new Set();
  normalized.split(' ').forEach((token) => {
    if (!token || token.length < 3 || imageMatchStopwords.has(token)) {
      return;
    }

    tokens.add(token);
    const singular = singularizeToken(token);
    if (singular && singular !== token && !imageMatchStopwords.has(singular)) {
      tokens.add(singular);
    }

    if (expandAliases) {
      const aliases = imageTokenAliases[token] || imageTokenAliases[singular] || [];
      aliases.forEach((alias) => {
        if (alias && alias.length >= 3 && !imageMatchStopwords.has(alias)) {
          tokens.add(alias);
        }
      });
    }
  });

  return [...tokens];
};

const countTokenMatches = (sourceText, queryTokens) => {
  if (!queryTokens.length) {
    return 0;
  }

  const sourceTokens = new Set(tokenizeForImageMatch(sourceText));
  return queryTokens.reduce((count, token) => count + (sourceTokens.has(token) ? 1 : 0), 0);
};

const extractQueryPhrases = (text) => {
  const rawTokens = normalizeSearchText(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !imageMatchStopwords.has(token));

  const phrases = [];
  for (let i = 0; i < rawTokens.length - 1; i += 1) {
    phrases.push(`${rawTokens[i]} ${rawTokens[i + 1]}`);
  }
  return phrases;
};

const scoreImageCandidate = (query, image) => {
  const queryTokens = tokenizeForImageMatch(query, { expandAliases: true });
  if (!queryTokens.length) {
    return { score: 0, matchedTokenCount: 0 };
  }

  const isProceduralQuery = isProceduralImageQuery(query);
  const isFitQuery = isFittingQuery(query);
  const isAssemblyAsked = isAssemblyQuery(query);
  const isDisassemblyAsked = isDisassemblyQuery(query);
  const excludesFitting = excludesFittingStep(query);

  const altMatches = countTokenMatches(image.alt, queryTokens);
  const contextMatches = countTokenMatches(image.context, queryTokens);
  const headingMatches = countTokenMatches(image.heading, queryTokens);
  const pageMatches = countTokenMatches(image.pageTitle, queryTokens);
  const matchedTokenCount = countTokenMatches(
    `${image.alt} ${image.context} ${image.heading} ${image.pageTitle}`,
    queryTokens
  );

  let score = (altMatches * 3.6)
    + (contextMatches * 2.8)
    + (headingMatches * 2.2)
    + (pageMatches * 1.4)
    + (matchedTokenCount * 0.45);

  const normalizedCombined = normalizeSearchText(`${image.alt} ${image.heading} ${image.context} ${image.pageTitle}`);
  const phraseMatches = extractQueryPhrases(query)
    .filter((phrase) => phrase.length >= 7 && normalizedCombined.includes(phrase));
  score += Math.min(phraseMatches.length, 2) * 1.75;

  if (/\b(image|diagram|picture|photo|show|look|looks|where|which part|what does it look like)\b/i.test(query)) {
    score += 1.2;
  }

  if (/\b(setup|connect|disconnect|attach|remove|adjust|change|return|clean|disconnecting|reconnect|fitting|assembly)\b/i.test(query)) {
    score += 0.6;
  }

  if (isProceduralQuery && isProceduralImageCandidate(image)) {
    score += 2.4;
  }

  if (isProceduralQuery && /\bsetup\b/i.test(`${image.heading} ${image.pageTitle} ${image.alt}`)) {
    score += 2.1;
  }

  if (isProceduralQuery && isGenericOverviewImageCandidate(image) && !isProceduralImageCandidate(image)) {
    score -= 2.2;
  }

  if (isFitQuery && isFittingImageCandidate(image)) {
    score += 4.2;
  }

  if (isFitQuery && isComponentDiagramCandidate(image) && !isFittingImageCandidate(image)) {
    score -= 3.4;
  }

  if (isFitQuery && !isFittingImageCandidate(image) && isProceduralImageCandidate(image)) {
    score -= 1.8;
  }

  if (excludesFitting && isFittingImageCandidate(image)) {
    score -= 6;
  }

  if (isAssemblyAsked && isAssemblyImageCandidate(image)) {
    score += 4.2;
  }

  if (isAssemblyAsked && isComponentDiagramCandidate(image) && !isAssemblyImageCandidate(image)) {
    score -= 2.6;
  }

  if (isDisassemblyAsked && isDisassemblyImageCandidate(image)) {
    score += 4.2;
  }

  if (isDisassemblyAsked && isAssemblyImageCandidate(image)) {
    score -= 2.4;
  }

  return { score, matchedTokenCount };
};

const getPublicGuideOrigin = (req) => {
  const host = String(req?.get?.('host') || '').toLowerCase();
  if (host.includes('localhost') || host.startsWith('127.0.0.1')) {
    return `${req.protocol}://${req.get('host')}`;
  }
  return 'https://medtechguides.uk';
};

const buildPublicGuideUrl = (req, guide, targetPath) => {
  const origin = getPublicGuideOrigin(req);
  const rawTarget = String(targetPath || '').trim();
  if (!rawTarget) {
    return origin;
  }

  if (/^https?:\/\//i.test(rawTarget)) {
    return rawTarget;
  }

  if (rawTarget.startsWith('/')) {
    return `${origin}${rawTarget}`;
  }

  const relativeDir = String(guide?.relativeDir || '').replace(/^\/+|\/+$/g, '');
  const normalizedTarget = rawTarget.replace(/^\/+/, '');
  return `${origin}/${relativeDir}/${normalizedTarget}`;
};

const selectRelevantImage = (query, imageCandidates, req) => {
  if (isSpecOrNumericQuestion(query) && !hasExplicitImageIntent(query)) {
    return null;
  }

  const fitQuery = isFittingQuery(query);

  const dedupedCandidates = [];
  const seenCandidates = new Set();

  (Array.isArray(imageCandidates) ? imageCandidates : []).forEach((image) => {
    const key = `${String(image?.guideKey || '')}::${String(image?.src || '').trim().toLowerCase()}::${normalizeSearchText(image?.alt || '')}`;
    if (!key || seenCandidates.has(key)) {
      return;
    }
    seenCandidates.add(key);
    dedupedCandidates.push(image);
  });

  const scored = dedupedCandidates
    .map((image) => ({ image, ...scoreImageCandidate(query, image) }))
    .filter((entry) => entry.score > 0 && entry.matchedTokenCount > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return null;
  }

  if (fitQuery && !excludesFittingStep(query)) {
    const bestFitting = scored.find((entry) => isFittingImageCandidate(entry.image));
    if (bestFitting && bestFitting.score >= 5) {
      return {
        guide: bestFitting.image.guideName,
        pageTitle: bestFitting.image.pageTitle,
        sectionTitle: bestFitting.image.heading,
        alt: bestFitting.image.alt,
        imageUrl: buildPublicGuideUrl(req, bestFitting.image.guide, bestFitting.image.src),
        pageUrl: buildPublicGuideUrl(req, bestFitting.image.guide, bestFitting.image.pageFile)
      };
    }
  }

  if (isAssemblyQuery(query)) {
    const bestAssembly = scored.find((entry) => isAssemblyImageCandidate(entry.image));
    if (bestAssembly && bestAssembly.score >= 5) {
      return {
        guide: bestAssembly.image.guideName,
        pageTitle: bestAssembly.image.pageTitle,
        sectionTitle: bestAssembly.image.heading,
        alt: bestAssembly.image.alt,
        imageUrl: buildPublicGuideUrl(req, bestAssembly.image.guide, bestAssembly.image.src),
        pageUrl: buildPublicGuideUrl(req, bestAssembly.image.guide, bestAssembly.image.pageFile)
      };
    }
  }

  if (isDisassemblyQuery(query)) {
    const bestDisassembly = scored.find((entry) => isDisassemblyImageCandidate(entry.image));
    if (bestDisassembly && bestDisassembly.score >= 5) {
      return {
        guide: bestDisassembly.image.guideName,
        pageTitle: bestDisassembly.image.pageTitle,
        sectionTitle: bestDisassembly.image.heading,
        alt: bestDisassembly.image.alt,
        imageUrl: buildPublicGuideUrl(req, bestDisassembly.image.guide, bestDisassembly.image.src),
        pageUrl: buildPublicGuideUrl(req, bestDisassembly.image.guide, bestDisassembly.image.pageFile)
      };
    }
  }

  const best = scored[0];
  const second = scored[1];
  const minimumScore = 6.5;
  const minimumMargin = 1.75;

  if (best.score < minimumScore) {
    return null;
  }

  if (second && (best.score - second.score) < minimumMargin) {
    return null;
  }

  return {
    guide: best.image.guideName,
    pageTitle: best.image.pageTitle,
    sectionTitle: best.image.heading,
    alt: best.image.alt,
    imageUrl: buildPublicGuideUrl(req, best.image.guide, best.image.src),
    pageUrl: buildPublicGuideUrl(req, best.image.guide, best.image.pageFile)
  };
};

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
  const buildScriptMtimeMs = fs.statSync(buildSearchIndexPath).mtimeMs;

  let indexMtimeMs = 0;
  if (fs.existsSync(searchIndexPath)) {
    indexMtimeMs = fs.statSync(searchIndexPath).mtimeMs;
  }

  if (!fs.existsSync(searchIndexPath) || latestHtmlMtimeMs > indexMtimeMs || buildScriptMtimeMs > indexMtimeMs) {
    const relativeGuideDir = path.relative(__dirname, guide.dir);
    execFileSync(process.execPath, [buildSearchIndexPath, relativeGuideDir], {
      stdio: 'ignore'
    });
    console.log(`Rebuilt search index for ${guideKey} because source pages or search indexing logic changed.`);
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
  const sectionTitles = buildSectionTitles(searchIndex);
  const images = (searchIndex.pages || []).flatMap((page) =>
    (page.images || []).map((image) => ({
      ...image,
      guide,
      guideKey,
      guideName: guide.name
    }))
  );

  const cached = {
    manualContent,
    guideName: guide.name,
    sectionTitles,
    images,
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
    images: docs.flatMap((doc) => doc.images || []),
    sectionTitles: [...new Set(docs.flatMap((doc) => doc.sectionTitles || []))],
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

const guideEntityAliases = {
  'airsense-10': [
    'airsense',
    'airsense 10',
    'resmed airsense',
    'resmed airsense 10'
  ],
  'fp-vitera': [
    'vitera',
    'f&p vitera',
    'fisher & paykel vitera',
    'fisher and paykel vitera'
  ],
  climatelineair: [
    'climatelineair',
    'climateline air',
    'resmed climatelineair'
  ]
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsAlias = (text, aliases) => {
  const normalized = String(text || '').toLowerCase();
  if (!normalized || !Array.isArray(aliases) || !aliases.length) {
    return false;
  }

  return aliases.some((alias) => {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}([^a-z0-9]|$)`, 'i');
    return pattern.test(normalized);
  });
};

const getMentionedGuideKeys = (text) => {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return [];

  const mentioned = [];
  for (const [guideKey, aliases] of Object.entries(guideEntityAliases)) {
    const hasAlias = containsAlias(normalized, aliases);

    if (hasAlias) {
      mentioned.push(guideKey);
    }
  }

  return mentioned;
};

const getOutOfScopeGuideResponse = (message, guideKeys) => {
  if (!Array.isArray(guideKeys) || guideKeys.length !== 1) {
    return null;
  }

  const activeGuideKey = guideKeys[0];
  const mentionedGuideKeys = getMentionedGuideKeys(message);
  const conflictingGuide = mentionedGuideKeys.find((key) => key !== activeGuideKey);
  if (!conflictingGuide) {
    return null;
  }

  const activeGuideName = guideConfigs[activeGuideKey] && guideConfigs[activeGuideKey].name
    ? guideConfigs[activeGuideKey].name
    : activeGuideKey;
  const conflictingGuideName = guideConfigs[conflictingGuide] && guideConfigs[conflictingGuide].name
    ? guideConfigs[conflictingGuide].name
    : conflictingGuide;

  return `Your question mentions ${conflictingGuideName}, but this chat is currently scoped to ${activeGuideName}. I can only answer from the selected guide. Please switch guides or ask a ${activeGuideName} question.`;
};

const isSpecOrNumericQuestion = (message) => {
  const text = String(message || '').toLowerCase();
  if (!text) return false;

  return /temperature|storage|transport|spec|specification|range|length|pressure|compatib|sufficient|long enough|cm\b|mm\b|\bm\b|ft\b|feet|inch|inches|°c|°f|hpa|cmh\s*2o/.test(text);
};

const extractSectionTitlesFromManualContent = (manualContent) => {
  const titles = [];
  const matches = String(manualContent || '').matchAll(/^#\s+(.+)$/gm);
  for (const match of matches) {
    const title = String(match[1] || '').trim();
    if (title) {
      titles.push(title);
    }
  }
  return [...new Set(titles)];
};

const extractQuotedSectionCitations = (response) => {
  const text = String(response || '');
  const citations = [];
  const patterns = [
    /["“]([^"”]{2,120})["”]\s+section/gi,
    /section\s+["“]([^"”]{2,120})["”]/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const title = String(match[1] || '').trim();
      if (title) {
        citations.push(title);
      }
    }
  }

  return [...new Set(citations)];
};

const getScopeValidationFallback = (message, response, guideKeys, manualContent, indexedSectionTitles = []) => {
  if (!Array.isArray(guideKeys) || guideKeys.length !== 1) {
    return null;
  }

  const activeGuideKey = guideKeys[0];
  const activeGuideName = guideConfigs[activeGuideKey] && guideConfigs[activeGuideKey].name
    ? guideConfigs[activeGuideKey].name
    : activeGuideKey;

  const responseMentionedGuideKeys = getMentionedGuideKeys(response);
  const responseConflict = responseMentionedGuideKeys.find((key) => key !== activeGuideKey);
  if (responseConflict) {
    return `I couldn't verify that answer strictly within ${activeGuideName}. Please rephrase your question for this guide or switch to the relevant guide.`;
  }

  if (!isSpecOrNumericQuestion(message)) {
    return null;
  }

  const sectionTitles = Array.isArray(indexedSectionTitles) && indexedSectionTitles.length
    ? indexedSectionTitles
    : extractSectionTitlesFromManualContent(manualContent);
  const quotedCitations = extractQuotedSectionCitations(response);
  const hasInvalidCitation = quotedCitations.some((citation) => {
    const normalizedCitation = citation.toLowerCase();
    return !sectionTitles.some((title) => {
      const normalizedTitle = String(title || '').toLowerCase();
      return normalizedTitle === normalizedCitation
        || normalizedTitle.replace(/^\d+\.\s*/, '') === normalizedCitation
        || normalizedCitation.replace(/^\d+\.\s*/, '') === normalizedTitle;
    });
  });

  if (hasInvalidCitation) {
    return `I couldn't verify that section citation in ${activeGuideName}. Please ask again and I will answer only with section titles that appear in this guide.`;
  }

  return null;
};

const responseIndicatesNoDirectInstruction = (response) => /manual does not provide specific instructions|manual does not contain .*instructions|does not provide specific guidance/i.test(String(response || ''));

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

const CHAT_TEMPERATURE = Number.parseFloat(process.env.CHAT_TEMPERATURE || '0.2');

const buildSystemPrompt = (guideName, manualContent) => `You are a helpful assistant for the ${guideName} user manual.
Answer questions using only the manual content below. Be concise, accurate, and cite the exact manual section title(s) that support your answer.
If the manual does not contain the needed information, say so clearly.

Rules:
1) For questions that include measurements (for example ft, feet, inches, m, cm), do explicit unit conversion and comparison before concluding.
2) If asked whether something is sufficient/long enough/compatible, state "sufficient" or "insufficient" and include the compared values.
3) If the required distance is greater than the stated tubing length, answer "insufficient" and quantify the shortfall.
4) Only cite section titles that contain the supporting fact (for example cite "Technical Specifications" for tubing length if that is where it appears).
5) Do not infer facts that are not stated in the manual.
6) For imperial outputs, prefer feet and inches format (for example 6 ft 6 in) instead of decimal feet unless the user explicitly asks for decimal values.
7) Keep conversions readable and concise; avoid unnecessary precision.
8) Preserve the manual's original measurement wording when it already answers the question; do not restate the same value in another unit unless needed for comparison clarity or explicitly requested by the user.

Manual Content:
${manualContent}`;

/**
 * Call Hugging Face Inference API
 */
async function callHuggingFace(userMessage, manualContent, guideName) {
  const systemPrompt = buildSystemPrompt(guideName, manualContent);

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
        temperature: CHAT_TEMPERATURE
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
      temperature: CHAT_TEMPERATURE
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
      temperature: CHAT_TEMPERATURE
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
      temperature: CHAT_TEMPERATURE
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
  const systemPrompt = buildSystemPrompt(guideName, manualContent);

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
        temperature: CHAT_TEMPERATURE
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

    const outOfScopeGuideResponse = getOutOfScopeGuideResponse(message, guideKeys);
    if (outOfScopeGuideResponse) {
      console.log(`[${new Date().toISOString()}] Guides: ${guideKeys.join(', ')}`);
      console.log(`[${new Date().toISOString()}] Assistant: ${outOfScopeGuideResponse.substring(0, 100)}...`);
      return res.json({ response: outOfScopeGuideResponse });
    }

    const deterministicResponse = getDeterministicErrorCodeResponse(message, guideKeys);
    if (deterministicResponse) {
      console.log(`[${new Date().toISOString()}] Guides: ${guideKeys.join(', ')}`);
      console.log(`[${new Date().toISOString()}] Assistant: ${deterministicResponse.substring(0, 100)}...`);
      return res.json({ response: deterministicResponse });
    }

    const { manualContent, guideName, images, sectionTitles } = loadManualBundle(guideKeys);

    let response;
    if (LLM_PROVIDER === 'openai') {
      response = await callOpenAI(message, manualContent, guideName);
    } else {
      response = await callHuggingFace(message, manualContent, guideName);
    }

    const scopeValidationFallback = getScopeValidationFallback(message, response, guideKeys, manualContent, sectionTitles);
    if (scopeValidationFallback) {
      response = scopeValidationFallback;
    }

    const image = responseIndicatesNoDirectInstruction(response)
      ? null
      : selectRelevantImage(message, images, req);

    console.log(`[${new Date().toISOString()}] Guides: ${guideKeys.join(', ')}`);
    console.log(`[${new Date().toISOString()}] Assistant: ${response.substring(0, 100)}...`);

    res.json({ response, image });
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

app.options('/api/telemetry/force-end-all', (req, res) => {
  withTelemetryCors(res);
  res.status(204).end();
});

app.options('/api/physical-trial', (req, res) => {
  withTelemetryCors(res);
  res.status(204).end();
});

app.options('/api/observer-notes', (req, res) => {
  withTelemetryCors(res);
  res.status(204).end();
});

app.options('/api/participant-allocation', (req, res) => {
  withTelemetryCors(res);
  res.status(204).end();
});

app.options('/api/participant-allocation/reset-statuses', (req, res) => {
  withTelemetryCors(res);
  res.status(204).end();
});

app.get('/api/participant-allocation', async (req, res) => {
  withTelemetryCors(res);

  try {
    const rows = await readParticipantAllocationRecords();
    res.status(200).json({ rows });
  } catch (error) {
    console.error('Participant allocation read error:', error);
    res.status(500).json({ error: 'Failed to read participant allocation' });
  }
});

app.post('/api/participant-allocation', async (req, res) => {
  withTelemetryCors(res);

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : null;
    const participantId = String(payload && payload.participant_id || '').trim().toUpperCase();
    const actionRaw = String(payload && payload.action || '').trim().toLowerCase();
    const completed = parseBooleanSafely(payload && payload.completed);
    const allocationGroup = String(payload && payload.allocation_group || '').trim().toLowerCase();
    const action = actionRaw || (completed !== null ? 'set_completed' : '');

    if (!participantId) {
      return res.status(400).json({ error: 'participant_id is required' });
    }

    if (!['set_completed', 'open_session', 'close_session', 'set_allocation_group'].includes(action)) {
      return res.status(400).json({ error: 'action must be set_completed, open_session, close_session, or set_allocation_group' });
    }

    if (action === 'set_completed' && completed === null) {
      return res.status(400).json({ error: 'completed must be true or false when action is set_completed' });
    }

    if (action === 'set_allocation_group' && !['physical', 'digital'].includes(allocationGroup)) {
      return res.status(400).json({ error: 'allocation_group must be physical or digital when action is set_allocation_group' });
    }

    const updated = await updateParticipantAllocationRecord(participantId, action, completed, allocationGroup);
    res.status(200).json({ row: updated });
  } catch (error) {
    const message = String(error && error.message || '');
    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    console.error('Participant allocation update error:', error);
    res.status(500).json({ error: 'Failed to update participant allocation' });
  }
});

app.post('/api/participant-allocation/reset-statuses', async (req, res) => {
  withTelemetryCors(res);

  try {
    const providedResetPassword = String(req.headers['x-reset-password'] || '').trim();
    if (!providedResetPassword || providedResetPassword !== participantAllocationResetPassword) {
      return res.status(403).json({ error: 'Reset password is required' });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const resetAll = parseBooleanSafely(payload.reset_all) === true;
    const participantIds = Array.isArray(payload.participant_ids) ? payload.participant_ids : [];

    if (!resetAll && participantIds.length === 0) {
      return res.status(400).json({ error: 'participant_ids is required unless reset_all is true' });
    }

    const result = await resetParticipantAllocationSessionStatuses(participantIds, resetAll);
    const rows = await readParticipantAllocationRecords();
    res.status(200).json({
      reset_count: result.reset_count,
      reset_participant_ids: result.reset_participant_ids,
      rows
    });
  } catch (error) {
    console.error('Participant allocation reset statuses error:', error);
    res.status(500).json({ error: 'Failed to reset participant session statuses' });
  }
});

app.post('/api/physical-trial', async (req, res) => {
  withTelemetryCors(res);

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : null;
    const participantId = String(payload && payload.participant_id || '').trim();
    const taskId = String(payload && payload.task_id || '').trim();
    const eventType = String(payload && payload.event_type || '').trim();
    const durationMs = parseIntegerSafely(payload && payload.duration_ms);

    if (!payload || !participantId || !taskId || !eventType) {
      return res.status(400).json({ error: 'participant_id, task_id, and event_type are required' });
    }

    const allowedEventTypes = new Set(['task_start', 'task_end', 'page_mark', 'note']);
    if (!allowedEventTypes.has(eventType)) {
      return res.status(400).json({ error: 'event_type must be one of task_start, task_end, page_mark, note' });
    }

    ensureTelemetryStorage();

    const record = projectPhysicalTrialRecord({
      ...payload,
      participant_id: participantId,
      task_id: taskId,
      event_type: eventType,
      duration_ms: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
      source: 'physical_manual',
      received_at: new Date().toISOString(),
      timestamp: payload.timestamp || new Date().toISOString()
    });

    if (!isDedicatedQuestionnaireTaskId(taskId)) {
      await storePhysicalTrialRecord(record);
    }
    await storeQuestionnaireRecord(record);

    if (taskId === 'post-trial-questionnaire' && eventType === 'note') {
      await updateParticipantAllocationRecord(participantId, 'close_session');
      await updateParticipantAllocationRecord(participantId, 'set_completed', true);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Physical trial write error:', error);
    res.status(500).json({ error: 'Failed to store physical trial event' });
  }
});

app.post('/api/observer-notes', async (req, res) => {
  withTelemetryCors(res);

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : null;
    const participantId = String(payload && payload.participant_id || '').trim();
    const taskId = String(payload && payload.task_id || '').trim();
    const actionType = String(payload && payload.action_type || '').trim().toLowerCase();
    const manualPage = String(payload && payload.manual_page || '').trim();
    const notes = String(payload && payload.notes || '').trim();
    const errorSeverity = String(payload && payload.error_severity || '').trim().toLowerCase();
    const errorText = String(payload && payload.error_text || '').trim();
    const criterionId = String(payload && payload.criterion_id || '').trim();
    const criterionLabel = String(payload && payload.criterion_label || '').trim();
    const criterionOutcome = String(payload && payload.criterion_outcome || '').trim().toLowerCase();
    const criterionStepTimeMs = parseIntegerSafely(payload && payload.criterion_step_time_ms);
    const scenarioScore = parseIntegerSafely(payload && payload.scenario_score);
    const taskLengthMs = parseIntegerSafely(payload && payload.task_length_ms);
    const helpInstancesCount = parseIntegerSafely(payload && payload.help_instances_count);
    const trialModeRaw = String(payload && payload.trial_mode || '').trim().toLowerCase();
    const trialMode = trialModeRaw === 'digital' ? 'digital' : (trialModeRaw === 'physical' ? 'physical' : null);

    if (!payload || !participantId || !taskId || !actionType) {
      return res.status(400).json({ error: 'participant_id, task_id, and action_type are required' });
    }

    const allowedActionTypes = new Set(['task_start', 'task_end', 'page_mark', 'scenario_score', 'note', 'error', 'step_mark']);
    if (!allowedActionTypes.has(actionType)) {
      return res.status(400).json({ error: 'action_type must be one of task_start, task_end, page_mark, scenario_score, note, error, step_mark' });
    }

    if (!trialMode) {
      return res.status(400).json({ error: 'trial_mode is required and must be physical or digital' });
    }

    if (actionType === 'page_mark' && !manualPage) {
      return res.status(400).json({ error: 'manual_page (page/section) is required for page_mark' });
    }

    if (actionType === 'scenario_score') {
      if (!/^scenario_card_\d+$/i.test(taskId) && !/^short_form_q[1-4]$/i.test(taskId)) {
        return res.status(400).json({ error: 'scenario_score is only valid for scenario_card or short_form_q tasks' });
      }
      if (!Number.isFinite(scenarioScore) || scenarioScore < 0 || scenarioScore > 2) {
        return res.status(400).json({ error: 'scenario_score must be 0, 1, or 2' });
      }
    }

    if (actionType === 'note' && !notes) {
      return res.status(400).json({ error: 'notes is required for note action_type' });
    }

    if (actionType === 'error') {
      if (!['minor', 'major'].includes(errorSeverity)) {
        return res.status(400).json({ error: 'error_severity is required for error action_type and must be minor or major' });
      }

      if (!errorText) {
        return res.status(400).json({ error: 'error_text is required for error action_type' });
      }
    }

    if (actionType === 'step_mark') {
      if (!/^scenario_card_[1-3]$/i.test(taskId)) {
        return res.status(400).json({ error: 'step_mark is only valid for scenario_card_1 to scenario_card_3 tasks' });
      }

      if (!criterionId || !criterionLabel) {
        return res.status(400).json({ error: 'criterion_id and criterion_label are required for step_mark action_type' });
      }

      if (!['correct', 'incorrect'].includes(criterionOutcome)) {
        return res.status(400).json({ error: 'criterion_outcome is required for step_mark action_type and must be correct or incorrect' });
      }

      if (criterionStepTimeMs === null || criterionStepTimeMs < 0) {
        return res.status(400).json({ error: 'criterion_step_time_ms is required for step_mark action_type and must be >= 0' });
      }
    }

    if (actionType === 'task_end' && (taskLengthMs === null || taskLengthMs < 0)) {
      return res.status(400).json({ error: 'task_length_ms is required for task_end and must be >= 0' });
    }

    if (actionType === 'task_end' && (helpInstancesCount === null || helpInstancesCount < 0)) {
      return res.status(400).json({ error: 'help_instances_count is required for task_end and must be >= 0' });
    }

    if (helpInstancesCount !== null && helpInstancesCount < 0) {
      return res.status(400).json({ error: 'help_instances_count must be >= 0 when provided' });
    }

    ensureTelemetryStorage();

    const record = projectObserverNoteRecord({
      ...payload,
      participant_id: participantId,
      task_id: taskId,
      action_type: actionType,
      error_severity: actionType === 'error' ? errorSeverity : null,
      error_text: actionType === 'error' ? errorText : '',
      scenario_score: actionType === 'scenario_score' ? scenarioScore : null,
      task_length_ms: actionType === 'task_end' ? taskLengthMs : null,
      help_instances_count: helpInstancesCount !== null ? helpInstancesCount : 0,
      source: 'observations_logger',
      trial_mode: trialMode,
      received_at: new Date().toISOString(),
      timestamp: payload.timestamp || new Date().toISOString()
    });

    if (actionType === 'step_mark') {
      await storeObserverStepMarkRecord({
        ...payload,
        received_at: new Date().toISOString(),
        timestamp: payload.timestamp || new Date().toISOString(),
        session_id: String(payload.session_id || '').trim(),
        participant_id: participantId,
        task_id: taskId,
        task_label: String(payload.task_label || '').trim(),
        criterion_id: criterionId,
        criterion_label: criterionLabel,
        criterion_outcome: criterionOutcome,
        criterion_step_time_ms: criterionStepTimeMs,
        observer_note: notes,
        source: 'observations_logger',
        trial_mode: trialMode,
        action_type: actionType
      });
    } else {
      await storeObserverNoteRecord(record);
    }
    res.status(204).end();
  } catch (error) {
    console.error('Observer notes write error:', error);
    res.status(500).json({ error: 'Failed to store observer note' });
  }
});

app.post('/api/telemetry', async (req, res) => {
  withTelemetryCors(res);

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : null;
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

app.post('/api/telemetry/force-end-all', async (req, res) => {
  withTelemetryCors(res);

  try {
    const result = await forceEndAllActiveTasks();
    res.status(200).json(result);
  } catch (error) {
    console.error('Force end all tasks error:', error);
    res.status(500).json({ error: 'Failed to force-end active tasks' });
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

app.get('/api/telemetry/task-state', async (req, res) => {
  withTelemetryCors(res);

  try {
    const participantId = String(req.query.participant_id || '').trim();
    if (!participantId) {
      return res.status(400).json({ error: 'participant_id is required' });
    }

    const state = await readLatestTaskState(participantId);
    res.status(200).json(state);
  } catch (error) {
    console.error('Task state read error:', error);
    res.status(500).json({ error: 'Failed to read task state' });
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

app.get('/api/physical-trial/export.csv', async (req, res) => {
  withTelemetryCors(res);

  try {
    const participantId = String(req.query.participant_id || '').trim();
    const records = await readPhysicalTrialRecordsForExport(participantId);
    const csv = buildPhysicalTrialCsv(records);

    const filename = participantId
      ? `physical-trial-${sanitizeParticipantId(participantId)}.csv`
      : 'physical-trial-events.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Physical trial export error:', error);
    res.status(500).json({ error: 'Failed to export physical trial events' });
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