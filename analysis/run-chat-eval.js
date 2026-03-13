#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const rootDir = path.join(__dirname, '..');
const casesPath = path.join(__dirname, 'chat-eval-cases.json');
const setupConfigPath = path.join(rootDir, 'chat-setup-config.json');
const baseUrl = process.env.CHAT_EVAL_BASE_URL || 'http://localhost:3000';
const databaseUrl = process.env.DATABASE_URL;
const family = 'cpap';
const scopeFallbackPattern = /couldn't verify that answer strictly within|question mentions .* this chat is currently scoped/i;
const noDirectInstructionPattern = /manual does not provide specific instructions|manual does not provide specific information|manual does not contain .*instructions|does not provide specific guidance|does not provide .*information|does not mention .*instructions|does not describe .*instructions/i;

const setupConfig = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8'));
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const guides = Object.entries(setupConfig.guides || {}).map(([key, guide]) => ({ key, ...guide }));

const normalizeTitle = (title) => String(title || '').trim().toLowerCase().replace(/^\d+\.\s*/, '');

const ensureDatabaseUrl = () => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Example: set DATABASE_URL=postgres://user:pass@host:5432/dbname');
  }
};

const createPool = () => new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
});

const ensureChatEvalTables = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_eval_runs (
      id BIGSERIAL PRIMARY KEY,
      run_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      base_url TEXT NOT NULL,
      family TEXT,
      case_count INTEGER NOT NULL,
      guide_count INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_eval_results (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES chat_eval_runs(id) ON DELETE CASCADE,
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guide_key TEXT NOT NULL,
      guide_name TEXT NOT NULL,
      case_id INTEGER NOT NULL,
      case_label TEXT NOT NULL,
      category TEXT,
      question TEXT NOT NULL,
      duration_ms INTEGER,
      response TEXT,
      error_text TEXT,
      has_scope_fallback BOOLEAN NOT NULL DEFAULT FALSE,
      has_no_direct_instruction_fallback BOOLEAN NOT NULL DEFAULT FALSE,
      image_attached BOOLEAN NOT NULL DEFAULT FALSE,
      image_page_title TEXT,
      image_alt TEXT,
      cited_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      invalid_citations JSONB NOT NULL DEFAULT '[]'::jsonb,
      mentions_other_guides JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_eval_results_run_case ON chat_eval_results (run_id, guide_key, case_id);');
};

const insertRun = async (pool) => {
  const result = await pool.query(
    `
      INSERT INTO chat_eval_runs (base_url, family, case_count, guide_count)
      VALUES ($1, $2, $3, $4)
      RETURNING id, run_started_at;
    `,
    [baseUrl, family, cases.length, guides.length]
  );
  return result.rows[0];
};

const insertResult = async (pool, runId, item) => {
  await pool.query(
    `
      INSERT INTO chat_eval_results (
        run_id,
        guide_key,
        guide_name,
        case_id,
        case_label,
        category,
        question,
        duration_ms,
        response,
        error_text,
        has_scope_fallback,
        has_no_direct_instruction_fallback,
        image_attached,
        image_page_title,
        image_alt,
        cited_sections,
        invalid_citations,
        mentions_other_guides
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb
      );
    `,
    [
      runId,
      item.guideKey,
      item.guideName,
      item.id,
      item.label,
      item.category,
      item.question,
      Number.isFinite(item.durationMs) ? item.durationMs : null,
      item.response || '',
      item.error || null,
      Boolean(item.validation.hasScopeFallback),
      Boolean(item.validation.hasNoDirectInstructionFallback),
      Boolean(item.validation.imageAttached),
      item.validation.imagePageTitle || '',
      item.validation.imageAlt || '',
      JSON.stringify(item.validation.citedSections || []),
      JSON.stringify(item.validation.invalidCitations || []),
      JSON.stringify(item.validation.mentionsOtherGuides || [])
    ]
  );
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

const getGuideAliases = () => ({
  'airsense-10': ['airsense', 'airsense 10', 'resmed airsense', 'resmed airsense 10'],
  'fp-vitera': ['vitera', 'f&p vitera', 'fisher & paykel vitera', 'fisher and paykel vitera'],
  climatelineair: ['climatelineair', 'climateline air', 'resmed climatelineair']
});

const containsAlias = (text, alias) => {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(String(text || '').toLowerCase());
};

const getMentionedOtherGuides = (response, activeGuideKey) => {
  const aliasesByGuide = getGuideAliases();
  const mentioned = [];
  for (const [guideKey, aliases] of Object.entries(aliasesByGuide)) {
    if (guideKey === activeGuideKey) continue;
    if (aliases.some((alias) => containsAlias(response, alias))) {
      mentioned.push(guideKey);
    }
  }
  return mentioned;
};

const loadSectionTitlesByGuide = () => {
  const map = new Map();
  guides.forEach((guide) => {
    const searchIndexPath = path.join(rootDir, guide.relativeDir, 'search-index.json');
    const searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8'));
    const titles = (searchIndex.pages || []).flatMap((page) => [
      page.title,
      ...(Array.isArray(page.headings) ? page.headings : [])
    ]).map((title) => String(title || '').trim()).filter(Boolean);
    map.set(guide.key, [...new Set(titles)]);
  });
  return map;
};

const sectionTitlesByGuide = loadSectionTitlesByGuide();

const validateResponse = (guideKey, payload) => {
  const response = String(payload?.response || '');
  const image = payload?.image || null;
  const sectionTitles = sectionTitlesByGuide.get(guideKey) || [];
  const normalizedTitles = new Set(sectionTitles.map(normalizeTitle));
  const citedSections = extractQuotedSectionCitations(response);
  const invalidCitations = citedSections.filter((citation) => !normalizedTitles.has(normalizeTitle(citation)));
  const otherGuides = getMentionedOtherGuides(response, guideKey);

  return {
    hasScopeFallback: scopeFallbackPattern.test(response),
    hasNoDirectInstructionFallback: noDirectInstructionPattern.test(response),
    citedSections,
    invalidCitations,
    mentionsOtherGuides: otherGuides,
    imageAttached: Boolean(image),
    imagePageTitle: image?.pageTitle || '',
    imageAlt: image?.alt || ''
  };
};

const postQuestion = async (guideKey, question) => {
  const start = Date.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: question,
      guide: guideKey,
      family
    })
  });

  const durationMs = Date.now() - start;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  const payload = await response.json();
  return { payload, durationMs };
};

