#!/usr/bin/env python3
import csv
import json
import math
import os
import random
import sys
from datetime import datetime, timezone
from html import escape as html_escape
from pathlib import Path
from typing import Any
from urllib.parse import unquote

try:
  import matplotlib
  matplotlib.use('Agg')
  import matplotlib.pyplot as plt
except ImportError as error:  # pragma: no cover
  raise SystemExit(
    "matplotlib is required for figure generation. Install dependencies with: pip install -r requirements.txt"
  ) from error

try:
    import psycopg
except ImportError as error:  # pragma: no cover
    raise SystemExit(
        "psycopg is required. Install dependencies with: pip install -r requirements.txt"
    ) from error

OUTPUT_DIR = Path(__file__).resolve().parent.parent / 'analysis-output'
TABLES_DIR = OUTPUT_DIR / 'tables'
REPORTS_DIR = OUTPUT_DIR / 'reports'
FIGURES_DIR = OUTPUT_DIR / 'figures'
CHAT_EVAL_DIR = OUTPUT_DIR / 'chat-eval'
WORKSPACE_DIR = Path(__file__).resolve().parent.parent
DOTENV_PATH = WORKSPACE_DIR / '.env'

ANALYSIS_QUERY = """
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
      q1_age_years,
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
  pre.q1_age_years,
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
"""

PAGE_USAGE_QUERY = """
WITH normalized_page_views AS (
  SELECT
    participant_id,
    COALESCE(
      NULLIF(TRIM(page_title), ''),
      NULLIF(TRIM(SPLIT_PART(SPLIT_PART(page_path, '?', 1), '#', 1)), '')
    ) AS page_label,
    NULLIF(TRIM(SPLIT_PART(SPLIT_PART(page_path, '?', 1), '#', 1)), '') AS page_path
  FROM analysis_telemetry_events
  WHERE event_type = 'page_view'
)
SELECT
  participant_id,
  page_label,
  page_path,
  COUNT(*) AS page_views
FROM normalized_page_views
WHERE page_path IS NOT NULL
GROUP BY participant_id, page_label, page_path
ORDER BY page_views DESC, page_label ASC;
"""

SCENARIO_PAGE_TRANSITIONS_QUERY = """
WITH page_views AS (
  SELECT
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
    COALESCE(NULLIF(TRIM(e.task_label), ''), e.task_id) AS task_label,
    NULLIF(TRIM(SPLIT_PART(SPLIT_PART(e.page_path, '?', 1), '#', 1)), '') AS page_path,
    ROW_NUMBER() OVER (
      PARTITION BY e.participant_id, e.task_id, e.task_instance_seq
      ORDER BY e.event_at ASC, e.id ASC
    ) AS page_seq
  FROM telemetry_task_events_enriched e
  INNER JOIN analysis_participant_allocation pa
    ON pa.participant_id = e.participant_id
    AND pa.allocation_group = 'digital'
  WHERE e.event_type = 'page_view'
    AND e.task_id LIKE 'scenario_card_%'
    AND NULLIF(TRIM(SPLIT_PART(SPLIT_PART(e.page_path, '?', 1), '#', 1)), '') IS NOT NULL
),
deduped_page_views AS (
  SELECT *
  FROM (
    SELECT
      pv.*,
      LAG(pv.page_path) OVER (
        PARTITION BY pv.participant_id, pv.task_id, pv.task_instance_seq
        ORDER BY pv.page_seq ASC
      ) AS previous_page_path
    FROM page_views pv
  ) ranked
  WHERE ranked.previous_page_path IS DISTINCT FROM ranked.page_path
     OR ranked.previous_page_path IS NULL
),
sequenced_page_views AS (
  SELECT
    participant_id,
    task_id,
    task_instance_seq,
    task_label,
    page_path,
    ROW_NUMBER() OVER (
      PARTITION BY participant_id, task_id, task_instance_seq
      ORDER BY page_seq ASC
    ) AS deduped_page_seq
  FROM deduped_page_views
),
ordered_transitions AS (
  SELECT
    participant_id,
    task_id,
    task_instance_seq,
    task_label,
    deduped_page_seq AS source_step,
    page_path AS source_page,
    LEAD(deduped_page_seq) OVER (
      PARTITION BY participant_id, task_id, task_instance_seq
      ORDER BY deduped_page_seq ASC
    ) AS target_step,
    LEAD(page_path) OVER (
      PARTITION BY participant_id, task_id, task_instance_seq
      ORDER BY deduped_page_seq ASC
    ) AS target_page
  FROM sequenced_page_views
)
SELECT
  task_id,
  task_label,
  source_step,
  source_page,
  target_step,
  target_page,
  COUNT(*)::BIGINT AS transition_count,
  COUNT(DISTINCT participant_id)::BIGINT AS participant_count
FROM ordered_transitions
WHERE target_page IS NOT NULL
  AND source_page IS NOT NULL
GROUP BY task_id, task_label, source_step, source_page, target_step, target_page
ORDER BY task_id, source_step ASC, transition_count DESC, source_page ASC, target_page ASC;
"""

TASK_LEVEL_QUERY = """
WITH task_instances AS (
  SELECT
    session_id,
    participant_id,
    task_id,
    task_instance_seq,
    task_label,
    task_started_at,
    task_ended_at,
    task_total_duration_ms,
    task_total_page_dwell_ms,
    task_event_count,
    task_page_count,
    trial_mode
  FROM telemetry_task_instances
  WHERE UPPER(TRIM(COALESCE(participant_id, ''))) <> 'TEST'
),
observer_note_metrics AS (
  SELECT
    t.participant_id,
    t.task_id,
    t.task_instance_seq,
    AVG(o.scenario_score::DOUBLE PRECISION) FILTER (
      WHERE o.action_type = 'scenario_score' AND o.scenario_score IS NOT NULL
    ) AS scenario_score,
    MAX(COALESCE(o.help_instances_count, 0)) FILTER (
      WHERE o.action_type = 'task_end'
    ) AS help_instances_count,
    COUNT(*) FILTER (WHERE o.action_type = 'error')::BIGINT AS error_count,
    COUNT(*) FILTER (WHERE o.action_type = 'error' AND o.error_severity = 'major')::BIGINT AS major_error_count
  FROM task_instances t
  LEFT JOIN analysis_observer_notes o
    ON o.participant_id = t.participant_id
    AND COALESCE(NULLIF(o.trial_mode, ''), t.trial_mode) = t.trial_mode
    AND o.task_id = t.task_id
    AND COALESCE(o."timestamp", o.received_at) >= COALESCE(t.task_started_at, COALESCE(o."timestamp", o.received_at))
    AND (t.task_ended_at IS NULL OR COALESCE(o."timestamp", o.received_at) <= t.task_ended_at)
  GROUP BY t.participant_id, t.task_id, t.task_instance_seq
),
step_metrics AS (
  SELECT
    t.participant_id,
    t.task_id,
    t.task_instance_seq,
    COUNT(s.*)::BIGINT AS step_mark_count,
    AVG(CASE WHEN s.criterion_outcome = 'correct' THEN 1.0 ELSE 0.0 END) AS step_accuracy
  FROM task_instances t
  LEFT JOIN analysis_observer_step_marks s
    ON s.participant_id = t.participant_id
    AND COALESCE(NULLIF(s.trial_mode, ''), t.trial_mode) = t.trial_mode
    AND s.task_id = t.task_id
    AND COALESCE(s."timestamp", s.received_at) >= COALESCE(t.task_started_at, COALESCE(s."timestamp", s.received_at))
    AND (t.task_ended_at IS NULL OR COALESCE(s."timestamp", s.received_at) <= t.task_ended_at)
  GROUP BY t.participant_id, t.task_id, t.task_instance_seq
),
short_form_metrics AS (
  SELECT
    t.participant_id,
    t.task_id,
    t.task_instance_seq,
    AVG(sf.proportion_correct::DOUBLE PRECISION) AS short_form_proportion_accuracy,
    AVG(sf.all_parts_correct_binary::DOUBLE PRECISION) AS short_form_binary_accuracy,
    AVG(NULLIF(sf.duration_ms, 0)::DOUBLE PRECISION) / 1000.0 AS short_form_duration_seconds
  FROM task_instances t
  LEFT JOIN analysis_short_form_result_scores sf
    ON sf.participant_id = t.participant_id
    AND COALESCE(NULLIF(sf.trial_mode, ''), t.trial_mode) = t.trial_mode
    AND COALESCE(NULLIF(sf.task_id, ''), NULLIF(sf.question_id, '')) = t.task_id
    AND COALESCE(sf."timestamp", sf.received_at) >= COALESCE(t.task_started_at, COALESCE(sf."timestamp", sf.received_at))
    AND (t.task_ended_at IS NULL OR COALESCE(sf."timestamp", sf.received_at) <= t.task_ended_at)
  GROUP BY t.participant_id, t.task_id, t.task_instance_seq
)
SELECT
  t.session_id,
  t.participant_id,
  t.task_id,
  t.task_instance_seq,
  t.task_label,
  t.trial_mode,
  t.task_started_at,
  t.task_ended_at,
  t.task_total_duration_ms / 1000.0 AS task_total_duration_seconds,
  t.task_total_page_dwell_ms / 1000.0 AS task_total_page_dwell_seconds,
  t.task_event_count,
  t.task_page_count,
  onm.scenario_score,
  COALESCE(onm.help_instances_count, 0) AS help_instances_count,
  COALESCE(onm.error_count, 0) AS error_count,
  COALESCE(onm.major_error_count, 0) AS major_error_count,
  sm.step_mark_count,
  sm.step_accuracy,
  sfm.short_form_binary_accuracy,
  sfm.short_form_proportion_accuracy,
  sfm.short_form_duration_seconds
FROM task_instances t
LEFT JOIN observer_note_metrics onm
  ON onm.participant_id = t.participant_id
  AND onm.task_id = t.task_id
  AND onm.task_instance_seq = t.task_instance_seq
LEFT JOIN step_metrics sm
  ON sm.participant_id = t.participant_id
  AND sm.task_id = t.task_id
  AND sm.task_instance_seq = t.task_instance_seq
LEFT JOIN short_form_metrics sfm
  ON sfm.participant_id = t.participant_id
  AND sfm.task_id = t.task_id
  AND sfm.task_instance_seq = t.task_instance_seq
ORDER BY t.participant_id, t.task_id, t.task_instance_seq;
"""

QUESTIONNAIRE_COMMENTS_QUERY = """
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
    COALESCE(pa.allocation_group, mg.inferred_mode, 'digital') AS allocation_group
  FROM participant_pool p
  LEFT JOIN analysis_participant_allocation pa
    ON pa.participant_id = p.participant_id
  LEFT JOIN mode_guess mg
    ON mg.participant_id = p.participant_id
)
SELECT
  p.participant_id,
  p.allocation_group,
  pre.q10_format_preference AS pre_format_preference,
  pre.q10_format_mix_details AS pre_format_mix_details,
  pre.free_text_notes AS pre_free_text_notes,
  post.q11_format_preference AS post_format_preference,
  post.q11_format_mix_details AS post_format_mix_details,
  post.free_text_notes AS post_free_text_notes
FROM participants p
LEFT JOIN analysis_pre_trial_questionnaire pre
  ON pre.participant_id = p.participant_id
LEFT JOIN analysis_post_trial_questionnaire post
  ON post.participant_id = p.participant_id
WHERE NULLIF(TRIM(COALESCE(pre.q10_format_mix_details, '')), '') IS NOT NULL
   OR NULLIF(TRIM(COALESCE(pre.free_text_notes, '')), '') IS NOT NULL
   OR NULLIF(TRIM(COALESCE(post.q11_format_mix_details, '')), '') IS NOT NULL
   OR NULLIF(TRIM(COALESCE(post.free_text_notes, '')), '') IS NOT NULL
ORDER BY p.allocation_group ASC, p.participant_id ASC;
"""

