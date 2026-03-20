#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const OUTPUT_DIR = path.join(__dirname, '..', 'analysis-output');
const TABLES_DIR = path.join(OUTPUT_DIR, 'tables');
const REPORTS_DIR = path.join(OUTPUT_DIR, 'reports');
const FIGURES_DIR = path.join(OUTPUT_DIR, 'figures');
const CHAT_EVAL_DIR = path.join(OUTPUT_DIR, 'chat-eval');

const ANALYSIS_QUERY = `
WITH participant_pool AS (
  SELECT DISTINCT participant_id
  FROM (
    SELECT participant_id FROM analysis_participant_allocation
    UNION ALL
    SELECT participant_id FROM analysis_telemetry_events
    UNION ALL
    SELECT participant_id FROM analysis_physical_trial_events
    UNION ALL
    SELECT participant_id FROM analysis_observer_notes
    UNION ALL
    SELECT participant_id FROM analysis_observer_step_marks
    UNION ALL
    SELECT participant_id FROM analysis_short_form_result_scores
    UNION ALL
    SELECT participant_id FROM analysis_pre_trial_questionnaire
    UNION ALL
    SELECT participant_id FROM analysis_post_trial_questionnaire
  ) src
  WHERE NULLIF(TRIM(participant_id), '') IS NOT NULL
),
mode_guess AS (
  SELECT
    participant_id,
    CASE
      WHEN SUM(CASE WHEN trial_mode = 'physical' THEN 1 ELSE 0 END) > SUM(CASE WHEN trial_mode = 'digital' THEN 1 ELSE 0 END)
        THEN 'physical'
      WHEN SUM(CASE WHEN trial_mode = 'digital' THEN 1 ELSE 0 END) > 0
        THEN 'digital'
      ELSE NULL
    END AS inferred_mode
  FROM (
    SELECT participant_id, trial_mode FROM analysis_telemetry_events
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_physical_trial_events
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_short_form_results
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_observer_notes
    UNION ALL
    SELECT participant_id, trial_mode FROM analysis_observer_step_marks
  ) modes
  WHERE NULLIF(TRIM(participant_id), '') IS NOT NULL
  GROUP BY participant_id
),
participants AS (
  SELECT
    p.participant_id,
    COALESCE(
      pa.allocation_group,
      mg.inferred_mode,
      'digital'
    ) AS allocation_group
  FROM participant_pool p
  LEFT JOIN analysis_participant_allocation pa
    ON pa.participant_id = p.participant_id
  LEFT JOIN mode_guess mg
    ON mg.participant_id = p.participant_id
),
scenario_scores AS (
  SELECT
    participant_id,
    AVG(scenario_score::DOUBLE PRECISION) AS scenario_avg_score
  FROM analysis_observer_notes
  WHERE action_type = 'scenario_score'
    AND task_id LIKE 'scenario_card_%'
    AND scenario_score IS NOT NULL
  GROUP BY participant_id
),
scenario_task_end AS (
  SELECT
    participant_id,
    COUNT(*) AS scenario_task_count,
    SUM(COALESCE(task_length_ms, 0)::DOUBLE PRECISION) / 1000.0 AS scenario_total_time_seconds,
    AVG(COALESCE(task_length_ms, 0)::DOUBLE PRECISION) / 1000.0 AS scenario_avg_time_seconds
  FROM analysis_observer_notes
  WHERE action_type = 'task_end'
    AND task_id LIKE 'scenario_card_%'
  GROUP BY participant_id
),
scenario_errors AS (
  SELECT
    participant_id,
    COUNT(*) AS scenario_error_count,
    COUNT(*) FILTER (WHERE error_severity = 'major') AS scenario_major_error_count
  FROM analysis_observer_notes
  WHERE action_type = 'error'
    AND task_id LIKE 'scenario_card_%'
  GROUP BY participant_id
),
scenario_help_per_task AS (
  SELECT
    participant_id,
    task_id,
    MAX(COALESCE(help_instances_count, 0)) AS help_instances_count
  FROM analysis_observer_notes
  WHERE task_id LIKE 'scenario_card_%'
  GROUP BY participant_id, task_id
),
scenario_help AS (
  SELECT
    participant_id,
    SUM(help_instances_count)::BIGINT AS scenario_help_count
  FROM scenario_help_per_task
  GROUP BY participant_id
),
scenario_steps AS (
  SELECT
    participant_id,
    COUNT(*) AS step_mark_count,
    AVG(CASE WHEN criterion_outcome = 'correct' THEN 1.0 ELSE 0.0 END) AS step_accuracy
  FROM analysis_observer_step_marks
  WHERE task_id LIKE 'scenario_card_%'
  GROUP BY participant_id
),
short_form AS (
  SELECT
    participant_id,
    COUNT(*) AS short_form_question_count,
    AVG(COALESCE(all_parts_correct_binary, 0)::DOUBLE PRECISION) AS short_form_binary_accuracy,
    AVG(COALESCE(proportion_correct, 0)::DOUBLE PRECISION) AS short_form_proportion_accuracy,
    AVG(NULLIF(duration_ms, 0)::DOUBLE PRECISION) / 1000.0 AS short_form_avg_duration_seconds
  FROM analysis_short_form_result_scores
  GROUP BY participant_id
),
pre_q AS (
  SELECT *
  FROM (
    SELECT
      participant_id,
      q6_digital_literacy,
      q7_digital_guidance,
      q8_physical_guidance,
      q9_problem_solving,
      ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY received_at DESC, id DESC) AS rn
    FROM analysis_pre_trial_questionnaire
  ) ranked
  WHERE rn = 1
),
post_q AS (
  SELECT *
  FROM (
    SELECT
      participant_id,
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
      ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY received_at DESC, id DESC) AS rn
    FROM analysis_post_trial_questionnaire
  ) ranked
  WHERE rn = 1
),
digital_behaviour AS (
  SELECT
    participant_id,
    COUNT(*) FILTER (WHERE event_type = 'page_view') AS digital_page_view_count,
    COUNT(*) FILTER (WHERE NULLIF(TRIM(query), '') IS NOT NULL) AS digital_search_count,
    COUNT(*) FILTER (WHERE NULLIF(TRIM(chat_message), '') IS NOT NULL) AS digital_chat_count
  FROM analysis_telemetry_events
  GROUP BY participant_id
)
SELECT
  p.participant_id,
  p.allocation_group,
  COALESCE(st.scenario_task_count, 0) AS scenario_task_count,
  st.scenario_total_time_seconds,
  st.scenario_avg_time_seconds,
  ss.scenario_avg_score,
  COALESCE(se.scenario_error_count, 0) AS scenario_error_count,
  COALESCE(se.scenario_major_error_count, 0) AS scenario_major_error_count,
  COALESCE(sh.scenario_help_count, 0) AS scenario_help_count,
  sst.step_mark_count,
  sst.step_accuracy,
  sf.short_form_question_count,
  sf.short_form_binary_accuracy,
  sf.short_form_proportion_accuracy,
  sf.short_form_avg_duration_seconds,
  pre.q6_digital_literacy,
  pre.q7_digital_guidance,
  pre.q8_physical_guidance,
  pre.q9_problem_solving,
  post.q1_instructions_ease,
  post.q2_info_ease,
  post.q3_step_by_step_help,
  post.q4_instructions_satisfaction,
  post.q5_confidence_setup,
  post.q6_confidence_troubleshooting,
  post.q7_mental_effort,
  post.q8_tlx_frustration,
  post.q9_tlx_perceived_performance,
  post.q10_tlx_temporal_demand,
  COALESCE(db.digital_page_view_count, 0) AS digital_page_view_count,
  COALESCE(db.digital_search_count, 0) AS digital_search_count,
  COALESCE(db.digital_chat_count, 0) AS digital_chat_count
FROM participants p
LEFT JOIN scenario_task_end st
  ON st.participant_id = p.participant_id
LEFT JOIN scenario_scores ss
  ON ss.participant_id = p.participant_id
LEFT JOIN scenario_errors se
  ON se.participant_id = p.participant_id
LEFT JOIN scenario_help sh
  ON sh.participant_id = p.participant_id
LEFT JOIN scenario_steps sst
  ON sst.participant_id = p.participant_id
LEFT JOIN short_form sf
  ON sf.participant_id = p.participant_id
LEFT JOIN pre_q pre
  ON pre.participant_id = p.participant_id
LEFT JOIN post_q post
  ON post.participant_id = p.participant_id
LEFT JOIN digital_behaviour db
  ON db.participant_id = p.participant_id
ORDER BY p.participant_id;
`;