const main = async () => {
  ensureDatabaseUrl();

  const pool = createPool();
  await ensureChatEvalTables(pool);
  const runRecord = await insertRun(pool);

  const groupedResults = [];
  const flatResults = [];

  try {
    for (const guide of guides) {
      const guideResults = [];
      console.log(`\n=== ${guide.name} (${guide.key}) ===`);

      for (const testCase of cases) {
        try {
          const { payload, durationMs } = await postQuestion(guide.key, testCase.question);
          const validation = validateResponse(guide.key, payload);
          const result = {
            ...testCase,
            guideKey: guide.key,
            guideName: guide.name,
            durationMs,
            response: String(payload.response || ''),
            image: payload.image || null,
            validation
          };
          guideResults.push(result);
          flatResults.push(result);
          await insertResult(pool, runRecord.id, result);
          console.log(`- Case ${testCase.id}: ${durationMs} ms${validation.hasScopeFallback ? ' [scope-fallback]' : ''}${validation.invalidCitations.length ? ' [invalid-citation]' : ''}`);
        } catch (error) {
          const result = {
            ...testCase,
            guideKey: guide.key,
            guideName: guide.name,
            durationMs: null,
            response: '',
            image: null,
            validation: {
              hasScopeFallback: false,
              hasNoDirectInstructionFallback: false,
              citedSections: [],
              invalidCitations: [],
              mentionsOtherGuides: [],
              imageAttached: false,
              imagePageTitle: '',
              imageAlt: ''
            },
            error: error.message
          };
          guideResults.push(result);
          flatResults.push(result);
          await insertResult(pool, runRecord.id, result);
          console.error(`- Case ${testCase.id}: ERROR ${error.message}`);
        }
      }

      groupedResults.push({
        guideKey: guide.key,
        guideName: guide.name,
        results: guideResults
      });
    }

    console.log(`\nSaved to SQL:`);
    console.log(`- run_id: ${runRecord.id}`);
    console.log(`- run_started_at: ${runRecord.run_started_at}`);
    console.log(`- table: chat_eval_results`);
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