OUTCOME_FAMILIES = {
  'continuous_bounded': {
    'label': 'Continuous bounded summary outcome',
    'primary_test': 'Two-sided permutation test on the mean difference',
    'sensitivity_test': None,
    'effect_size': "Cliff's delta",
    'why': 'The permutation test provides a low-assumption group comparison while reporting mean/SD and median/IQR summaries.',
  },
  'continuous_time': {
    'label': 'Continuous timing outcome',
    'primary_test': 'Two-sided permutation test on the mean difference',
    'sensitivity_test': 'Mann–Whitney U test',
    'effect_size': "Cliff's delta",
    'why': 'Timing measures can be skewed in small samples, so the permutation test is used as the primary analysis with Mann–Whitney U as a sensitivity check.',
  },
  'count': {
    'label': 'Count outcome',
    'primary_test': 'Two-sided permutation test on the mean difference',
    'sensitivity_test': 'Mann–Whitney U test',
    'effect_size': "Cliff's delta",
    'why': 'Counts are discrete and zero-heavy here, so the permutation test is used as the primary analysis with Mann–Whitney U as a sensitivity check.',
  },
  'proportion': {
    'label': 'Bounded proportion outcome',
    'primary_test': 'Two-sided permutation test on the mean difference',
    'sensitivity_test': None,
    'effect_size': "Cliff's delta",
    'why': 'Accuracy measures are bounded between 0 and 1. The permutation approach is used with a nonparametric effect size. No sensitivity test is added due to ceiling effects.',
  },
  'ordinal': {
    'label': 'Ordinal Likert-style outcome',
    'primary_test': 'Mann–Whitney U test',
    'sensitivity_test': 'Two-sided permutation test on the mean difference',
    'effect_size': "Cliff's delta",
    'why': 'Mann–Whitney U respects the ordinal nature of Likert scales by comparing ranks rather than assuming equal intervals. The permutation test on the mean difference is reported as a sensitivity analysis.',
  },
  'prepost_change': {
    'label': 'Between-group comparison of matched pre/post change scores',
    'primary_test': 'Two-sided permutation test on the mean change difference',
    'sensitivity_test': None,
    'within_test': 'Wilcoxon signed-rank test',
    'effect_size': "Cliff's delta on change scores",
    'why': 'The between-group permutation test compares how much each group changed from baseline to post-trial. Within-group Wilcoxon signed-rank tests assess whether each group individually changed from baseline.',
  },
}


OUTCOMES = [
  {"key": "scenario_avg_score", "label": "Scenario average score", "better": "higher", "family": "continuous_bounded"},
  {"key": "scenario_total_time_seconds", "label": "Scenario total time (s)", "better": "lower", "family": "continuous_time"},
  {"key": "scenario_error_count", "label": "Scenario error count", "better": "lower", "family": "count"},
  {"key": "scenario_major_error_count", "label": "Scenario major error count", "better": "lower", "family": "count"},
  {"key": "scenario_help_count", "label": "Scenario help count", "better": "lower", "family": "count"},
  {"key": "step_accuracy", "label": "Scenario step accuracy", "better": "higher", "family": "proportion"},
  {"key": "short_form_binary_accuracy", "label": "Short-form binary accuracy", "better": "higher", "family": "proportion"},
  {"key": "short_form_proportion_accuracy", "label": "Short-form proportion accuracy", "better": "higher", "family": "proportion"},
  {"key": "short_form_avg_duration_seconds", "label": "Short-form average duration (s)", "better": "lower", "family": "continuous_time"},
  {"key": "q2_info_ease", "label": "Post-trial ease finding information", "better": "higher", "family": "ordinal"},
  {"key": "q5_confidence_setup", "label": "Post-trial confidence setup", "better": "higher", "family": "ordinal"},
  {"key": "q7_mental_effort", "label": "Post-trial mental effort", "better": "lower", "family": "ordinal"},
  {"key": "q8_tlx_frustration", "label": "Post-trial frustration", "better": "lower", "family": "ordinal"},
]

STARTER_FIGURES = [
  {
    'key': 'scenario_total_time_seconds',
    'title': 'Scenario total time by group',
    'ylabel': 'Total time (s)',
    'filename': 'starter-scenario-total-time',
  },
  {
    'key': 'scenario_error_count',
    'title': 'Scenario error count by group',
    'ylabel': 'Error count',
    'filename': 'starter-scenario-error-count',
  },
  {
    'key': 'short_form_proportion_accuracy',
    'title': 'Short-form proportion accuracy by group',
    'ylabel': 'Proportion correct',
    'filename': 'starter-short-form-accuracy',
  },
]

POST_TRIAL_LIKERT_ITEMS = [
  ('q1_instructions_ease', 'Instructions easy'),
  ('q2_info_ease', 'Info easy to find'),
  ('q3_step_by_step_help', 'Step-by-step help'),
  ('q4_instructions_satisfaction', 'Instructions satisfaction'),
  ('q5_confidence_setup', 'Confidence setup'),
  ('q6_confidence_troubleshooting', 'Confidence troubleshoot'),
  ('q7_mental_effort', 'Mental effort'),
  ('q8_tlx_frustration', 'Frustration'),
  ('q9_tlx_perceived_performance', 'Perceived performance'),
  ('q10_tlx_temporal_demand', 'Temporal demand'),
]

PREPOST_COMPARATORS = [
    {
        'key': 'setup_confidence_matched',
        'label': 'Setup confidence (matched baseline → post)',
        'pre_key_digital': 'q7_digital_guidance',
        'pre_key_physical': 'q8_physical_guidance',
        'post_key': 'q5_confidence_setup',
    'better': 'higher',
    'family': 'prepost_change',
    },
    {
        'key': 'troubleshooting_confidence',
        'label': 'Troubleshooting confidence (pre → post)',
        'pre_key': 'q9_problem_solving',
        'post_key': 'q6_confidence_troubleshooting',
    'better': 'higher',
    'family': 'prepost_change',
    },
]

OUTCOME_BY_KEY = {outcome['key']: outcome for outcome in OUTCOMES}
PREPOST_COMPARATOR_BY_KEY = {comparator['key']: comparator for comparator in PREPOST_COMPARATORS}


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding='utf8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]

        os.environ[key] = value


def to_number(value: Any) -> float | int | None:
    if value in (None, ''):
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return int(number) if number.is_integer() else number


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def median(values: list[float]) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    mid = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2