const OUTCOMES = [
  { key: 'scenario_avg_score', label: 'Scenario average score', better: 'higher' },
  { key: 'scenario_total_time_seconds', label: 'Scenario total time (s)', better: 'lower' },
  { key: 'scenario_error_count', label: 'Scenario error count', better: 'lower' },
  { key: 'scenario_major_error_count', label: 'Scenario major error count', better: 'lower' },
  { key: 'scenario_help_count', label: 'Scenario help count', better: 'lower' },
  { key: 'step_accuracy', label: 'Scenario step accuracy', better: 'higher' },
  { key: 'short_form_binary_accuracy', label: 'Short-form binary accuracy', better: 'higher' },
  { key: 'short_form_proportion_accuracy', label: 'Short-form proportion accuracy', better: 'higher' },
  { key: 'short_form_avg_duration_seconds', label: 'Short-form average duration (s)', better: 'lower' },
  { key: 'q2_info_ease', label: 'Post-trial ease finding information', better: 'higher' },
  { key: 'q5_confidence_setup', label: 'Post-trial confidence setup', better: 'higher' },
  { key: 'q7_mental_effort', label: 'Post-trial mental effort', better: 'lower' },
  { key: 'q8_tlx_frustration', label: 'Post-trial frustration', better: 'lower' }
];

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleSd(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  const variance = values.reduce((acc, value) => acc + ((value - avg) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base];
  const upper = sorted[base + 1] ?? lower;
  return lower + rest * (upper - lower);
}

function cliffsDelta(groupA, groupB) {
  if (!groupA.length || !groupB.length) return null;
  let greater = 0;
  let lesser = 0;
  for (const a of groupA) {
    for (const b of groupB) {
      if (a > b) greater += 1;
      else if (a < b) lesser += 1;
    }
  }
  return (greater - lesser) / (groupA.length * groupB.length);
}

function permutationPValue(groupA, groupB, iterations = 5000) {
  if (groupA.length < 2 || groupB.length < 2) return null;
  const observed = Math.abs(mean(groupA) - mean(groupB));
  const combined = [...groupA, ...groupB];
  const sizeA = groupA.length;
  let extreme = 0;

  for (let i = 0; i < iterations; i += 1) {
    for (let j = combined.length - 1; j > 0; j -= 1) {
      const k = Math.floor(Math.random() * (j + 1));
      const tmp = combined[j];
      combined[j] = combined[k];
      combined[k] = tmp;
    }
    const permA = combined.slice(0, sizeA);
    const permB = combined.slice(sizeA);
    const diff = Math.abs(mean(permA) - mean(permB));
    if (diff >= observed) extreme += 1;
  }

  return (extreme + 1) / (iterations + 1);
}

function summarize(values) {
  if (!values.length) {
    return {
      n: 0,
      mean: null,
      sd: null,
      median: null,
      q1: null,
      q3: null
    };
  }

  return {
    n: values.length,
    mean: mean(values),
    sd: sampleSd(values),
    median: median(values),
    q1: quantile(values, 0.25),
    q3: quantile(values, 0.75)
  };
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'NA';
  return Number(value).toFixed(digits);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const escaped = (value) => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((column) => escaped(row[column])).join(','));
  return [header, ...lines].join('\n');
}

