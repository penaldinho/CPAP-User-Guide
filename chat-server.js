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

const excludedHtmlFiles = new Set(['chat.html', 'chat-setup.html', 'search.html']);

const baseDir = guideConfigs[defaultGuide].dir;

const app = express();
app.use(express.json());
app.use(express.static(baseDir));
app.use('/CPAP-devices', express.static(path.join(__dirname, 'CPAP-devices')));
app.use('/images', express.static(path.join(__dirname, 'images')));

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

const parseExplicitErrorCode = (message) => {
  const text = String(message || '');
  const match = text.match(/\berror\s*[-: ]?\s*(\d{3})\b/i);
  if (!match) return null;
  return match[1];
};

const getDeterministicErrorCodeResponse = (message, guideKeys) => {
  const errorCode = parseExplicitErrorCode(message);
  if (!errorCode) return null;

  const isAirsenseGuide = Array.isArray(guideKeys) && guideKeys.includes('airsense-10');
  if (!isAirsenseGuide) return null;

  if (errorCode === '004') {
    return null;
  }

  if (/^0\d{2}$/.test(errorCode)) {
    return 'For “System fault, refer to user guide, Error ' + errorCode + '”, this is treated as an Error 0XX case. Contact your care provider and do not open the device.';
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