def sample_sd(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    avg = mean(values)
    assert avg is not None
    variance = sum((value - avg) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    pos = (len(sorted_values) - 1) * q
    base = math.floor(pos)
    rest = pos - base
    lower = sorted_values[base]
    upper = sorted_values[base + 1] if base + 1 < len(sorted_values) else lower
    return lower + rest * (upper - lower)


def cliffs_delta(group_a: list[float], group_b: list[float]) -> float | None:
    if not group_a or not group_b:
        return None
    greater = 0
    lesser = 0
    for a_value in group_a:
        for b_value in group_b:
            if a_value > b_value:
                greater += 1
            elif a_value < b_value:
                lesser += 1
    return (greater - lesser) / (len(group_a) * len(group_b))


def permutation_p_value(group_a: list[float], group_b: list[float], iterations: int = 5000) -> float | None:
    if len(group_a) < 2 or len(group_b) < 2:
        return None
    observed = abs((mean(group_a) or 0) - (mean(group_b) or 0))
    combined = list(group_a) + list(group_b)
    size_a = len(group_a)
    rng = random.Random(42)
    extreme = 0

    for _ in range(iterations):
        rng.shuffle(combined)
        perm_a = combined[:size_a]
        perm_b = combined[size_a:]
        diff = abs((mean(perm_a) or 0) - (mean(perm_b) or 0))
        if diff >= observed:
            extreme += 1

    return (extreme + 1) / (iterations + 1)


def mann_whitney_u(group_a: list[float], group_b: list[float]) -> dict[str, float | None]:
    """Two-sided Mann-Whitney U test (exact for small samples).

    Returns {'U': U statistic, 'p': two-sided p-value}.
    Uses a normal approximation with continuity correction for the
    p-value when both groups have n >= 2.
    """
    if len(group_a) < 2 or len(group_b) < 2:
        return {'U': None, 'p': None}
    n_a = len(group_a)
    n_b = len(group_b)
    # Count pairwise comparisons
    u_a = 0.0
    for a_val in group_a:
        for b_val in group_b:
            if a_val > b_val:
                u_a += 1.0
            elif a_val == b_val:
                u_a += 0.5
    u_b = (n_a * n_b) - u_a
    u_stat = min(u_a, u_b)
    # Normal approximation with continuity correction
    mu = (n_a * n_b) / 2.0
    # Handle ties for variance
    combined = sorted(group_a + group_b)
    n_total = n_a + n_b
    # Count tie groups
    tie_correction = 0.0
    i = 0
    while i < n_total:
        j = i + 1
        while j < n_total and combined[j] == combined[i]:
            j += 1
        t = j - i  # size of tie group
        if t > 1:
            tie_correction += (t ** 3 - t)
        i = j
    sigma_sq = ((n_a * n_b) / 12.0) * ((n_total + 1) - tie_correction / (n_total * (n_total - 1)))
    if sigma_sq <= 0:
        return {'U': u_stat, 'p': 1.0}
    sigma = math.sqrt(sigma_sq)
    z = (abs(u_stat - mu) - 0.5) / sigma  # continuity correction
    if z < 0:
        z = 0.0
    # Two-sided p-value from standard normal
    p_value = 2.0 * (1.0 - _normal_cdf(z))
    return {'U': u_stat, 'p': min(p_value, 1.0)}


def _normal_cdf(z: float) -> float:
    """Standard normal CDF using the error function."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def wilcoxon_signed_rank(pre: list[float], post: list[float]) -> dict[str, float | int | None]:
    """Wilcoxon signed-rank test for paired observations.

    Returns {'T': test statistic (smaller of W+ and W-),
             'p': two-sided p-value,
             'n_pairs': number of non-zero-difference pairs}.
    Uses normal approximation with continuity correction.
    """
    if len(pre) != len(post) or len(pre) < 2:
        return {'T': None, 'p': None, 'n_pairs': 0}
    # Compute differences, drop zeros
    diffs = []
    for pre_val, post_val in zip(pre, post):
        d = post_val - pre_val
        if d != 0.0:
            diffs.append(d)
    n_pairs = len(diffs)
    if n_pairs < 2:
        return {'T': None, 'p': None, 'n_pairs': n_pairs}
    # Rank absolute differences
    abs_diffs = [(abs(d), i) for i, d in enumerate(diffs)]
    abs_diffs.sort(key=lambda x: x[0])
    ranks = [0.0] * n_pairs
    i = 0
    while i < n_pairs:
        j = i + 1
        while j < n_pairs and abs_diffs[j][0] == abs_diffs[i][0]:
            j += 1
        avg_rank = sum(range(i + 1, j + 1)) / (j - i)
        for k in range(i, j):
            ranks[abs_diffs[k][1]] = avg_rank
        i = j
    # Sum of positive and negative ranks
    w_plus = sum(ranks[i] for i in range(n_pairs) if diffs[i] > 0)
    w_minus = sum(ranks[i] for i in range(n_pairs) if diffs[i] < 0)
    t_stat = min(w_plus, w_minus)
    # Normal approximation with continuity correction
    mu = n_pairs * (n_pairs + 1) / 4.0
    # Tie correction for variance
    tie_correction = 0.0
    abs_vals_sorted = sorted(abs(d) for d in diffs)
    i = 0
    while i < n_pairs:
        j = i + 1
        while j < n_pairs and abs_vals_sorted[j] == abs_vals_sorted[i]:
            j += 1
        t = j - i
        if t > 1:
            tie_correction += (t ** 3 - t)
        i = j
    sigma_sq = (n_pairs * (n_pairs + 1) * (2 * n_pairs + 1)) / 24.0 - tie_correction / 48.0
    if sigma_sq <= 0:
        return {'T': t_stat, 'p': 1.0, 'n_pairs': n_pairs}
    sigma = math.sqrt(sigma_sq)
    z = (abs(t_stat - mu) - 0.5) / sigma
    if z < 0:
        z = 0.0
    p_value = 2.0 * (1.0 - _normal_cdf(z))
    return {'T': t_stat, 'p': min(p_value, 1.0), 'n_pairs': n_pairs}


def summarize(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"n": 0, "mean": None, "sd": None, "median": None, "q1": None, "q3": None}
    return {
        "n": len(values),
        "mean": mean(values),
        "sd": sample_sd(values),
        "median": median(values),
        "q1": quantile(values, 0.25),
        "q3": quantile(values, 0.75),
    }


def format_number(value: Any, digits: int = 3) -> str:
    if value is None:
        return 'NA'
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 'NA'
    if math.isnan(number):
        return 'NA'
    return f"{number:.{digits}f}"


def format_mean_sd(mean_value: Any, sd_value: Any, digits: int = 3) -> str:
    mean_text = format_number(mean_value, digits)
    sd_text = format_number(sd_value, digits)
    if mean_text == 'NA':
        return 'NA'
    if sd_text == 'NA':
        return mean_text
    return f'{mean_text} ± {sd_text}'


def format_median_iqr(median_value: Any, q1_value: Any, q3_value: Any, digits: int = 3) -> str:
    median_text = format_number(median_value, digits)
    q1_text = format_number(q1_value, digits)
    q3_text = format_number(q3_value, digits)
    if median_text == 'NA':
        return 'NA'
    if q1_text == 'NA' or q3_text == 'NA':
        return median_text
    return f'{median_text} [{q1_text}, {q3_text}]'


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return ' '.join(text.split())


def build_report_ready_rows(test_rows: list[dict[str, Any]]) -> list[dict[str, str | int]]:
    rows: list[dict[str, str | int]] = []
    for row in test_rows:
        rows.append({
            'Outcome': str(row['label']),
            'Digital n': int(row['digital_n']),
            'Digital mean ± SD': format_mean_sd(row['digital_mean'], row['digital_sd']),
            'Digital median [Q1, Q3]': format_median_iqr(row['digital_median'], row['digital_q1'], row['digital_q3']),
            'Physical n': int(row['physical_n']),
            'Physical mean ± SD': format_mean_sd(row['physical_mean'], row['physical_sd']),
            'Physical median [Q1, Q3]': format_median_iqr(row['physical_median'], row['physical_q1'], row['physical_q3']),
            'Mean diff (D-P)': format_number(row['mean_diff']),
            'Permutation p': format_number(row['permutation_p_value'], 4),
            'Mann-Whitney U p': format_number(row.get('mann_whitney_p'), 4),
            "Cliff's delta": format_number(row['cliffs_delta']),
        })
    return rows


def build_questionnaire_comments_markdown(comment_rows: list[dict[str, Any]], generated_at: str) -> str:
    participant_sections: list[str] = []

    for row in comment_rows:
        pre_format_preference = normalize_text(row.get('pre_format_preference'))
        pre_format_mix_details = normalize_text(row.get('pre_format_mix_details'))
        pre_free_text_notes = normalize_text(row.get('pre_free_text_notes'))
        post_format_preference = normalize_text(row.get('post_format_preference'))
        post_format_mix_details = normalize_text(row.get('post_format_mix_details'))
        post_free_text_notes = normalize_text(row.get('post_free_text_notes'))

        has_pre = any([pre_format_preference, pre_format_mix_details, pre_free_text_notes])
        has_post = any([post_format_preference, post_format_mix_details, post_free_text_notes])
        if not has_pre and not has_post:
            continue

        participant_id = str(row.get('participant_id') or '').strip() or 'Unknown participant'
        allocation_group = str(row.get('allocation_group') or 'unknown').strip() or 'unknown'

        participant_sections.extend([
            f'## {participant_id} ({allocation_group})',
            '',
        ])

        if has_pre:
            participant_sections.extend([
                '### Pre-trial',
                '',
            ])
            if pre_format_preference:
                participant_sections.append(f'- Format preference: {pre_format_preference}')
            if pre_format_mix_details:
                participant_sections.append(f'- Format preference details: {pre_format_mix_details}')
            if pre_free_text_notes:
                participant_sections.append(f'- Additional notes: {pre_free_text_notes}')
            participant_sections.append('')

        if has_post:
            participant_sections.extend([
                '### Post-trial',
                '',
            ])
            if post_format_preference:
                participant_sections.append(f'- Format preference: {post_format_preference}')
            if post_format_mix_details:
                participant_sections.append(f'- Format preference details: {post_format_mix_details}')
            if post_free_text_notes:
                participant_sections.append(f'- Additional notes: {post_free_text_notes}')
            participant_sections.append('')

    lines = [
        '# Questionnaire Free-Text Comments',
        '',
        f'Generated at: {generated_at}',
        f'Participants with text responses: {len([line for line in participant_sections if line.startswith("## ")])}',
        '',
        'This file collects the latest free-text questionnaire responses exposed by the analysis questionnaire views.',
        '',
    ]

    if not participant_sections:
        lines.extend([
            'No pre-trial or post-trial free-text comments were found in the analysis questionnaire views.',
            '',
        ])
    else:
        lines.extend(participant_sections)

    return '\n'.join(lines)


def to_markdown_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ''

    columns = list(rows[0].keys())
    header = '| ' + ' | '.join(columns) + ' |'
    separator = '| ' + ' | '.join('---' for _ in columns) + ' |'
    body = []
    for row in rows:
        body.append('| ' + ' | '.join(str(row.get(column, '')) for column in columns) + ' |')
    return '\n'.join([header, separator, *body]) + '\n'


def build_task_summary_rows(task_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in task_rows:
        task_id = str(row.get('task_id') or '').strip()
        task_label = str(row.get('task_label') or '').strip()
        group = str(row.get('allocation_group') or '').strip()
        grouped.setdefault((task_id, task_label, group), []).append(row)

    summary_rows: list[dict[str, Any]] = []
    for (task_id, task_label, group), rows in sorted(grouped.items(), key=lambda item: (item[0][0], item[0][2], item[0][1])):
        duration_values = [float(row['task_total_duration_seconds']) for row in rows if to_number(row.get('task_total_duration_seconds')) is not None]
        dwell_values = [float(row['task_total_page_dwell_seconds']) for row in rows if to_number(row.get('task_total_page_dwell_seconds')) is not None]
        page_count_values = [float(row['task_page_count']) for row in rows if to_number(row.get('task_page_count')) is not None]
        scenario_score_values = [float(row['scenario_score']) for row in rows if to_number(row.get('scenario_score')) is not None]
        help_values = [float(row['help_instances_count']) for row in rows if to_number(row.get('help_instances_count')) is not None]
        error_values = [float(row['error_count']) for row in rows if to_number(row.get('error_count')) is not None]
        major_error_values = [float(row['major_error_count']) for row in rows if to_number(row.get('major_error_count')) is not None]
        step_accuracy_values = [float(row['step_accuracy']) for row in rows if to_number(row.get('step_accuracy')) is not None]
        short_form_accuracy_values = [float(row['short_form_proportion_accuracy']) for row in rows if to_number(row.get('short_form_proportion_accuracy')) is not None]

        duration_summary = summarize(duration_values)
        dwell_summary = summarize(dwell_values)
        page_count_summary = summarize(page_count_values)
        scenario_score_summary = summarize(scenario_score_values)
        help_summary = summarize(help_values)
        error_summary = summarize(error_values)
        major_error_summary = summarize(major_error_values)
        step_accuracy_summary = summarize(step_accuracy_values)
        short_form_accuracy_summary = summarize(short_form_accuracy_values)

        summary_rows.append({
            'task_id': task_id,
            'task_label': task_label,
            'allocation_group': group,
            'n': len(rows),
            'duration_mean_s': duration_summary['mean'],
            'duration_sd_s': duration_summary['sd'],
            'duration_median_s': duration_summary['median'],
            'duration_q1_s': duration_summary['q1'],
            'duration_q3_s': duration_summary['q3'],
            'page_dwell_mean_s': dwell_summary['mean'],
            'page_dwell_sd_s': dwell_summary['sd'],
            'page_count_mean': page_count_summary['mean'],
            'page_count_sd': page_count_summary['sd'],
            'scenario_score_mean': scenario_score_summary['mean'],
            'scenario_score_sd': scenario_score_summary['sd'],
            'help_mean': help_summary['mean'],
            'help_sd': help_summary['sd'],
            'error_mean': error_summary['mean'],
            'error_sd': error_summary['sd'],
            'major_error_mean': major_error_summary['mean'],
            'major_error_sd': major_error_summary['sd'],
            'step_accuracy_mean': step_accuracy_summary['mean'],
            'step_accuracy_sd': step_accuracy_summary['sd'],
            'short_form_accuracy_mean': short_form_accuracy_summary['mean'],
            'short_form_accuracy_sd': short_form_accuracy_summary['sd'],
        })

    return summary_rows


def build_task_summary_markdown_rows(task_summary_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in task_summary_rows:
        rows.append({
            'Task': row['task_label'] or row['task_id'],
            'Task ID': row['task_id'],
            'Group': row['allocation_group'],
            'n': row['n'],
            'Duration mean ± SD (s)': format_mean_sd(row['duration_mean_s'], row['duration_sd_s']),
            'Errors mean ± SD': format_mean_sd(row['error_mean'], row['error_sd']),
            'Help mean ± SD': format_mean_sd(row['help_mean'], row['help_sd']),
            'Scenario score mean ± SD': format_mean_sd(row['scenario_score_mean'], row['scenario_score_sd']),
            'Step accuracy mean ± SD': format_mean_sd(row['step_accuracy_mean'], row['step_accuracy_sd']),
            'Short-form accuracy mean ± SD': format_mean_sd(row['short_form_accuracy_mean'], row['short_form_accuracy_sd']),
        })
    return rows


def build_prepost_participant_rows(participant_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for participant in participant_rows:
        group = str(participant.get('allocation_group') or '').strip().lower()
        participant_id = str(participant.get('participant_id') or '').strip()
        for comparator in PREPOST_COMPARATORS:
            if 'pre_key' in comparator:
                pre_key = str(comparator['pre_key'])
            else:
                pre_key = str(comparator['pre_key_digital'] if group == 'digital' else comparator['pre_key_physical'])
            post_key = str(comparator['post_key'])
            pre_value = to_number(participant.get(pre_key))
            post_value = to_number(participant.get(post_key))
            change_value = None
            if pre_value is not None and post_value is not None:
                change_value = float(post_value) - float(pre_value)
            rows.append({
                'participant_id': participant_id,
                'allocation_group': group,
                'comparator_key': comparator['key'],
                'comparator_label': comparator['label'],
                'pre_metric_key': pre_key,
                'post_metric_key': post_key,
                'pre_value': pre_value,
                'post_value': post_value,
                'change_value': change_value,
            })
    return rows


def build_prepost_summary_rows(prepost_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summary_rows: list[dict[str, Any]] = []
    for comparator in PREPOST_COMPARATORS:
        comparator_rows = [row for row in prepost_rows if row.get('comparator_key') == comparator['key']]
        digital_rows = [row for row in comparator_rows if row.get('allocation_group') == 'digital' and row.get('pre_value') is not None and row.get('post_value') is not None]
        physical_rows = [row for row in comparator_rows if row.get('allocation_group') == 'physical' and row.get('pre_value') is not None and row.get('post_value') is not None]

        digital_pre = [float(row['pre_value']) for row in digital_rows]
        digital_post = [float(row['post_value']) for row in digital_rows]
        digital_change = [float(row['change_value']) for row in digital_rows if row.get('change_value') is not None]
        physical_pre = [float(row['pre_value']) for row in physical_rows]
        physical_post = [float(row['post_value']) for row in physical_rows]
        physical_change = [float(row['change_value']) for row in physical_rows if row.get('change_value') is not None]

        digital_pre_summary = summarize(digital_pre)
        digital_post_summary = summarize(digital_post)
        digital_change_summary = summarize(digital_change)
        physical_pre_summary = summarize(physical_pre)
        physical_post_summary = summarize(physical_post)
        physical_change_summary = summarize(physical_change)

        change_diff = None
        if digital_change_summary['mean'] is not None and physical_change_summary['mean'] is not None:
            change_diff = float(digital_change_summary['mean']) - float(physical_change_summary['mean'])

        digital_wilcoxon = wilcoxon_signed_rank(digital_pre, digital_post)
        physical_wilcoxon = wilcoxon_signed_rank(physical_pre, physical_post)

        summary_rows.append({
            'comparator_key': comparator['key'],
            'comparator_label': comparator['label'],
            'digital_n': digital_change_summary['n'],
            'digital_pre_mean': digital_pre_summary['mean'],
            'digital_pre_sd': digital_pre_summary['sd'],
            'digital_post_mean': digital_post_summary['mean'],
            'digital_post_sd': digital_post_summary['sd'],
            'digital_change_mean': digital_change_summary['mean'],
            'digital_change_sd': digital_change_summary['sd'],
            'digital_wilcoxon_T': digital_wilcoxon['T'],
            'digital_wilcoxon_p': digital_wilcoxon['p'],
            'digital_wilcoxon_n_pairs': digital_wilcoxon['n_pairs'],
            'physical_n': physical_change_summary['n'],
            'physical_pre_mean': physical_pre_summary['mean'],
            'physical_pre_sd': physical_pre_summary['sd'],
            'physical_post_mean': physical_post_summary['mean'],
            'physical_post_sd': physical_post_summary['sd'],
            'physical_change_mean': physical_change_summary['mean'],
            'physical_change_sd': physical_change_summary['sd'],
            'physical_wilcoxon_T': physical_wilcoxon['T'],
            'physical_wilcoxon_p': physical_wilcoxon['p'],
            'physical_wilcoxon_n_pairs': physical_wilcoxon['n_pairs'],
            'mean_change_diff': change_diff,
            'permutation_p_change': permutation_p_value(digital_change, physical_change),
            'cliffs_delta_change': cliffs_delta(digital_change, physical_change),
        })

    return summary_rows


def build_prepost_summary_markdown_rows(summary_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in summary_rows:
        rows.append({
            'Comparator': row['comparator_label'],
            'Digital n': row['digital_n'],
            'Digital pre mean ± SD': format_mean_sd(row['digital_pre_mean'], row['digital_pre_sd']),
            'Digital post mean ± SD': format_mean_sd(row['digital_post_mean'], row['digital_post_sd']),
            'Digital change mean ± SD': format_mean_sd(row['digital_change_mean'], row['digital_change_sd']),
            'Digital Wilcoxon p': format_number(row.get('digital_wilcoxon_p'), 4),
            'Physical n': row['physical_n'],
            'Physical pre mean ± SD': format_mean_sd(row['physical_pre_mean'], row['physical_pre_sd']),
            'Physical post mean ± SD': format_mean_sd(row['physical_post_mean'], row['physical_post_sd']),
            'Physical change mean ± SD': format_mean_sd(row['physical_change_mean'], row['physical_change_sd']),
            'Physical Wilcoxon p': format_number(row.get('physical_wilcoxon_p'), 4),
            'Mean change diff (D-P)': format_number(row['mean_change_diff']),
            'Permutation p': format_number(row['permutation_p_change'], 4),
            "Cliff's delta": format_number(row['cliffs_delta_change']),
        })
    return rows


def describe_cliffs_delta_strength(delta_value: Any) -> str:
    if delta_value is None:
        return 'not available'
    magnitude = abs(float(delta_value))
    if magnitude < 0.147:
        return 'negligible'
    if magnitude < 0.33:
        return 'small'
    if magnitude < 0.474:
        return 'moderate'
    return 'large'


def describe_between_group_direction(mean_diff: Any, better: str) -> str:
    if mean_diff is None:
        return 'The direction of the group difference could not be estimated.'

    difference = float(mean_diff)
    if difference == 0:
        return 'The group means were equal in this sample.'

    if difference > 0:
        raw_direction = 'higher in the digital group than in the physical group'
        favored_group = 'digital' if better == 'higher' else 'physical'
    else:
        raw_direction = 'lower in the digital group than in the physical group'
        favored_group = 'digital' if better == 'lower' else 'physical'

    return f'The outcome was {raw_direction}, which favors the {favored_group} group on this metric.'


def describe_change_direction(change_diff: Any, better: str) -> str:
    if change_diff is None:
        return 'The between-group difference in change could not be estimated.'

    difference = float(change_diff)
    if difference == 0:
        return 'Both groups showed the same mean change in this sample.'

    if difference > 0:
        raw_direction = 'The digital group improved more than the physical group on average.'
        favored_group = 'digital' if better == 'higher' else 'physical'
    else:
        raw_direction = 'The physical group improved more than the digital group on average.'
        favored_group = 'physical' if better == 'higher' else 'digital'

    return f'{raw_direction} This direction favors the {favored_group} group on this comparator.'


def describe_significance(p_value: Any) -> str:
    if p_value is None:
        return 'There were not enough observations in both groups to compute the inferential comparison.'

    probability = float(p_value)
    if probability < 0.05:
        return f'The permutation p-value was {format_number(probability, 4)}, which is below the conventional 0.05 threshold and suggests evidence of a between-group difference.'

    return f'The permutation p-value was {format_number(probability, 4)}, which does not cross the conventional 0.05 threshold, so this first-pass analysis does not show clear evidence of a between-group difference.'


def describe_mwu_significance(p_value: Any) -> str:
    if p_value is None:
        return 'The Mann\u2013Whitney U test could not be computed.'
    probability = float(p_value)
    if probability < 0.05:
        return f'The Mann\u2013Whitney U p-value was {format_number(probability, 4)}, which is below the 0.05 threshold.'
    return f'The Mann\u2013Whitney U p-value was {format_number(probability, 4)}, which does not cross the 0.05 threshold.'


def build_between_group_analysis_section(test_rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        '## Between-group outcomes',
        '',
        'Each section below is auto-generated from the current pipeline outputs. For ordinal outcomes, Mann\u2013Whitney U is used as the primary test with the permutation test as a sensitivity analysis. For continuous and count outcomes, the permutation test remains the primary analysis with Mann\u2013Whitney U as a sensitivity check.',
        '',
    ]

    for row in test_rows:
        metadata = OUTCOME_BY_KEY.get(str(row['outcome_key']))
        if metadata is None:
            continue

        family = OUTCOME_FAMILIES[str(metadata['family'])]
        sensitivity_label = family.get('sensitivity_test')

        test_lines = [
            f"### {row['label']}",
            '',
            f"- Outcome type: {family['label']}",
            f"- Primary analysis: {family['primary_test']}",
        ]
        if sensitivity_label:
            test_lines.append(f"- Sensitivity analysis: {sensitivity_label}")
        test_lines.extend([
            f"- Effect size reported: {family['effect_size']}",
            f"- Rationale: {family['why']}",
            f"- Null hypothesis: there is no difference between the digital and physical groups for {str(row['label']).lower()}.",
            f"- Alternative hypothesis: there is a difference between the digital and physical groups for {str(row['label']).lower()}.",
            f"- Digital group summary: n = {row['digital_n']}, mean \u00b1 SD = {format_mean_sd(row['digital_mean'], row['digital_sd'])}, median [Q1, Q3] = {format_median_iqr(row['digital_median'], row['digital_q1'], row['digital_q3'])}.",
            f"- Physical group summary: n = {row['physical_n']}, mean \u00b1 SD = {format_mean_sd(row['physical_mean'], row['physical_sd'])}, median [Q1, Q3] = {format_median_iqr(row['physical_median'], row['physical_q1'], row['physical_q3'])}.",
            f"- Permutation test: mean difference (digital \u2212 physical) = {format_number(row['mean_diff'])}, permutation p = {format_number(row['permutation_p_value'], 4)}.",
            f"- Mann\u2013Whitney U test: U = {format_number(row.get('mann_whitney_U'), 1)}, p = {format_number(row.get('mann_whitney_p'), 4)}.",
            f"- Effect size: Cliff's delta = {format_number(row['cliffs_delta'])} ({describe_cliffs_delta_strength(row['cliffs_delta'])}).",
            f"- Directional interpretation: {describe_between_group_direction(row['mean_diff'], str(metadata['better']))}",
            f"- Statistical interpretation: {describe_significance(row['permutation_p_value'])} {describe_mwu_significance(row.get('mann_whitney_p'))}",
            '',
        ])
        lines.extend(test_lines)

    return lines


def describe_wilcoxon_within_group(group_label: str, wilcoxon_p: Any, wilcoxon_T: Any, n_pairs: Any) -> str:
    if wilcoxon_p is None:
        return f'The within-group Wilcoxon signed-rank test for the {group_label} group could not be computed (n_pairs = {n_pairs or 0}).'
    p = float(wilcoxon_p)
    if p < 0.05:
        return f'The {group_label} group showed a statistically significant within-group change (Wilcoxon T = {format_number(wilcoxon_T, 1)}, p = {format_number(p, 4)}, n_pairs = {n_pairs}).'
    return f'The {group_label} group did not show a statistically significant within-group change (Wilcoxon T = {format_number(wilcoxon_T, 1)}, p = {format_number(p, 4)}, n_pairs = {n_pairs}).'


def build_prepost_analysis_section(summary_rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        '## Pre/post matched questionnaire comparators',
        '',
        'These sections compare change scores between groups using a permutation test and report within-group paired Wilcoxon signed-rank tests to assess whether each group individually changed from baseline.',
        '',
    ]

    for row in summary_rows:
        metadata = PREPOST_COMPARATOR_BY_KEY.get(str(row['comparator_key']))
        if metadata is None:
            continue

        family = OUTCOME_FAMILIES[str(metadata['family'])]
        lines.extend([
            f"### {row['comparator_label']}",
            '',
            f"- Outcome type: {family['label']}",
            f"- Between-group analysis: {family['primary_test']}",
            f"- Within-group analysis: {family.get('within_test', 'N/A')}",
            f"- Effect size reported: {family['effect_size']}",
            f"- Rationale: {family['why']}",
            f"- Null hypothesis (between): the mean change from baseline to post-trial is the same in the digital and physical groups for {str(row['comparator_label']).lower()}.",
            f"- Alternative hypothesis (between): the mean change from baseline to post-trial differs between the digital and physical groups for {str(row['comparator_label']).lower()}.",
            f"- Digital group summary: n = {row['digital_n']}, pre mean \u00b1 SD = {format_mean_sd(row['digital_pre_mean'], row['digital_pre_sd'])}, post mean \u00b1 SD = {format_mean_sd(row['digital_post_mean'], row['digital_post_sd'])}, change mean \u00b1 SD = {format_mean_sd(row['digital_change_mean'], row['digital_change_sd'])}.",
            f"- Physical group summary: n = {row['physical_n']}, pre mean \u00b1 SD = {format_mean_sd(row['physical_pre_mean'], row['physical_pre_sd'])}, post mean \u00b1 SD = {format_mean_sd(row['physical_post_mean'], row['physical_post_sd'])}, change mean \u00b1 SD = {format_mean_sd(row['physical_change_mean'], row['physical_change_sd'])}.",
            f"- Between-group test: mean change difference (digital \u2212 physical) = {format_number(row['mean_change_diff'])}, permutation p = {format_number(row['permutation_p_change'], 4)}, Cliff's delta = {format_number(row['cliffs_delta_change'])} ({describe_cliffs_delta_strength(row['cliffs_delta_change'])}).",
            f"- Within-group test (digital): {describe_wilcoxon_within_group('digital', row.get('digital_wilcoxon_p'), row.get('digital_wilcoxon_T'), row.get('digital_wilcoxon_n_pairs'))}",
            f"- Within-group test (physical): {describe_wilcoxon_within_group('physical', row.get('physical_wilcoxon_p'), row.get('physical_wilcoxon_T'), row.get('physical_wilcoxon_n_pairs'))}",
            f"- Directional interpretation: {describe_change_direction(row['mean_change_diff'], str(metadata['better']))}",
            f"- Statistical interpretation: {describe_significance(row['permutation_p_change'])}",
            '',
        ])

    return lines


def build_statistical_analysis_report(test_rows: list[dict[str, Any]], prepost_summary_rows: list[dict[str, Any]], generated_at: str) -> str:
    lines = [
        '# Automated Statistical Analysis Notes',
        '',
        f'Generated at: {generated_at}',
        '',
        'This report provides per-metric statistical write-ups using permutation tests, Mann\u2013Whitney U tests, Cliff\'s delta effect sizes, and within-group Wilcoxon signed-rank tests where applicable.',
        '',
        '## Scope',
        '',
        '- Between-group outcomes use permutation tests and Mann\u2013Whitney U tests. For ordinal outcomes, Mann\u2013Whitney U is the primary test; for other outcome types, the permutation test is primary.',
        '- Pre/post comparators use between-group permutation tests on change scores and within-group Wilcoxon signed-rank tests to assess whether each group individually changed from baseline.',
        '- No formal multiple-comparison correction is applied; results should be interpreted with appropriate caution given the 15 comparisons.',
        '',
    ]

    lines.extend(build_between_group_analysis_section(test_rows))
    lines.extend(build_prepost_analysis_section(prepost_summary_rows))
    lines.extend([
        '## Notes',
        '',
        '- Ordinal (Likert-scale) outcomes use Mann\u2013Whitney U as the primary analysis because it respects rank ordering without assuming equal intervals.',
        '- Continuous and count outcomes use the permutation test as primary with Mann\u2013Whitney U as a sensitivity check.',
        '- Within-group Wilcoxon signed-rank tests on pre/post comparators address whether each group individually changed from baseline, complementing the between-group comparison.',
        '- Because several outcomes are small-sample, bounded, ordinal, or count-based, this narrative should be read together with the descriptive summaries rather than as a p-value-only report.',
        '',
    ])
    return '\n'.join(lines)


def to_csv(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ''
    fieldnames = list(rows[0].keys())
    from io import StringIO

    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def ensure_directories() -> None:
    TABLES_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    CHAT_EVAL_DIR.mkdir(parents=True, exist_ok=True)


def clear_previous_outputs() -> list[str]:
    cleared: list[str] = []
    managed_directories = [TABLES_DIR, REPORTS_DIR, FIGURES_DIR, CHAT_EVAL_DIR]

    for directory in managed_directories:
        if not directory.exists():
            continue
        for path in directory.iterdir():
            if not path.is_file():
                continue
            path.unlink()
            cleared.append(str(path))

    return cleared


def shorten_label(value: str, max_length: int = 42) -> str:
    text = str(value or '').strip()
    if len(text) <= max_length:
        return text
    return f"{text[:max_length - 1].rstrip()}…"


def sort_task_ids(task_id: str) -> tuple[int, int | str]:
  if task_id.startswith('scenario_card_'):
    suffix = task_id.removeprefix('scenario_card_')
    return (0, int(suffix) if suffix.isdigit() else suffix)
  if task_id.startswith('short_form_q'):
    suffix = task_id.removeprefix('short_form_q')
    return (1, int(suffix) if suffix.isdigit() else suffix)
  return (2, task_id)


def build_task_axis_label(task_id: str, task_label: str) -> str:
  if task_id.startswith('scenario_card_'):
    suffix = task_id.removeprefix('scenario_card_')
    return f'Scenario {suffix}'
  if task_id.startswith('short_form_q'):
    suffix = task_id.removeprefix('short_form_q')
    return f'Q{suffix}'
  return shorten_label(task_label or task_id, 24)


def save_figure(fig: Any, stem: str) -> Path:
    latest = FIGURES_DIR / f'{stem}-latest.png'
    fig.savefig(latest, dpi=200, bbox_inches='tight')
    plt.close(fig)
    return latest


def save_html_document(content: str, stem: str) -> Path:
  latest_html = FIGURES_DIR / f'{stem}-latest.html'
  latest_html.write_text(content, encoding='utf-8')
  return latest_html


def format_page_node_label(page_path: str) -> str:
  raw_path = decode_page_path(page_path).strip('/')
  if not raw_path:
    return 'Unknown'
  parts = [part for part in raw_path.split('/') if part]
  filename = parts[-1] if parts else raw_path
  guide_labels = {
    'Airsense-10-User-Guide': 'AirSense 10',
    'F&P-Vitera-Full-Face-User-Guide': 'Vitera',
    'Resmed-ClimateLineAir-User-Guide': 'ClimateLineAir',
  }

  for part in parts:
    if part in guide_labels:
      return f'{guide_labels[part]} / {filename}'

  if len(parts) >= 2 and filename.lower() == 'index.html':
    return f'{parts[-2]} / {filename}'
  if len(parts) == 1:
    return parts[0]
  return '/'.join(parts[-2:])


def decode_page_path(page_path: str) -> str:
  decoded = str(page_path or '').strip()
  for _ in range(3):
    next_decoded = unquote(decoded)
    if next_decoded == decoded:
      break
    decoded = next_decoded
  return decoded


def format_page_hover_path(page_path: str) -> str:
  raw_path = decode_page_path(page_path)
  if not raw_path:
    return '/'
  return raw_path if raw_path.startswith('/') else f'/{raw_path}'


def format_page_flow_color(page_path: str, alpha: float) -> str:
  normalized = format_page_hover_path(page_path).lower()
  if '/airsense-10-user-guide/' in normalized:
    return f'rgba(37,99,235,{alpha})'
  if '/f&p-vitera-full-face-user-guide/' in normalized:
    return f'rgba(217,119,6,{alpha})'
  if '/resmed-climatelineair-user-guide/' in normalized:
    return f'rgba(5,150,105,{alpha})'
  if normalized in {'/cpap-devices/', '/cpap-devices/index.html'}:
    return f'rgba(71,85,105,{alpha})'
  if normalized in {'/', '/index.html'}:
    return f'rgba(107,114,128,{alpha})'
  return f'rgba(220,38,38,{alpha})'


def build_d3_sankey_html(title: str, payload: dict[str, Any]) -> str:
  template = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__TITLE__</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --panel: #ffffff;
      --ink: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --grid: #e2e8f0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Helvetica Neue", sans-serif;
      background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
      color: var(--ink);
    }
    .page {
      max-width: 100%;
      padding: 24px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }
    .header {
      padding: 20px 24px 12px;
      border-bottom: 1px solid var(--grid);
    }
    .title {
      margin: 0;
      font-size: 1.35rem;
      line-height: 1.2;
    }
    .subtitle {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .legend {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 12px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .legend-swatch {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.16);
    }
    .chart-wrap {
      padding: 8px 0 20px;
      overflow-x: auto;
    }
    svg {
      display: block;
      background: transparent;
    }
    .step-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      fill: #334155;
    }
    .step-guide {
      stroke: var(--grid);
      stroke-dasharray: 3 5;
    }
    .node rect {
      stroke: rgba(15, 23, 42, 0.28);
      stroke-width: 1;
      rx: 4;
    }
    .node text {
      font-size: 12px;
      fill: #0f172a;
      dominant-baseline: middle;
    }
    .link {
      fill: none;
      stroke-opacity: 0.38;
      mix-blend-mode: multiply;
      stroke-linecap: butt;
    }
    .link:hover {
      stroke-opacity: 0.72;
    }
    .tooltip {
      position: fixed;
      pointer-events: none;
      opacity: 0;
      background: rgba(15, 23, 42, 0.95);
      color: white;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 12px;
      line-height: 1.4;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
      max-width: 320px;
      transition: opacity 120ms ease;
      z-index: 20;
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="card">
      <header class="header">
        <h1 class="title">__TITLE__</h1>
        <p class="subtitle">Chronological page flow for digital participants. Hover nodes or links for exact paths and transition counts.</p>
        <div class="legend">
          <span class="legend-item"><span class="legend-swatch" style="background: rgba(37,99,235,0.7)"></span>AirSense 10</span>
          <span class="legend-item"><span class="legend-swatch" style="background: rgba(217,119,6,0.7)"></span>Vitera</span>
          <span class="legend-item"><span class="legend-swatch" style="background: rgba(5,150,105,0.7)"></span>ClimateLineAir</span>
          <span class="legend-item"><span class="legend-swatch" style="background: rgba(71,85,105,0.7)"></span>CPAP-devices</span>
          <span class="legend-item"><span class="legend-swatch" style="background: rgba(107,114,128,0.7)"></span>Landing pages</span>
        </div>
      </header>
      <div class="chart-wrap" id="chart"></div>
    </section>
  </div>
  <div class="tooltip" id="tooltip"></div>
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js"></script>
  <script>
    const data = __DATA__;
    const margin = { top: 58, right: 260, bottom: 24, left: 180 };
    const width = data.width;
    const height = data.height;

    const container = d3.select('#chart');
    const svg = container.append('svg')
      .attr('width', width)
      .attr('height', height);

    const tooltip = d3.select('#tooltip');
    const graph = {
      nodes: data.nodes.map(node => ({ ...node })),
      links: data.links.map(link => ({ ...link }))
    };

    const sankey = d3.sankey()
      .nodeId(node => node.id)
      .nodeAlign(d3.sankeyLeft)
      .nodeWidth(14)
      .nodePadding(data.nodePadding)
      .nodeSort((left, right) => left.sortIndex - right.sortIndex)
      .linkSort((left, right) => (left.target.sortIndex - right.target.sortIndex) || (left.source.sortIndex - right.source.sortIndex))
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

    sankey(graph);

    svg.append('g')
      .selectAll('line')
      .data(data.steps)
      .join('line')
      .attr('class', 'step-guide')
      .attr('x1', step => step.x)
      .attr('x2', step => step.x)
      .attr('y1', margin.top - 20)
      .attr('y2', height - margin.bottom + 4);

    svg.append('g')
      .selectAll('text')
      .data(data.steps)
      .join('text')
      .attr('class', 'step-label')
      .attr('x', step => step.x)
      .attr('y', margin.top - 30)
      .attr('text-anchor', 'middle')
      .text(step => step.label);

    const linkGroup = svg.append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('class', 'link')
      .attr('d', d3.sankeyLinkHorizontal())
      .attr('stroke', link => link.color)
      .attr('stroke-width', link => Math.max(1, link.width));

    linkGroup.append('title')
      .text(link => `${link.transition}\nTransitions: ${link.count}`);

    const nodeGroup = svg.append('g')
      .selectAll('g')
      .data(graph.nodes)
      .join('g')
      .attr('class', 'node');

    nodeGroup.append('rect')
      .attr('x', node => node.x0)
      .attr('y', node => node.y0)
      .attr('height', node => Math.max(8, node.y1 - node.y0))
      .attr('width', node => node.x1 - node.x0)
      .attr('fill', node => node.color)
      .append('title')
      .text(node => `${node.fullPath}\nStep ${node.step}`);

    nodeGroup.append('text')
      .attr('x', node => node.x0 < width / 2 ? node.x1 + 8 : node.x0 - 8)
      .attr('y', node => (node.y0 + node.y1) / 2)
      .attr('text-anchor', node => node.x0 < width / 2 ? 'start' : 'end')
      .text(node => node.label);

    const showTooltip = (event, html) => {
      tooltip.html(html)
        .style('opacity', 1)
        .style('left', `${event.clientX + 14}px`)
        .style('top', `${event.clientY + 14}px`);
    };

    const hideTooltip = () => {
      tooltip.style('opacity', 0);
    };

    nodeGroup
      .on('mousemove', (event, node) => {
        showTooltip(event, `<strong>${node.label}</strong><br>${node.fullPath}<br>Step ${node.step}`);
      })
      .on('mouseleave', hideTooltip);

    linkGroup
      .on('mousemove', (event, link) => {
        showTooltip(event, `<strong>${link.transition}</strong><br>Transitions: ${link.count}`);
      })
      .on('mouseleave', hideTooltip);
  </script>
</body>
</html>
"""
  return template.replace('__TITLE__', html_escape(title)).replace('__DATA__', json.dumps(payload))


def build_scenario_sankey_stem(task_id: str) -> str:
  if task_id.startswith('scenario_card_'):
    suffix = task_id.removeprefix('scenario_card_')
    return f'starter-digital-scenario-{suffix}-page-flow-sankey'
  return f"starter-{task_id.replace('_', '-')}-page-flow-sankey"


def create_group_distribution_figure(rows: list[dict[str, Any]], key: str, title: str, ylabel: str) -> Any | None:
    groups = [('digital', '#2563eb'), ('physical', '#dc2626')]
    values_by_group: list[list[float]] = []
    colors: list[str] = []
    for group_name, color in groups:
        values = [float(row[key]) for row in rows if row.get('allocation_group') == group_name and to_number(row.get(key)) is not None]
        values_by_group.append(values)
        colors.append(color)

    if not any(values_by_group):
        return None

    fig, ax = plt.subplots(figsize=(7.5, 5))
    valid_positions = []
    valid_values = []
    valid_colors = []
    valid_labels = []
    for idx, ((group_name, color), values) in enumerate(zip(groups, values_by_group), start=1):
        if not values:
            continue
        valid_positions.append(idx)
        valid_values.append(values)
        valid_colors.append(color)
        valid_labels.append(group_name.title())

    bp = ax.boxplot(valid_values, positions=valid_positions, patch_artist=True, widths=0.5, showfliers=False)
    for patch, color in zip(bp['boxes'], valid_colors):
        patch.set(facecolor=color, alpha=0.28, edgecolor=color, linewidth=1.5)
    for median_line in bp['medians']:
        median_line.set(color='#111827', linewidth=1.5)

    rng = random.Random(42)
    for position, values, color in zip(valid_positions, valid_values, valid_colors):
        jitter = [position + rng.uniform(-0.08, 0.08) for _ in values]
        ax.scatter(jitter, values, color=color, alpha=0.8, s=28, edgecolors='white', linewidths=0.4)
        ax.scatter([position], [sum(values) / len(values)], color='#111827', marker='D', s=48, zorder=4)

    ax.set_xticks(valid_positions)
    ax.set_xticklabels(valid_labels)
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(axis='y', linestyle=':', alpha=0.4)
    return fig


def create_digital_trait_scatter_figure(
  participant_rows: list[dict[str, Any]],
  x_key: str,
  y_key: str,
  title: str,
  xlabel: str,
  ylabel: str,
) -> Any | None:
  points: list[tuple[str, float, float]] = []
  for row in participant_rows:
    if row.get('allocation_group') != 'digital':
      continue
    x_value = to_number(row.get(x_key))
    y_value = to_number(row.get(y_key))
    if x_value is None or y_value is None:
      continue
    participant_id = str(row.get('participant_id') or '').strip()
    if not participant_id:
      continue
    points.append((participant_id, float(x_value), float(y_value)))

  if len(points) < 2:
    return None

  rng = random.Random(42)
  x_values = [point[1] for point in points]
  y_values = [point[2] for point in points]
  x_min = min(x_values)
  x_max = max(x_values)
  x_span = x_max - x_min
  jitter_scale = 0.08 if x_span <= 6 else max(0.02, x_span * 0.015)
  jittered_x = [x_value + rng.uniform(-jitter_scale, jitter_scale) for _participant_id, x_value, _y_value in points]

  fig, ax = plt.subplots(figsize=(7.8, 5.6))
  ax.scatter(jittered_x, y_values, color='#2563eb', alpha=0.85, s=54, edgecolors='white', linewidths=0.7, zorder=3)

  if len(set(x_values)) >= 2:
    mean_x = sum(x_values) / len(x_values)
    mean_y = sum(y_values) / len(y_values)
    numerator = sum((x_value - mean_x) * (y_value - mean_y) for x_value, y_value in zip(x_values, y_values))
    denominator = sum((x_value - mean_x) ** 2 for x_value in x_values)
    if denominator > 0:
      slope = numerator / denominator
      intercept = mean_y - (slope * mean_x)
      line_x = [x_min, x_max]
      line_y = [(slope * value) + intercept for value in line_x]
      ax.plot(line_x, line_y, color='#0f172a', linewidth=1.6, linestyle='--', alpha=0.8, zorder=2)

  y_span = max(y_values) - min(y_values)
  label_offset = max(3.0, y_span * 0.015)
  for (participant_id, _x_value, y_value), x_value in zip(points, jittered_x):
    ax.text(x_value + (jitter_scale * 0.25), y_value + label_offset, participant_id, fontsize=8.5, color='#334155')

  x_padding = max(0.25, (x_span * 0.08) if x_span > 0 else 0.5)
  ax.set_xlim(x_min - x_padding, x_max + x_padding)
  ax.set_title(title)
  ax.set_xlabel(xlabel)
  ax.set_ylabel(ylabel)
  ax.grid(True, linestyle=':', alpha=0.35)
  fig.tight_layout()
  return fig


def compute_task_span_seconds_by_participant(task_rows: list[dict[str, Any]], start_task_id: str, end_task_id: str) -> dict[str, float]:
  start_times: dict[str, datetime] = {}
  end_times: dict[str, datetime] = {}

  for row in task_rows:
    participant_id = str(row.get('participant_id') or '').strip()
    task_id = str(row.get('task_id') or '').strip()
    if not participant_id or task_id not in {start_task_id, end_task_id}:
      continue

    raw_started_at = str(row.get('task_started_at') or '').strip()
    raw_ended_at = str(row.get('task_ended_at') or '').strip()
    started_at = None
    ended_at = None
    try:
      started_at = datetime.fromisoformat(raw_started_at.replace('Z', '+00:00')) if raw_started_at else None
    except ValueError:
      started_at = None
    try:
      ended_at = datetime.fromisoformat(raw_ended_at.replace('Z', '+00:00')) if raw_ended_at else None
    except ValueError:
      ended_at = None

    if task_id == start_task_id and started_at is not None:
      existing_start = start_times.get(participant_id)
      if existing_start is None or started_at < existing_start:
        start_times[participant_id] = started_at
    if task_id == end_task_id and ended_at is not None:
      existing_end = end_times.get(participant_id)
      if existing_end is None or ended_at > existing_end:
        end_times[participant_id] = ended_at

  spans: dict[str, float] = {}
  for participant_id, started_at in start_times.items():
    ended_at = end_times.get(participant_id)
    if ended_at is None or ended_at <= started_at:
      continue
    spans[participant_id] = (ended_at - started_at).total_seconds()
  return spans


def create_participant_metric_scatter_figure(
  participant_rows: list[dict[str, Any]],
  metric_by_participant: dict[str, float],
  x_key: str,
  title: str,
  xlabel: str,
  ylabel: str,
  allocation_group: str | None = None,
) -> Any | None:
  points: list[tuple[str, str, float, float]] = []
  for row in participant_rows:
    participant_id = str(row.get('participant_id') or '').strip()
    if not participant_id or participant_id not in metric_by_participant:
      continue
    group_name = str(row.get('allocation_group') or '').strip()
    if allocation_group is not None and group_name != allocation_group:
      continue
    x_value = to_number(row.get(x_key))
    if x_value is None:
      continue
    points.append((participant_id, group_name, float(x_value), float(metric_by_participant[participant_id])))

  if len(points) < 2:
    return None

  group_colors = {
    'digital': '#2563eb',
    'physical': '#dc2626',
  }
  rng = random.Random(42)
  x_values = [point[2] for point in points]
  y_values = [point[3] for point in points]
  x_min = min(x_values)
  x_max = max(x_values)
  x_span = x_max - x_min
  jitter_scale = 0.08 if x_span <= 6 else max(0.02, x_span * 0.015)
  jittered_points = [
    (participant_id, group_name, x_value + rng.uniform(-jitter_scale, jitter_scale), y_value)
    for participant_id, group_name, x_value, y_value in points
  ]

  fig, ax = plt.subplots(figsize=(7.8, 5.6))
  present_groups = [group_name for group_name in ('digital', 'physical') if any(point[1] == group_name for point in points)]
  for group_name in present_groups:
    group_points = [point for point in jittered_points if point[1] == group_name]
    ax.scatter(
      [point[2] for point in group_points],
      [point[3] for point in group_points],
      color=group_colors[group_name],
      alpha=0.85,
      s=54,
      edgecolors='white',
      linewidths=0.7,
      zorder=3,
      label=group_name.title(),
    )

  if len(set(x_values)) >= 2:
    mean_x = sum(x_values) / len(x_values)
    mean_y = sum(y_values) / len(y_values)
    numerator = sum((x_value - mean_x) * (y_value - mean_y) for x_value, y_value in zip(x_values, y_values))
    denominator = sum((x_value - mean_x) ** 2 for x_value in x_values)
    if denominator > 0:
      slope = numerator / denominator
      intercept = mean_y - (slope * mean_x)
      line_x = [x_min, x_max]
      line_y = [(slope * value) + intercept for value in line_x]
      ax.plot(line_x, line_y, color='#0f172a', linewidth=1.6, linestyle='--', alpha=0.8, zorder=2)

  x_padding = max(0.25, (x_span * 0.08) if x_span > 0 else 0.5)
  ax.set_xlim(x_min - x_padding, x_max + x_padding)
  ax.set_title(title)
  ax.set_xlabel(xlabel)
  ax.set_ylabel(ylabel)
  ax.grid(True, linestyle=':', alpha=0.35)
  if len(present_groups) > 1:
    ax.legend(frameon=False, loc='upper right')
  fig.tight_layout()
  return fig


def create_task_duration_by_group_figure(task_rows: list[dict[str, Any]], task_prefix: str, duration_key: str, title: str, ylabel: str) -> Any | None:
    groups = [('digital', '#2563eb'), ('physical', '#dc2626')]
    grouped_tasks: dict[str, dict[str, Any]] = {}

    for row in task_rows:
        task_id = str(row.get('task_id') or '').strip()
        group_name = str(row.get('allocation_group') or '').strip()
        duration_value = to_number(row.get(duration_key))
        if not task_id.startswith(task_prefix) or group_name not in {'digital', 'physical'} or duration_value is None:
            continue

        task_entry = grouped_tasks.setdefault(task_id, {
            'task_label': str(row.get('task_label') or '').strip(),
            'digital': [],
            'physical': [],
        })
        if not task_entry['task_label']:
            task_entry['task_label'] = str(row.get('task_label') or '').strip()
        task_entry[group_name].append(float(duration_value))

    ordered_task_ids = [
        task_id
        for task_id in sorted(grouped_tasks.keys(), key=sort_task_ids)
        if grouped_tasks[task_id]['digital'] or grouped_tasks[task_id]['physical']
    ]
    if not ordered_task_ids:
        return None

    fig_width = max(8.0, len(ordered_task_ids) * 2.4)
    fig, ax = plt.subplots(figsize=(fig_width, 6))
    box_values: list[list[float]] = []
    box_positions: list[float] = []
    box_colors: list[str] = []
    tick_positions: list[float] = []
    tick_labels: list[str] = []

    for index, task_id in enumerate(ordered_task_ids, start=1):
        task_entry = grouped_tasks[task_id]
        tick_positions.append(float(index))
        tick_labels.append(build_task_axis_label(task_id, str(task_entry['task_label'] or '')))
        for offset, (group_name, color) in zip((-0.18, 0.18), groups):
            values = list(task_entry[group_name])
            if not values:
                continue
            box_values.append(values)
            box_positions.append(index + offset)
            box_colors.append(color)

    if not box_values:
        plt.close(fig)
        return None

    bp = ax.boxplot(box_values, positions=box_positions, patch_artist=True, widths=0.28, showfliers=False)
    for patch, color in zip(bp['boxes'], box_colors):
        patch.set(facecolor=color, alpha=0.28, edgecolor=color, linewidth=1.5)
    for whisker, color in zip(bp['whiskers'], [color for color in box_colors for _ in (0, 1)]):
        whisker.set(color=color, linewidth=1.2)
    for cap, color in zip(bp['caps'], [color for color in box_colors for _ in (0, 1)]):
        cap.set(color=color, linewidth=1.2)
    for median_line in bp['medians']:
        median_line.set(color='#111827', linewidth=1.5)

    rng = random.Random(42)
    for position, values, color in zip(box_positions, box_values, box_colors):
        jitter = [position + rng.uniform(-0.045, 0.045) for _ in values]
        ax.scatter(jitter, values, color=color, alpha=0.78, s=24, edgecolors='white', linewidths=0.35, zorder=3)
        ax.scatter([position], [sum(values) / len(values)], color='#111827', marker='D', s=40, zorder=4)

    ax.set_xticks(tick_positions)
    ax.set_xticklabels(tick_labels)
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(axis='y', linestyle=':', alpha=0.4)
    ax.set_xlim(0.5, len(tick_positions) + 0.5)

    legend_handles = [plt.Rectangle((0, 0), 1, 1, facecolor=color, edgecolor=color, alpha=0.28) for _, color in groups]
    ax.legend(legend_handles, [group_name.title() for group_name, _ in groups], frameon=False, loc='upper right')
    fig.tight_layout()
    return fig


def create_scenario_page_flow_sankey_figures(transition_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
  grouped: dict[str, dict[str, Any]] = {}
  for row in transition_rows:
    task_id = str(row.get('task_id') or '').strip()
    source_page = str(row.get('source_page') or '').strip()
    target_page = str(row.get('target_page') or '').strip()
    transition_count = int(to_number(row.get('transition_count')) or 0)
    source_step = int(to_number(row.get('source_step')) or 0)
    target_step = int(to_number(row.get('target_step')) or 0)
    if not task_id.startswith('scenario_card_') or not source_page or not target_page or transition_count <= 0:
      continue
    if source_step <= 0 or target_step <= 0 or target_step <= source_step:
      continue

    task_entry = grouped.setdefault(task_id, {
      'task_label': str(row.get('task_label') or '').strip(),
      'transitions': {},
      'page_totals': {},
    })
    transition_key = (source_step, source_page, target_step, target_page)
    task_entry['transitions'][transition_key] = task_entry['transitions'].get(transition_key, 0) + transition_count
    task_entry['page_totals'][source_page] = task_entry['page_totals'].get(source_page, 0) + transition_count
    task_entry['page_totals'][target_page] = task_entry['page_totals'].get(target_page, 0) + transition_count

  ordered_task_ids = [task_id for task_id in sorted(grouped.keys(), key=sort_task_ids) if grouped[task_id]['transitions']]
  if not ordered_task_ids:
    return []

  outputs: list[dict[str, Any]] = []
  for task_id in ordered_task_ids:
    task_entry = grouped[task_id]
    collapsed: dict[tuple[int, str, int, str], int] = {}
    stage_totals: dict[int, dict[str, int]] = {}
    max_step = 0

    for (source_step, source_page, target_step, target_page), value in task_entry['transitions'].items():
      transition_key = (source_step, source_page, target_step, target_page)
      collapsed[transition_key] = collapsed.get(transition_key, 0) + value

      source_stage = stage_totals.setdefault(source_step, {})
      source_stage[source_page] = source_stage.get(source_page, 0) + value

      target_stage = stage_totals.setdefault(target_step, {})
      target_stage[target_page] = target_stage.get(target_page, 0) + value

      max_step = max(max_step, target_step)

    links = sorted(
      collapsed.items(),
      key=lambda item: (item[0][0], item[0][2], -item[1], item[0][1], item[0][3]),
    )
    if not links or max_step < 2:
      continue

    max_nodes_in_step = max(len(nodes) for nodes in stage_totals.values())
    incoming_edges: dict[tuple[int, str], list[tuple[int, str, int]]] = {}
    outgoing_edges: dict[tuple[int, str], list[tuple[int, str, int]]] = {}
    for (source_step, source_page, target_step, target_page), value in links:
      outgoing_edges.setdefault((source_step, source_page), []).append((target_step, target_page, value))
      incoming_edges.setdefault((target_step, target_page), []).append((source_step, source_page, value))

    ordered_pages_by_step: dict[int, list[str]] = {
      step: [
        page
        for page, _value in sorted(
          nodes.items(),
          key=lambda item: (-item[1], format_page_node_label(item[0]).lower()),
        )
      ]
      for step, nodes in stage_totals.items()
    }

    def compute_barycenter(neighbors: list[tuple[int, str, int]], step_order: dict[int, dict[str, int]]) -> float | None:
      weighted_total = 0.0
      weight_sum = 0.0
      for neighbor_step, neighbor_page, weight in neighbors:
        position = step_order.get(neighbor_step, {}).get(neighbor_page)
        if position is None:
          continue
        weighted_total += float(position) * float(weight)
        weight_sum += float(weight)
      if weight_sum <= 0:
        return None
      return weighted_total / weight_sum

    for _iteration in range(6):
      step_order = {
        step: {page: index for index, page in enumerate(pages)}
        for step, pages in ordered_pages_by_step.items()
      }
      for step in range(2, max_step + 1):
        pages = ordered_pages_by_step.get(step, [])
        pages.sort(
          key=lambda page: (
            1 if compute_barycenter(incoming_edges.get((step, page), []), step_order) is None else 0,
            step_order.get(step, {}).get(page, 0)
            if compute_barycenter(incoming_edges.get((step, page), []), step_order) is None
            else float(compute_barycenter(incoming_edges.get((step, page), []), step_order)),
            -stage_totals[step][page],
            format_page_node_label(page).lower(),
          )
        )

      step_order = {
        step: {page: index for index, page in enumerate(pages)}
        for step, pages in ordered_pages_by_step.items()
      }
      for step in range(max_step - 1, 0, -1):
        pages = ordered_pages_by_step.get(step, [])
        pages.sort(
          key=lambda page: (
            1 if compute_barycenter(outgoing_edges.get((step, page), []), step_order) is None else 0,
            step_order.get(step, {}).get(page, 0)
            if compute_barycenter(outgoing_edges.get((step, page), []), step_order) is None
            else float(compute_barycenter(outgoing_edges.get((step, page), []), step_order)),
            -stage_totals[step][page],
            format_page_node_label(page).lower(),
          )
        )

    ordered_nodes: list[tuple[int, str]] = []
    for step in sorted(stage_totals.keys()):
      pages_for_step = ordered_pages_by_step.get(step, [])
      for index, page in enumerate(pages_for_step):
        ordered_nodes.append((step, page))

    if not ordered_nodes:
      continue

    width = max(1400, 320 + (max_step * 220))
    height = max(720, 180 + (max_nodes_in_step * 72))
    steps = [
      {
        'step': step,
        'label': 'Start' if step == 1 else ('End' if step == max_step else f'Step {step}'),
        'x': 180 + ((width - 440) * ((step - 1) / max(1, max_step - 1))),
      }
      for step in range(1, max_step + 1)
    ]
    nodes = [
      {
        'id': f'{step}|{page}',
        'label': format_page_node_label(page),
        'fullPath': format_page_hover_path(page),
        'step': step,
        'sortIndex': index,
        'color': format_page_flow_color(page, 0.84),
      }
      for index, (step, page) in enumerate(ordered_nodes)
    ]
    graph_links = [
      {
        'source': f'{source_step}|{source_page}',
        'target': f'{target_step}|{target_page}',
        'value': value,
        'count': value,
        'color': format_page_flow_color(target_page, 0.52),
        'transition': f'Step {source_step}: {format_page_hover_path(source_page)} -> Step {target_step}: {format_page_hover_path(target_page)}',
      }
      for (source_step, source_page, target_step, target_page), value in links
    ]
    title = f'{build_task_axis_label(task_id, str(task_entry["task_label"] or ""))} digital page-flow Sankey'
    outputs.append({
      'task_id': task_id,
      'label': title,
      'stem': build_scenario_sankey_stem(task_id),
      'html': build_d3_sankey_html(title, {
        'width': width,
        'height': height,
        'nodePadding': 22,
        'steps': steps,
        'nodes': nodes,
        'links': graph_links,
      }),
    })

  return outputs


def create_post_trial_likert_figure(rows: list[dict[str, Any]]) -> Any | None:
    grouped_rows = {
        'digital': [row for row in rows if row.get('allocation_group') == 'digital'],
        'physical': [row for row in rows if row.get('allocation_group') == 'physical'],
    }

    if not any(grouped_rows.values()):
        return None

    colors = {
        1: '#b91c1c',
        2: '#ef4444',
        3: '#d1d5db',
        4: '#60a5fa',
        5: '#1d4ed8',
    }
    fig, axes = plt.subplots(1, 2, figsize=(15, 8), sharey=True)
    has_any_data = False

    for ax, (group_name, group_rows) in zip(axes, grouped_rows.items()):
        item_labels: list[str] = []
        distributions: list[dict[int, float]] = []
        for key, label in POST_TRIAL_LIKERT_ITEMS:
            numeric = [int(to_number(row.get(key))) for row in group_rows if to_number(row.get(key)) in {1, 2, 3, 4, 5}]
            if not numeric:
                continue
            has_any_data = True
            total = len(numeric)
            percentages = {score: (numeric.count(score) / total) * 100 for score in range(1, 6)}
            item_labels.append(label)
            distributions.append(percentages)

        if not distributions:
            ax.set_title(f'{group_name.title()} (no post-trial data)')
            ax.axis('off')
            continue

        y_positions = list(range(len(item_labels)))
        for idx, percentages in enumerate(distributions):
            negative_left = -(percentages[1] + percentages[2] + (percentages[3] / 2))
            ax.barh(idx, percentages[1], left=negative_left, color=colors[1], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[2], left=negative_left + percentages[1], color=colors[2], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[3] / 2, left=-(percentages[3] / 2), color=colors[3], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[3] / 2, left=0, color=colors[3], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[4], left=percentages[3] / 2, color=colors[4], edgecolor='white', height=0.75)
            ax.barh(idx, percentages[5], left=(percentages[3] / 2) + percentages[4], color=colors[5], edgecolor='white', height=0.75)

        ax.axvline(0, color='#111827', linewidth=0.8)
        ax.set_yticks(y_positions)
        ax.set_yticklabels(item_labels)
        ax.invert_yaxis()
        ax.set_title(f'{group_name.title()} post-trial responses')
        ax.set_xlabel('Response distribution (%)')
        ax.set_xlim(-100, 100)
        ax.grid(axis='x', linestyle=':', alpha=0.35)

    if not has_any_data:
        plt.close(fig)
        return None

    handles = [plt.Rectangle((0, 0), 1, 1, color=colors[score]) for score in range(1, 6)]
    fig.legend(handles, ['1', '2', '3', '4', '5'], loc='lower center', ncol=5, frameon=False, title='Likert response')
    fig.suptitle('Post-trial questionnaire response distributions', fontsize=14)
    fig.tight_layout(rect=(0, 0.05, 1, 0.96))
    return fig


def create_ranked_page_use_figure(page_usage_rows: list[dict[str, Any]], digital_participant_ids: set[str]) -> Any | None:
    page_totals: dict[str, dict[str, Any]] = {}
    for row in page_usage_rows:
        participant_id = str(row.get('participant_id') or '').strip()
        if not participant_id or participant_id not in digital_participant_ids:
            continue
        label = str(row.get('page_label') or row.get('page_path') or '').strip()
        if not label:
            continue
        entry = page_totals.setdefault(label, {'views': 0, 'participants': set()})
        entry['views'] += int(to_number(row.get('page_views')) or 0)
        entry['participants'].add(participant_id)

    ranked = sorted(
        (
            {
                'label': label,
                'views': values['views'],
                'participant_count': len(values['participants']),
            }
            for label, values in page_totals.items()
        ),
        key=lambda row: (-row['views'], row['label'].lower()),
    )[:10]

    if not ranked:
        return None

    ranked.reverse()
    labels = [shorten_label(row['label']) for row in ranked]
    views = [row['views'] for row in ranked]
    participant_counts = [row['participant_count'] for row in ranked]

    fig, ax = plt.subplots(figsize=(10, 6.5))
    bars = ax.barh(labels, views, color='#2563eb', alpha=0.8)
    ax.set_title('Most-viewed digital guide pages')
    ax.set_xlabel('Page views')
    ax.set_ylabel('Page')
    ax.grid(axis='x', linestyle=':', alpha=0.35)

    max_view = max(views) if views else 0
    for bar, participant_count in zip(bars, participant_counts):
        ax.text(
            bar.get_width() + max(max_view * 0.015, 0.2),
            bar.get_y() + (bar.get_height() / 2),
            f"n={participant_count}",
            va='center',
            ha='left',
            fontsize=9,
            color='#111827',
        )

    return fig


def generate_figures(participant_rows: list[dict[str, Any]], page_usage_rows: list[dict[str, Any]], task_rows: list[dict[str, Any]], scenario_transition_rows: list[dict[str, Any]]) -> list[dict[str, str]]:
  figure_outputs: list[dict[str, str]] = []
  participant_trial_span_seconds = compute_task_span_seconds_by_participant(task_rows, 'scenario_card_1', 'short_form_q4')

  for config in STARTER_FIGURES:
    fig = create_group_distribution_figure(participant_rows, config['key'], config['title'], config['ylabel'])
    if fig is None:
      continue
    latest = save_figure(fig, config['filename'])
    figure_outputs.append({
      'label': config['title'],
      'path': str(latest),
    })

  likert_fig = create_post_trial_likert_figure(participant_rows)
  if likert_fig is not None:
    latest = save_figure(likert_fig, 'starter-post-trial-likert')
    figure_outputs.append({
      'label': 'Post-trial questionnaire response distributions',
      'path': str(latest),
    })

  digital_participant_ids = {
    str(row.get('participant_id') or '').strip()
    for row in participant_rows
    if row.get('allocation_group') == 'digital'
  }
  page_use_fig = create_ranked_page_use_figure(page_usage_rows, digital_participant_ids)
  if page_use_fig is not None:
    latest = save_figure(page_use_fig, 'starter-digital-page-use')
    figure_outputs.append({
      'label': 'Most-viewed digital guide pages',
      'path': str(latest),
    })

  scenario_duration_fig = create_task_duration_by_group_figure(
    task_rows,
    'scenario_card_',
    'task_total_duration_seconds',
    'Scenario duration by scenario and group',
    'Duration (s)',
  )
  if scenario_duration_fig is not None:
    latest = save_figure(scenario_duration_fig, 'starter-scenario-duration-by-scenario')
    figure_outputs.append({
      'label': 'Scenario duration by scenario and group',
      'path': str(latest),
    })

  question_duration_fig = create_task_duration_by_group_figure(
    task_rows,
    'short_form_q',
    'short_form_duration_seconds',
    'Short-form question duration by question and group',
    'Duration (s)',
  )
  if question_duration_fig is not None:
    latest = save_figure(question_duration_fig, 'starter-short-form-duration-by-question')
    figure_outputs.append({
      'label': 'Short-form question duration by question and group',
      'path': str(latest),
    })

  digital_literacy_trial_span_fig = create_participant_metric_scatter_figure(
    participant_rows,
    participant_trial_span_seconds,
    'q6_digital_literacy',
    'Digital literacy vs Scenario 1 start to Q4 end time (digital group)',
    'Pre-trial digital literacy (1-5)',
    'Scenario 1 start to Q4 end time (s)',
    allocation_group='digital',
  )
  if digital_literacy_trial_span_fig is not None:
    latest = save_figure(digital_literacy_trial_span_fig, 'starter-digital-literacy-vs-full-trial-time')
    figure_outputs.append({
      'label': 'Digital literacy vs Scenario 1 start to Q4 end time (digital group)',
      'path': str(latest),
    })

  age_trial_span_fig = create_participant_metric_scatter_figure(
    participant_rows,
    participant_trial_span_seconds,
    'q1_age_years',
    'Age vs Scenario 1 start to Q4 end time (all participants)',
    'Age (years)',
    'Scenario 1 start to Q4 end time (s)',
  )
  if age_trial_span_fig is not None:
    latest = save_figure(age_trial_span_fig, 'starter-age-vs-full-trial-time')
    figure_outputs.append({
      'label': 'Age vs Scenario 1 start to Q4 end time (all participants)',
      'path': str(latest),
    })

  scenario_sankey_outputs = create_scenario_page_flow_sankey_figures(scenario_transition_rows)
  for output in scenario_sankey_outputs:
    latest = save_html_document(str(output['html']), str(output['stem']))
    figure_outputs.append({
      'label': str(output['label']),
      'path': str(latest),
    })

  return figure_outputs


def build_report(participant_rows: list[dict[str, Any]], test_rows: list[dict[str, Any]], group_summary_rows: list[dict[str, Any]], generated_at: str, figure_outputs: list[dict[str, str]]) -> str:
    group_counts = ', '.join(
        f"{row['group']}: n={row['n']}"
        for row in group_summary_rows
        if row['metric'] == '_participants'
    )

    top_signals = sorted(
        (row for row in test_rows if row['permutation_p_value'] is not None),
        key=lambda row: row['permutation_p_value'],
    )[:5]

    lines = [
        '# CPAP Trial Statistical Report (On-Demand)',
        '',
        f'Generated at: {generated_at}',
        f'Participants analyzed: {len(participant_rows)}',
        f'Group sizes: {group_counts or "NA"}',
        '',
        '## Summary table (group comparison)',
        '',
        "| Outcome | Digital n | Physical n | Digital mean | Physical mean | Mean diff (Digital - Physical) | Permutation p | Cliff's delta |",
        '|---|---:|---:|---:|---:|---:|---:|---:|',
    ]

    for row in test_rows:
        lines.append(
            f"| {row['label']} | {row['digital_n']} | {row['physical_n']} | {format_number(row['digital_mean'])} | {format_number(row['physical_mean'])} | {format_number(row['mean_diff'])} | {format_number(row['permutation_p_value'], 4)} | {format_number(row['cliffs_delta'])} |"
        )

    report_ready_rows = build_report_ready_rows(test_rows)
    lines.extend(['', '## Dissertation-ready table', ''])
    lines.extend(to_markdown_table(report_ready_rows).strip().splitlines())

    lines.extend(['', '## Quick interpretation', ''])
    if not top_signals:
        lines.append('- Insufficient data for inferential comparisons (need at least 2 participants per group per outcome).')
    else:
        for row in top_signals:
            lines.append(
                f"- {row['label']}: mean difference = {format_number(row['mean_diff'])}, permutation p = {format_number(row['permutation_p_value'], 4)} ({row['better_direction_hint']})."
            )

    lines.extend([
        '',
        '## Figures generated',
        '',
    ])
    if not figure_outputs:
      lines.append('- No figures were generated (likely insufficient data).')
    else:
      for figure in figure_outputs:
        lines.append(f"- {figure['label']}: {figure['path']}")

    lines.extend([
        '',
        '## Notes',
        '',
        '- This report is generated on demand from PostgreSQL (no scheduled timer).',
        '- P-values are permutation-based (default 5,000 shuffles) to reduce distributional assumptions for small samples.',
        '- Confirm primary endpoint definitions with your supervisor before final dissertation submission.',
        '',
    ])
    return '\n'.join(lines)


def fetch_query_rows(database_url: str, query: str) -> list[dict[str, Any]]:
  connect_kwargs: dict[str, Any] = {}
  if os.environ.get('PGSSLMODE') == 'require':
    connect_kwargs['sslmode'] = 'require'

  with psycopg.connect(database_url, **connect_kwargs) as connection:
    with connection.cursor() as cursor:
      cursor.execute(query)
      columns = [desc.name for desc in cursor.description]
      return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_rows(database_url: str) -> list[dict[str, Any]]:
  return fetch_query_rows(database_url, ANALYSIS_QUERY)


def fetch_page_usage_rows(database_url: str) -> list[dict[str, Any]]:
  return fetch_query_rows(database_url, PAGE_USAGE_QUERY)


def fetch_scenario_transition_rows(database_url: str) -> list[dict[str, Any]]:
  return fetch_query_rows(database_url, SCENARIO_PAGE_TRANSITIONS_QUERY)


def fetch_task_rows(database_url: str) -> list[dict[str, Any]]:
  return fetch_query_rows(database_url, TASK_LEVEL_QUERY)


def fetch_questionnaire_comment_rows(database_url: str) -> list[dict[str, Any]]:
  return fetch_query_rows(database_url, QUESTIONNAIRE_COMMENTS_QUERY)


def normalize_participant_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        normalized = dict(row)
        for key, value in list(normalized.items()):
            if key in {'participant_id', 'allocation_group'}:
                continue
            normalized[key] = to_number(value)
        normalized_rows.append(normalized)
    return normalized_rows


def normalize_task_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        normalized = dict(row)
        for key, value in list(normalized.items()):
            if key in {'session_id', 'participant_id', 'task_id', 'task_label', 'trial_mode', 'task_started_at', 'task_ended_at', 'allocation_group'}:
                continue
            normalized[key] = to_number(value)
        normalized_rows.append(normalized)
    return normalized_rows


def main() -> int:
    load_dotenv(DOTENV_PATH)
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print('DATABASE_URL is required. Set it in the environment or add it to a .env file in the workspace root.', file=sys.stderr)
        return 1

    participant_rows = normalize_participant_rows(fetch_rows(database_url))
    page_usage_rows = fetch_page_usage_rows(database_url)
    raw_task_rows = fetch_task_rows(database_url)
    scenario_transition_rows = fetch_scenario_transition_rows(database_url)
    questionnaire_comment_rows = fetch_questionnaire_comment_rows(database_url)
    allocation_group_by_participant = {
      str(row.get('participant_id') or '').strip(): str(row.get('allocation_group') or '').strip()
      for row in participant_rows
    }
    task_rows = normalize_task_rows([
      {
        **row,
        'allocation_group': allocation_group_by_participant.get(str(row.get('participant_id') or '').strip(), str(row.get('trial_mode') or '').strip()),
      }
      for row in raw_task_rows
    ])
    digital_rows = [row for row in participant_rows if row.get('allocation_group') == 'digital']
    physical_rows = [row for row in participant_rows if row.get('allocation_group') == 'physical']

    test_rows: list[dict[str, Any]] = []
    for outcome in OUTCOMES:
        digital_values = [float(row[outcome['key']]) for row in digital_rows if to_number(row.get(outcome['key'])) is not None]
        physical_values = [float(row[outcome['key']]) for row in physical_rows if to_number(row.get(outcome['key'])) is not None]

        digital_summary = summarize(digital_values)
        physical_summary = summarize(physical_values)
        mean_diff = None
        if digital_summary['mean'] is not None and physical_summary['mean'] is not None:
            mean_diff = float(digital_summary['mean']) - float(physical_summary['mean'])

        mwu_result = mann_whitney_u(digital_values, physical_values)
        test_rows.append({
            'outcome_key': outcome['key'],
            'label': outcome['label'],
            'better_direction_hint': outcome['better'],
            'digital_n': digital_summary['n'],
            'physical_n': physical_summary['n'],
            'digital_mean': digital_summary['mean'],
            'physical_mean': physical_summary['mean'],
            'digital_sd': digital_summary['sd'],
            'physical_sd': physical_summary['sd'],
            'digital_median': digital_summary['median'],
            'physical_median': physical_summary['median'],
          'digital_q1': digital_summary['q1'],
          'digital_q3': digital_summary['q3'],
          'physical_q1': physical_summary['q1'],
          'physical_q3': physical_summary['q3'],
            'mean_diff': mean_diff,
            'permutation_p_value': permutation_p_value(digital_values, physical_values),
            'cliffs_delta': cliffs_delta(digital_values, physical_values),
            'mann_whitney_U': mwu_result['U'],
            'mann_whitney_p': mwu_result['p'],
        })

    group_summary_rows: list[dict[str, Any]] = [
        {'metric': '_participants', 'group': 'digital', 'n': len(digital_rows), 'mean': None, 'sd': None, 'median': None, 'q1': None, 'q3': None},
        {'metric': '_participants', 'group': 'physical', 'n': len(physical_rows), 'mean': None, 'sd': None, 'median': None, 'q1': None, 'q3': None},
    ]

    for outcome in OUTCOMES:
        for group_name, rows in (('digital', digital_rows), ('physical', physical_rows)):
            values = [float(row[outcome['key']]) for row in rows if to_number(row.get(outcome['key'])) is not None]
            summary = summarize(values)
            group_summary_rows.append({
                'metric': outcome['key'],
                'group': group_name,
                'n': summary['n'],
                'mean': summary['mean'],
                'sd': summary['sd'],
                'median': summary['median'],
                'q1': summary['q1'],
                'q3': summary['q3'],
            })

    ensure_directories()
    cleared_outputs = clear_previous_outputs()
    generated_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    figure_outputs = generate_figures(participant_rows, page_usage_rows, task_rows, scenario_transition_rows)

    participant_csv = to_csv(participant_rows)
    tests_csv = to_csv(test_rows)
    summary_csv = to_csv(group_summary_rows)
    report_ready_rows = build_report_ready_rows(test_rows)
    report_ready_csv = to_csv(report_ready_rows)
    report_ready_md = to_markdown_table(report_ready_rows)
    task_by_participant_csv = to_csv(task_rows)
    task_summary_rows = build_task_summary_rows(task_rows)
    task_summary_csv = to_csv(task_summary_rows)
    task_summary_md = to_markdown_table(build_task_summary_markdown_rows(task_summary_rows))
    prepost_participant_rows = build_prepost_participant_rows(participant_rows)
    prepost_participant_csv = to_csv(prepost_participant_rows)
    prepost_summary_rows = build_prepost_summary_rows(prepost_participant_rows)
    prepost_summary_csv = to_csv(prepost_summary_rows)
    prepost_summary_md = to_markdown_table(build_prepost_summary_markdown_rows(prepost_summary_rows))
    report = build_report(participant_rows, test_rows, group_summary_rows, generated_at, figure_outputs)
    statistical_analysis_report = build_statistical_analysis_report(test_rows, prepost_summary_rows, generated_at)
    questionnaire_comments_md = build_questionnaire_comments_markdown(questionnaire_comment_rows, generated_at)

    participant_file = TABLES_DIR / 'participant-level-latest.csv'
    tests_file = TABLES_DIR / 'outcome-tests-latest.csv'
    summary_file = TABLES_DIR / 'group-summary-latest.csv'
    report_ready_csv_file = TABLES_DIR / 'dissertation-summary-table-latest.csv'
    report_ready_md_file = TABLES_DIR / 'dissertation-summary-table-latest.md'
    task_by_participant_file = TABLES_DIR / 'task-by-participant-latest.csv'
    task_summary_csv_file = TABLES_DIR / 'task-summary-by-group-latest.csv'
    task_summary_md_file = TABLES_DIR / 'task-summary-by-group-latest.md'
    prepost_participant_file = TABLES_DIR / 'questionnaire-prepost-by-participant-latest.csv'
    prepost_summary_csv_file = TABLES_DIR / 'questionnaire-prepost-summary-latest.csv'
    prepost_summary_md_file = TABLES_DIR / 'questionnaire-prepost-summary-latest.md'
    report_file = REPORTS_DIR / 'stats-report-latest.md'
    statistical_analysis_report_file = REPORTS_DIR / 'statistical-analysis-report-latest.md'
    questionnaire_comments_file = REPORTS_DIR / 'questionnaire-comments-latest.md'

    participant_file.write_text(participant_csv, encoding='utf8')
    tests_file.write_text(tests_csv, encoding='utf8')
    summary_file.write_text(summary_csv, encoding='utf8')
    report_ready_csv_file.write_text(report_ready_csv, encoding='utf8')
    report_ready_md_file.write_text(report_ready_md, encoding='utf8')
    task_by_participant_file.write_text(task_by_participant_csv, encoding='utf8')
    task_summary_csv_file.write_text(task_summary_csv, encoding='utf8')
    task_summary_md_file.write_text(task_summary_md, encoding='utf8')
    prepost_participant_file.write_text(prepost_participant_csv, encoding='utf8')
    prepost_summary_csv_file.write_text(prepost_summary_csv, encoding='utf8')
    prepost_summary_md_file.write_text(prepost_summary_md, encoding='utf8')
    report_file.write_text(report, encoding='utf8')
    statistical_analysis_report_file.write_text(statistical_analysis_report, encoding='utf8')
    questionnaire_comments_file.write_text(questionnaire_comments_md, encoding='utf8')

    print('Stats report generated successfully.')
    if cleared_outputs:
      print(f'- Cleared {len(cleared_outputs)} previous analysis output(s).')
    print(f'- {report_file}')
    print(f'- {statistical_analysis_report_file}')
    print(f'- {participant_file}')
    print(f'- {tests_file}')
    print(f'- {summary_file}')
    print(f'- {report_ready_csv_file}')
    print(f'- {report_ready_md_file}')
    print(f'- {task_by_participant_file}')
    print(f'- {task_summary_csv_file}')
    print(f'- {task_summary_md_file}')
    print(f'- {prepost_participant_file}')
    print(f'- {prepost_summary_csv_file}')
    print(f'- {prepost_summary_md_file}')
    print(f'- {questionnaire_comments_file}')
    for figure in figure_outputs:
      print(f"- {figure['path']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