function ensureDirectories() {
  fs.mkdirSync(TABLES_DIR, { recursive: true });
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(FIGURES_DIR, { recursive: true });
  fs.mkdirSync(CHAT_EVAL_DIR, { recursive: true });
}

function clearPreviousOutputs() {
  const managedDirectories = [TABLES_DIR, REPORTS_DIR, FIGURES_DIR, CHAT_EVAL_DIR];
  let clearedCount = 0;

  for (const directory of managedDirectories) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      fs.unlinkSync(path.join(directory, entry.name));
      clearedCount += 1;
    }
  }

  return clearedCount;
}

function buildReport({ participantRows, testRows, groupSummaryRows, generatedAt }) {
  const groupCounts = groupSummaryRows
    .filter((row) => row.metric === '_participants')
    .map((row) => `${row.group}: n=${row.n}`)
    .join(', ');

  const topSignals = [...testRows]
    .filter((row) => row.permutation_p_value !== null)
    .sort((a, b) => a.permutation_p_value - b.permutation_p_value)
    .slice(0, 5);

  const lines = [];
  lines.push('# CPAP Trial Statistical Report (On-Demand)');
  lines.push('');
  lines.push(`Generated at: ${generatedAt}`);
  lines.push(`Participants analyzed: ${participantRows.length}`);
  lines.push(`Group sizes: ${groupCounts || 'NA'}`);
  lines.push('');
  lines.push('## Summary table (group comparison)');
  lines.push('');
  lines.push('| Outcome | Digital n | Physical n | Digital mean | Physical mean | Mean diff (Digital - Physical) | Permutation p | Cliff\'s delta |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');

  for (const row of testRows) {
    lines.push(`| ${row.label} | ${row.digital_n} | ${row.physical_n} | ${formatNumber(row.digital_mean)} | ${formatNumber(row.physical_mean)} | ${formatNumber(row.mean_diff)} | ${formatNumber(row.permutation_p_value, 4)} | ${formatNumber(row.cliffs_delta)} |`);
  }

  lines.push('');
  lines.push('## Quick interpretation');
  lines.push('');
  if (!topSignals.length) {
    lines.push('- Insufficient data for inferential comparisons (need at least 2 participants per group per outcome).');
  } else {
    for (const row of topSignals) {
      lines.push(`- ${row.label}: mean difference = ${formatNumber(row.mean_diff)}, permutation p = ${formatNumber(row.permutation_p_value, 4)} (${row.better_direction_hint}).`);
    }
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This report is generated on demand from PostgreSQL (no scheduled timer).');
  lines.push('- P-values are permutation-based (default 5,000 shuffles) to reduce distributional assumptions for small samples.');
  lines.push('- Confirm primary endpoint definitions with your supervisor before final dissertation submission.');

  return `${lines.join('\n')}\n`;
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Example: set DATABASE_URL=postgres://user:pass@host:5432/dbname');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
  });

  try {
    const result = await pool.query(ANALYSIS_QUERY);
    const participantRows = result.rows.map((row) => {
      const normalized = { ...row };
      Object.keys(normalized).forEach((key) => {
        if (key === 'participant_id' || key === 'allocation_group') return;
        normalized[key] = toNumber(normalized[key]);
      });
      return normalized;
    });

    const digitalRows = participantRows.filter((row) => row.allocation_group === 'digital');
    const physicalRows = participantRows.filter((row) => row.allocation_group === 'physical');

    const testRows = OUTCOMES.map((outcome) => {
      const digitalValues = digitalRows
        .map((row) => toNumber(row[outcome.key]))
        .filter((value) => value !== null);
      const physicalValues = physicalRows
        .map((row) => toNumber(row[outcome.key]))
        .filter((value) => value !== null);

      const digitalSummary = summarize(digitalValues);
      const physicalSummary = summarize(physicalValues);
      const meanDiff =
        digitalSummary.mean !== null && physicalSummary.mean !== null
          ? digitalSummary.mean - physicalSummary.mean
          : null;

      return {
        outcome_key: outcome.key,
        label: outcome.label,
        better_direction_hint: outcome.better,
        digital_n: digitalSummary.n,
        physical_n: physicalSummary.n,
        digital_mean: digitalSummary.mean,
        physical_mean: physicalSummary.mean,
        digital_sd: digitalSummary.sd,
        physical_sd: physicalSummary.sd,
        digital_median: digitalSummary.median,
        physical_median: physicalSummary.median,
        mean_diff: meanDiff,
        permutation_p_value: permutationPValue(digitalValues, physicalValues),
        cliffs_delta: cliffsDelta(digitalValues, physicalValues)
      };
    });

    const groupSummaryRows = [];

    groupSummaryRows.push({ metric: '_participants', group: 'digital', n: digitalRows.length, mean: null, sd: null, median: null, q1: null, q3: null });
    groupSummaryRows.push({ metric: '_participants', group: 'physical', n: physicalRows.length, mean: null, sd: null, median: null, q1: null, q3: null });

    for (const outcome of OUTCOMES) {
      const byGroup = [
        { name: 'digital', rows: digitalRows },
        { name: 'physical', rows: physicalRows }
      ];

      for (const entry of byGroup) {
        const values = entry.rows
          .map((row) => toNumber(row[outcome.key]))
          .filter((value) => value !== null);
        const summary = summarize(values);
        groupSummaryRows.push({
          metric: outcome.key,
          group: entry.name,
          n: summary.n,
          mean: summary.mean,
          sd: summary.sd,
          median: summary.median,
          q1: summary.q1,
          q3: summary.q3
        });
      }
    }

    ensureDirectories();
    const clearedCount = clearPreviousOutputs();
    const generatedAt = new Date().toISOString();

    const participantCsv = toCsv(participantRows);
    const testsCsv = toCsv(testRows);
    const summaryCsv = toCsv(groupSummaryRows);
    const report = buildReport({ participantRows, testRows, groupSummaryRows, generatedAt });

    const participantFile = path.join(TABLES_DIR, 'participant-level-latest.csv');
    const testsFile = path.join(TABLES_DIR, 'outcome-tests-latest.csv');
    const summaryFile = path.join(TABLES_DIR, 'group-summary-latest.csv');
    const reportFile = path.join(REPORTS_DIR, 'stats-report-latest.md');

    fs.writeFileSync(participantFile, participantCsv, 'utf8');
    fs.writeFileSync(testsFile, testsCsv, 'utf8');
    fs.writeFileSync(summaryFile, summaryCsv, 'utf8');
    fs.writeFileSync(reportFile, report, 'utf8');

    console.log('Stats report generated successfully.');
    if (clearedCount) {
      console.log(`- Cleared ${clearedCount} previous analysis output(s).`);
    }
    console.log(`- ${reportFile}`);
    console.log(`- ${participantFile}`);
    console.log(`- ${testsFile}`);
    console.log(`- ${summaryFile}`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Failed to generate stats report:', error.message || error);
  process.exit(1);
});
