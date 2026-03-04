CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT,
  event_type TEXT NOT NULL,
  task_id TEXT,
  task_label TEXT,
  task_status TEXT,
  question_id TEXT,
  page_path TEXT,
  page_title TEXT,
  guide TEXT,
  family TEXT,
  query TEXT,
  result_count INTEGER,
  target_href TEXT,
  link_text TEXT,
  chat_message TEXT,
  response_message TEXT,
  response_length INTEGER,
  video_provider TEXT,
  video_id TEXT,
  video_title TEXT,
  video_url TEXT,
  video_action TEXT,
  video_current_time_ms INTEGER,
  video_duration_ms INTEGER,
  video_percent INTEGER,
  task_action_index INTEGER,
  duration_ms INTEGER,
  referrer TEXT,
  trial_mode TEXT NOT NULL DEFAULT 'digital'
);

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS response_message TEXT;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS task_action_index INTEGER;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_provider TEXT;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_id TEXT;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_title TEXT;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_url TEXT;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_action TEXT;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_current_time_ms INTEGER;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_duration_ms INTEGER;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS video_percent INTEGER;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS trial_mode TEXT;

ALTER TABLE telemetry_events
  ALTER COLUMN trial_mode SET DEFAULT 'digital';

UPDATE telemetry_events
SET trial_mode = 'digital'
WHERE trial_mode IS NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_participant_timestamp
  ON telemetry_events (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_session_timestamp
  ON telemetry_events (session_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_event_type_timestamp
  ON telemetry_events (event_type, received_at DESC);

CREATE TABLE IF NOT EXISTS short_form_results (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  telemetry_event_id BIGINT REFERENCES telemetry_events(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  task_id TEXT,
  task_label TEXT,
  question_id TEXT NOT NULL,
  duration_ms INTEGER,
  answer_text TEXT,
  part_a_answer_text TEXT,
  part_b_answer_text TEXT,
  part_c_answer_text TEXT,
  part_d_answer_text TEXT,
  trial_mode TEXT NOT NULL DEFAULT 'digital'
);

ALTER TABLE short_form_results
  ADD COLUMN IF NOT EXISTS part_a_answer_text TEXT;

ALTER TABLE short_form_results
  ADD COLUMN IF NOT EXISTS part_b_answer_text TEXT;

ALTER TABLE short_form_results
  ADD COLUMN IF NOT EXISTS part_c_answer_text TEXT;

ALTER TABLE short_form_results
  ADD COLUMN IF NOT EXISTS part_d_answer_text TEXT;

ALTER TABLE short_form_results
  ADD COLUMN IF NOT EXISTS trial_mode TEXT;

ALTER TABLE short_form_results
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

ALTER TABLE short_form_results
  ALTER COLUMN trial_mode SET DEFAULT 'digital';

UPDATE short_form_results
SET trial_mode = 'digital'
WHERE trial_mode IS NULL;

ALTER TABLE short_form_results
  ALTER COLUMN answer_text DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_short_form_results_participant_time
  ON short_form_results (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_short_form_results_question_time
  ON short_form_results (question_id, received_at DESC);

CREATE TABLE IF NOT EXISTS physical_trial_events (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_label TEXT,
  event_type TEXT NOT NULL,
  observer_id TEXT,
  manual_page TEXT,
  duration_ms INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'physical_manual',
  trial_mode TEXT NOT NULL DEFAULT 'physical'
);

ALTER TABLE physical_trial_events
  ADD COLUMN IF NOT EXISTS trial_mode TEXT;

ALTER TABLE physical_trial_events
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

ALTER TABLE physical_trial_events
  ALTER COLUMN trial_mode SET DEFAULT 'physical';

UPDATE physical_trial_events
SET trial_mode = 'physical'
WHERE trial_mode IS NULL;

CREATE INDEX IF NOT EXISTS idx_physical_trial_participant_time
  ON physical_trial_events (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_physical_trial_task_time
  ON physical_trial_events (participant_id, task_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_physical_trial_event_type_time
  ON physical_trial_events (event_type, received_at DESC);

CREATE TABLE IF NOT EXISTS observer_notes (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_label TEXT,
  manual_page TEXT,
  scenario_score INTEGER,
  task_length_ms INTEGER,
  error_severity TEXT,
  error_text TEXT,
  notes TEXT,
  action_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'observations_logger',
  trial_mode TEXT NOT NULL DEFAULT 'physical',
  CONSTRAINT observer_notes_scenario_score_range CHECK (scenario_score IS NULL OR (scenario_score >= 0 AND scenario_score <= 2))
);

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS trial_mode TEXT;

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS task_length_ms INTEGER;

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS error_severity TEXT;

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS error_text TEXT;

ALTER TABLE observer_notes
  ALTER COLUMN trial_mode SET DEFAULT 'physical';

UPDATE observer_notes
SET trial_mode = 'physical'
WHERE trial_mode IS NULL;

CREATE INDEX IF NOT EXISTS idx_observer_notes_participant_time
  ON observer_notes (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_observer_notes_task_time
  ON observer_notes (participant_id, task_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_observer_notes_action_type_time
  ON observer_notes (action_type, received_at DESC);

CREATE TABLE IF NOT EXISTS observer_step_marks (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_label TEXT,
  criterion_id TEXT NOT NULL,
  criterion_label TEXT NOT NULL,
  criterion_outcome TEXT NOT NULL,
  criterion_step_time_ms INTEGER,
  observer_note TEXT,
  source TEXT NOT NULL DEFAULT 'observations_logger',
  trial_mode TEXT NOT NULL DEFAULT 'physical',
  raw_payload JSONB,
  CONSTRAINT observer_step_marks_outcome_check CHECK (criterion_outcome IN ('correct', 'incorrect'))
);

ALTER TABLE observer_step_marks
  ADD COLUMN IF NOT EXISTS criterion_step_time_ms INTEGER;

ALTER TABLE observer_step_marks
  ADD COLUMN IF NOT EXISTS observer_note TEXT;

ALTER TABLE observer_step_marks
  ADD COLUMN IF NOT EXISTS trial_mode TEXT;

ALTER TABLE observer_step_marks
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

ALTER TABLE observer_step_marks
  ALTER COLUMN trial_mode SET DEFAULT 'physical';

UPDATE observer_step_marks
SET trial_mode = 'physical'
WHERE trial_mode IS NULL;

CREATE INDEX IF NOT EXISTS idx_observer_step_marks_participant_time
  ON observer_step_marks (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_observer_step_marks_task_time
  ON observer_step_marks (participant_id, task_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_observer_step_marks_outcome_time
  ON observer_step_marks (criterion_outcome, received_at DESC);

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
);

ALTER TABLE participant_allocation
  ADD COLUMN IF NOT EXISTS completed BOOLEAN;

ALTER TABLE participant_allocation
  ADD COLUMN IF NOT EXISTS session_status TEXT;

ALTER TABLE participant_allocation
  ADD COLUMN IF NOT EXISTS session_opened_at TIMESTAMPTZ;

ALTER TABLE participant_allocation
  ADD COLUMN IF NOT EXISTS session_closed_at TIMESTAMPTZ;

ALTER TABLE participant_allocation
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE participant_allocation
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

ALTER TABLE participant_allocation
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE participant_allocation
  ALTER COLUMN completed SET DEFAULT FALSE;

ALTER TABLE participant_allocation
  ALTER COLUMN session_status SET DEFAULT 'not_started';

UPDATE participant_allocation
SET completed = FALSE
WHERE completed IS NULL;

UPDATE participant_allocation
SET session_status = 'not_started'
WHERE session_status IS NULL OR TRIM(session_status) = '';

UPDATE participant_allocation
SET created_at = NOW()
WHERE created_at IS NULL;

UPDATE participant_allocation
SET updated_at = NOW()
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_participant_allocation_group
  ON participant_allocation (allocation_group);

CREATE INDEX IF NOT EXISTS idx_participant_allocation_completed
  ON participant_allocation (completed, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_participant_allocation_session_status
  ON participant_allocation (session_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS pre_trial_questionnaire (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  observer_id TEXT,
  questionnaire_duration_ms INTEGER,
  q1_age_years INTEGER,
  q2_gender TEXT,
  q2_gender_other_text TEXT,
  q3_education TEXT,
  q4_occupation TEXT,
  q6_digital_literacy INTEGER,
  q7_digital_guidance INTEGER,
  q8_physical_guidance INTEGER,
  q9_problem_solving INTEGER,
  q10_format_preference TEXT,
  q10_format_mix_details TEXT,
  consent_to_participate BOOLEAN,
  q5_device_experience_none BOOLEAN,
  q5_device_experience_blood_pressure_monitor BOOLEAN,
  q5_device_experience_blood_glucose_monitor BOOLEAN,
  q5_device_experience_inhaler_nebuliser BOOLEAN,
  q5_device_experience_sleep_fitness_tracker BOOLEAN,
  q5_device_experience_other BOOLEAN,
  q5_device_experience_other_text TEXT,
  free_text_notes TEXT,
  raw_response JSONB
);

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS consent_to_participate BOOLEAN;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS questionnaire_duration_ms INTEGER;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q1_age_years INTEGER;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q2_gender TEXT;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q4_occupation TEXT;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q2_gender_other_text TEXT;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q3_education TEXT;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q6_digital_literacy INTEGER;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q7_digital_guidance INTEGER;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q8_physical_guidance INTEGER;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q9_problem_solving INTEGER;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q10_format_preference TEXT;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q10_format_mix_details TEXT;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_device_experience_none BOOLEAN;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_device_experience_blood_pressure_monitor BOOLEAN;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_device_experience_blood_glucose_monitor BOOLEAN;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_device_experience_inhaler_nebuliser BOOLEAN;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_device_experience_sleep_fitness_tracker BOOLEAN;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_device_experience_other BOOLEAN;

ALTER TABLE pre_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_device_experience_other_text TEXT;

CREATE INDEX IF NOT EXISTS idx_pre_trial_questionnaire_participant_time
  ON pre_trial_questionnaire (participant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS post_trial_questionnaire (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  observer_id TEXT,
  questionnaire_duration_ms INTEGER,
  q1_instructions_ease INTEGER,
  q2_info_ease INTEGER,
  q3_step_by_step_help INTEGER,
  q4_instructions_satisfaction INTEGER,
  q5_confidence_setup INTEGER,
  q6_confidence_troubleshooting INTEGER,
  q7_mental_effort INTEGER,
  q8_format_preference TEXT,
  q8_format_mix_details TEXT,
  free_text_notes TEXT,
  raw_response JSONB
);

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q1_instructions_ease INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS questionnaire_duration_ms INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q2_info_ease INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q3_step_by_step_help INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q4_instructions_satisfaction INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q5_confidence_setup INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q6_confidence_troubleshooting INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q7_mental_effort INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q8_format_preference TEXT;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q8_format_mix_details TEXT;

CREATE INDEX IF NOT EXISTS idx_post_trial_questionnaire_participant_time
  ON post_trial_questionnaire (participant_id, received_at DESC);

CREATE OR REPLACE VIEW telemetry_task_events_enriched AS
WITH ordered AS (
  SELECT
    id,
    received_at,
    COALESCE("timestamp", received_at) AS event_at,
    session_id,
    participant_id,
    NULLIF(task_id, '') AS task_id,
    task_label,
    event_type,
    task_action_index,
    duration_ms,
    page_path,
    SUM(CASE WHEN event_type = 'task_start' THEN 1 ELSE 0 END)
      OVER (
        PARTITION BY participant_id, NULLIF(task_id, '')
        ORDER BY COALESCE("timestamp", received_at), id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS task_instance_seq
  FROM telemetry_events
  WHERE NULLIF(task_id, '') IS NOT NULL
),
scoped AS (
  SELECT *
  FROM ordered
  WHERE task_instance_seq > 0
),
instance_start AS (
  SELECT
    participant_id,
    task_id,
    task_instance_seq,
    MIN(event_at) FILTER (WHERE event_type = 'task_start') AS task_started_at
  FROM scoped
  GROUP BY participant_id, task_id, task_instance_seq
)
SELECT
  s.id,
  s.received_at,
  s.event_at,
  s.session_id,
  s.participant_id,
  s.task_id,
  s.task_label,
  s.event_type,
  s.task_action_index,
  s.duration_ms,
  s.page_path,
  s.task_instance_seq,
  i.task_started_at,
  CASE
    WHEN i.task_started_at IS NOT NULL
      THEN GREATEST(0, (EXTRACT(EPOCH FROM (s.event_at - i.task_started_at)) * 1000)::BIGINT)
    ELSE NULL
  END AS task_elapsed_ms_at_event
FROM scoped s
LEFT JOIN instance_start i
  ON i.participant_id = s.participant_id
  AND i.task_id = s.task_id
  AND i.task_instance_seq = s.task_instance_seq;

CREATE OR REPLACE VIEW telemetry_task_page_dwell_segments AS
WITH task_bounds AS (
  SELECT
    MIN(session_id) AS session_id,
    participant_id,
    task_id,
    task_instance_seq,
    MIN(event_at) FILTER (WHERE event_type = 'task_start') AS task_started_at,
    MAX(event_at) FILTER (WHERE event_type = 'task_end') AS task_ended_at
  FROM telemetry_task_events_enriched
  GROUP BY participant_id, task_id, task_instance_seq
),
task_start_events AS (
  SELECT
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
    e.page_path,
    e.event_at,
    ROW_NUMBER() OVER (
      PARTITION BY e.participant_id, e.task_id, e.task_instance_seq
      ORDER BY e.event_at ASC, e.id ASC
    ) AS rn
  FROM telemetry_task_events_enriched e
  WHERE e.event_type = 'task_start'
),
page_exit_segments AS (
  SELECT
    b.session_id,
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
    e.page_path,
    GREATEST(e.event_at - (e.duration_ms * INTERVAL '1 millisecond'), b.task_started_at) AS page_opened_at,
    LEAST(e.event_at, COALESCE(b.task_ended_at, e.event_at)) AS page_closed_at,
    'page_exit'::TEXT AS close_reason
  FROM telemetry_task_events_enriched e
  INNER JOIN task_bounds b
    ON b.participant_id = e.participant_id
    AND b.task_id = e.task_id
    AND b.task_instance_seq = e.task_instance_seq
  WHERE e.event_type = 'page_exit'
    AND e.page_path IS NOT NULL
    AND e.page_path <> ''
    AND b.task_started_at IS NOT NULL
    AND e.duration_ms IS NOT NULL
    AND e.duration_ms > 0
),
last_page_view_at_task_end AS (
  SELECT
    b.session_id,
    b.participant_id,
    b.task_id,
    b.task_instance_seq,
    b.task_ended_at,
    e.page_path,
    e.event_at AS page_opened_at,
    ROW_NUMBER() OVER (
      PARTITION BY b.participant_id, b.task_id, b.task_instance_seq
      ORDER BY e.event_at DESC, e.id DESC
    ) AS rn
  FROM task_bounds b
  INNER JOIN telemetry_task_events_enriched e
    ON e.participant_id = b.participant_id
    AND e.task_id = b.task_id
    AND e.task_instance_seq = b.task_instance_seq
  WHERE b.task_ended_at IS NOT NULL
    AND e.event_type = 'page_view'
    AND e.page_path IS NOT NULL
    AND e.page_path <> ''
    AND e.event_at <= b.task_ended_at
),
trailing_open_page_segments AS (
  SELECT
    l.session_id,
    l.participant_id,
    l.task_id,
    l.task_instance_seq,
    l.page_path,
    l.page_opened_at,
    l.task_ended_at AS page_closed_at,
    'task_end'::TEXT AS close_reason
  FROM last_page_view_at_task_end l
  WHERE l.rn = 1
    AND NOT EXISTS (
      SELECT 1
      FROM telemetry_task_events_enriched e
      WHERE e.participant_id = l.participant_id
        AND e.task_id = l.task_id
        AND e.task_instance_seq = l.task_instance_seq
        AND e.event_type = 'page_exit'
        AND e.page_path = l.page_path
        AND e.event_at >= l.page_opened_at
        AND e.event_at <= l.task_ended_at
    )
),
base_segments AS (
  SELECT * FROM page_exit_segments
  UNION ALL
  SELECT * FROM trailing_open_page_segments
),
task_start_fallback_segments AS (
  SELECT
    b.session_id,
    b.participant_id,
    b.task_id,
    b.task_instance_seq,
    tse.page_path,
    b.task_started_at AS page_opened_at,
    b.task_ended_at AS page_closed_at,
    'task_end'::TEXT AS close_reason
  FROM task_bounds b
  LEFT JOIN task_start_events tse
    ON tse.participant_id = b.participant_id
    AND tse.task_id = b.task_id
    AND tse.task_instance_seq = b.task_instance_seq
    AND tse.rn = 1
  WHERE b.task_started_at IS NOT NULL
    AND b.task_ended_at IS NOT NULL
    AND b.task_ended_at >= b.task_started_at
    AND NOT EXISTS (
      SELECT 1
      FROM base_segments s
      WHERE s.participant_id = b.participant_id
        AND s.task_id = b.task_id
        AND s.task_instance_seq = b.task_instance_seq
    )
),
all_segments AS (
  SELECT * FROM base_segments
  UNION ALL
  SELECT * FROM task_start_fallback_segments
)
SELECT
  session_id,
  participant_id,
  task_id,
  task_instance_seq,
  page_path,
  page_opened_at,
  page_closed_at,
  close_reason,
  GREATEST(0, (EXTRACT(EPOCH FROM (page_closed_at - page_opened_at)) * 1000)::BIGINT) AS page_time_spent_ms
FROM all_segments
WHERE page_closed_at IS NOT NULL
  AND page_opened_at IS NOT NULL;

CREATE OR REPLACE VIEW telemetry_task_instances AS
WITH task_bounds AS (
  SELECT
    MIN(session_id) AS session_id,
    participant_id,
    task_id,
    task_instance_seq,
    MIN(task_label) FILTER (WHERE task_label IS NOT NULL AND task_label <> '') AS task_label,
    MIN(event_at) FILTER (WHERE event_type = 'task_start') AS task_started_at,
    MAX(event_at) FILTER (WHERE event_type = 'task_end') AS task_ended_at,
    MAX(duration_ms) FILTER (WHERE event_type = 'task_end' AND duration_ms IS NOT NULL) AS task_end_duration_ms,
    COUNT(*) AS task_event_count
  FROM telemetry_task_events_enriched
  GROUP BY participant_id, task_id, task_instance_seq
),
task_page_counts AS (
  SELECT
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
    COUNT(DISTINCT e.page_path)::BIGINT AS task_page_count
  FROM telemetry_task_events_enriched e
  INNER JOIN task_bounds b
    ON b.participant_id = e.participant_id
    AND b.task_id = e.task_id
    AND b.task_instance_seq = e.task_instance_seq
  WHERE e.event_type IN ('page_view', 'task_start')
    AND e.page_path IS NOT NULL
    AND e.page_path <> ''
    AND (b.task_ended_at IS NULL OR e.event_at <= b.task_ended_at)
  GROUP BY e.participant_id, e.task_id, e.task_instance_seq
),
task_page_totals AS (
  SELECT
    participant_id,
    task_id,
    task_instance_seq,
    SUM(page_time_spent_ms)::BIGINT AS task_total_page_dwell_ms
  FROM telemetry_task_page_dwell_segments
  GROUP BY participant_id, task_id, task_instance_seq
)
SELECT
  b.session_id,
  b.participant_id,
  b.task_id,
  b.task_instance_seq,
  b.task_label,
  b.task_started_at,
  b.task_ended_at,
  COALESCE(
    b.task_end_duration_ms,
    CASE
      WHEN b.task_started_at IS NOT NULL AND b.task_ended_at IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (b.task_ended_at - b.task_started_at)) * 1000)::BIGINT
      ELSE NULL
    END
  ) AS task_total_duration_ms,
  COALESCE(t.task_total_page_dwell_ms, 0) AS task_total_page_dwell_ms,
  b.task_event_count,
  COALESCE(p.task_page_count, 0) AS task_page_count
FROM task_bounds b
LEFT JOIN task_page_totals t
  ON t.participant_id = b.participant_id
  AND t.task_id = b.task_id
  AND t.task_instance_seq = b.task_instance_seq
LEFT JOIN task_page_counts p
  ON p.participant_id = b.participant_id
  AND p.task_id = b.task_id
  AND p.task_instance_seq = b.task_instance_seq;

CREATE OR REPLACE VIEW telemetry_task_page_metrics AS
WITH page_dwell AS (
  SELECT
    MIN(session_id) AS session_id,
    participant_id,
    task_id,
    task_instance_seq,
    page_path,
    SUM(page_time_spent_ms)::BIGINT AS page_dwell_ms,
    COUNT(*) FILTER (WHERE close_reason = 'page_exit') AS page_exit_count
  FROM telemetry_task_page_dwell_segments
  GROUP BY participant_id, task_id, task_instance_seq, page_path
),
page_views AS (
  SELECT
    MIN(session_id) AS session_id,
    participant_id,
    task_id,
    task_instance_seq,
    page_path,
    COUNT(*) AS page_view_count
  FROM telemetry_task_events_enriched
  WHERE event_type = 'page_view'
    AND page_path IS NOT NULL
    AND page_path <> ''
  GROUP BY participant_id, task_id, task_instance_seq, page_path
)
SELECT
  COALESCE(d.session_id, v.session_id) AS session_id,
  COALESCE(d.participant_id, v.participant_id) AS participant_id,
  COALESCE(d.task_id, v.task_id) AS task_id,
  COALESCE(d.task_instance_seq, v.task_instance_seq) AS task_instance_seq,
  COALESCE(d.page_path, v.page_path) AS page_path,
  COALESCE(d.page_dwell_ms, 0) AS page_dwell_ms,
  COALESCE(v.page_view_count, 0) AS page_view_count,
  COALESCE(d.page_exit_count, 0) AS page_exit_count
FROM page_dwell d
FULL OUTER JOIN page_views v
  ON v.participant_id = d.participant_id
  AND v.task_id = d.task_id
  AND v.task_instance_seq = d.task_instance_seq
  AND v.page_path = d.page_path;

CREATE OR REPLACE VIEW telemetry_task_page_spans AS
SELECT
  session_id,
  participant_id,
  task_id,
  task_instance_seq,
  page_path,
  page_opened_at,
  page_closed_at,
  close_reason,
  page_time_spent_ms
FROM telemetry_task_page_dwell_segments;

CREATE OR REPLACE VIEW telemetry_task_page_time_per_task AS
SELECT
  MIN(session_id) AS session_id,
  participant_id,
  task_id,
  task_instance_seq,
  page_path,
  SUM(page_time_spent_ms)::BIGINT AS page_time_spent_ms,
  COUNT(*) AS page_visit_count,
  MAX(page_closed_at) AS last_page_closed_at
FROM telemetry_task_page_spans
GROUP BY participant_id, task_id, task_instance_seq, page_path;
