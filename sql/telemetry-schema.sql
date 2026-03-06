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
  trial_mode TEXT NOT NULL DEFAULT 'digital'
);

ALTER TABLE short_form_results
  ADD COLUMN IF NOT EXISTS part_a_answer_text TEXT;

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

ALTER TABLE short_form_results
  DROP COLUMN IF EXISTS part_b_answer_text;

ALTER TABLE short_form_results
  DROP COLUMN IF EXISTS part_c_answer_text;

ALTER TABLE short_form_results
  DROP COLUMN IF EXISTS part_d_answer_text;

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
  help_instances_count INTEGER NOT NULL DEFAULT 0,
  error_severity TEXT,
  error_text TEXT,
  notes TEXT,
  action_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'observations_logger',
  trial_mode TEXT,
  CONSTRAINT observer_notes_scenario_score_range CHECK (scenario_score IS NULL OR (scenario_score >= 0 AND scenario_score <= 2)),
  CONSTRAINT observer_notes_help_instances_nonnegative CHECK (help_instances_count >= 0)
);

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS trial_mode TEXT;

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS task_length_ms INTEGER;

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS help_instances_count INTEGER;

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS error_severity TEXT;

ALTER TABLE observer_notes
  ADD COLUMN IF NOT EXISTS error_text TEXT;

ALTER TABLE observer_notes
  ALTER COLUMN help_instances_count SET DEFAULT 0;

UPDATE observer_notes
SET help_instances_count = 0
WHERE help_instances_count IS NULL;

ALTER TABLE observer_notes
  ALTER COLUMN help_instances_count SET NOT NULL;

ALTER TABLE observer_notes
  DROP CONSTRAINT IF EXISTS observer_notes_help_instances_nonnegative;

ALTER TABLE observer_notes
  ADD CONSTRAINT observer_notes_help_instances_nonnegative
  CHECK (help_instances_count >= 0);

ALTER TABLE observer_notes
  DROP COLUMN IF EXISTS error_count;

ALTER TABLE observer_notes
  ALTER COLUMN trial_mode DROP DEFAULT;

ALTER TABLE observer_notes
  ALTER COLUMN trial_mode DROP NOT NULL;

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
  trial_mode TEXT,
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
  ALTER COLUMN trial_mode DROP DEFAULT;

ALTER TABLE observer_step_marks
  ALTER COLUMN trial_mode DROP NOT NULL;

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
  q8_tlx_frustration INTEGER,
  q9_tlx_perceived_performance INTEGER,
  q10_tlx_temporal_demand INTEGER,
  q11_format_preference TEXT,
  q11_format_mix_details TEXT,
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
  ADD COLUMN IF NOT EXISTS q8_tlx_frustration INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q9_tlx_perceived_performance INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q10_tlx_temporal_demand INTEGER;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q11_format_preference TEXT;

ALTER TABLE post_trial_questionnaire
  ADD COLUMN IF NOT EXISTS q11_format_mix_details TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'post_trial_questionnaire'
      AND column_name = 'q9_tlx_frustration'
  ) THEN
    ALTER TABLE post_trial_questionnaire RENAME COLUMN q9_tlx_frustration TO q8_tlx_frustration;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'post_trial_questionnaire'
      AND column_name = 'q10_tlx_perceived_performance'
  ) THEN
    ALTER TABLE post_trial_questionnaire RENAME COLUMN q10_tlx_perceived_performance TO q9_tlx_perceived_performance;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'post_trial_questionnaire'
      AND column_name = 'q8_format_preference'
  ) THEN
    ALTER TABLE post_trial_questionnaire RENAME COLUMN q8_format_preference TO q11_format_preference;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'post_trial_questionnaire'
      AND column_name = 'q8_format_mix_details'
  ) THEN
    ALTER TABLE post_trial_questionnaire RENAME COLUMN q8_format_mix_details TO q11_format_mix_details;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'post_trial_questionnaire'
      AND column_name = 'q10_format_preference'
  ) THEN
    ALTER TABLE post_trial_questionnaire RENAME COLUMN q10_format_preference TO q11_format_preference;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'post_trial_questionnaire'
      AND column_name = 'q10_format_mix_details'
  ) THEN
    ALTER TABLE post_trial_questionnaire RENAME COLUMN q10_format_mix_details TO q11_format_mix_details;
  END IF;
END
$$;

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

CREATE TABLE IF NOT EXISTS short_form_rubric_rules (
  id BIGSERIAL PRIMARY KEY,
  question_id TEXT NOT NULL,
  part_key TEXT NOT NULL DEFAULT 'a',
  rubric_version TEXT NOT NULL DEFAULT 'v1',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rule_order INTEGER NOT NULL DEFAULT 100,
  rule_label TEXT,
  match_type TEXT NOT NULL,
  match_value TEXT,
  numeric_min NUMERIC,
  numeric_max NUMERIC,
  score_value NUMERIC(6,3) NOT NULL DEFAULT 1.000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT short_form_rubric_rules_match_type_check CHECK (match_type IN ('exact', 'contains', 'regex', 'numeric_range', 'contains_any', 'contains_all')),
  CONSTRAINT short_form_rubric_rules_part_key_check CHECK (part_key = 'a'),
  CONSTRAINT short_form_rubric_rules_numeric_range_check CHECK (
    (match_type <> 'numeric_range')
    OR (numeric_min IS NOT NULL AND numeric_max IS NOT NULL AND numeric_max >= numeric_min)
  )
);

ALTER TABLE short_form_rubric_rules
  DROP CONSTRAINT IF EXISTS short_form_rubric_rules_match_type_check;

ALTER TABLE short_form_rubric_rules
  ADD CONSTRAINT short_form_rubric_rules_match_type_check
  CHECK (match_type IN ('exact', 'contains', 'regex', 'numeric_range', 'contains_any', 'contains_all'));

ALTER TABLE short_form_rubric_rules
  DROP CONSTRAINT IF EXISTS short_form_rubric_rules_part_key_check;

ALTER TABLE short_form_rubric_rules
  ADD CONSTRAINT short_form_rubric_rules_part_key_check
  CHECK (part_key = 'a');

UPDATE short_form_rubric_rules
SET part_key = 'a'
WHERE part_key IS DISTINCT FROM 'a';

CREATE INDEX IF NOT EXISTS idx_short_form_rubric_rules_question_part
  ON short_form_rubric_rules (question_id, part_key, is_active, rule_order, id);

CREATE INDEX IF NOT EXISTS idx_short_form_rubric_rules_active
  ON short_form_rubric_rules (is_active, question_id, rubric_version);

CREATE OR REPLACE FUNCTION normalize_short_form_text(input_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  WITH s0 AS (
    SELECT LOWER(TRIM(COALESCE(input_text, ''))) AS t
  ),
  s1 AS (
    SELECT REGEXP_REPLACE(t, '\b(get\s+in\s+touch|reach\s+out|talk\s+to|speak\s+to|ring|phone)\b', ' contact ', 'g') AS t
    FROM s0
  ),
  s2 AS (
    SELECT REGEXP_REPLACE(t, '\b(care\s*provider|provider|clinician|sleep\s*clinic|health\s*care\s*provider)\b', ' care provider ', 'g') AS t
    FROM s1
  ),
  s3 AS (
    SELECT REGEXP_REPLACE(t, '\b(weekley|wekly|wkly|weely|weeky|weeklyy|weekly)\b', ' weekly ', 'g') AS t
    FROM s2
  ),
  s4 AS (
    SELECT REGEXP_REPLACE(t, '\b(feet|foot)\b', ' ft ', 'g') AS t
    FROM s3
  ),
  s5 AS (
    SELECT REGEXP_REPLACE(t, '\b(celsius|celcius|centigrade)\b', ' c ', 'g') AS t
    FROM s4
  ),
  s6 AS (
    SELECT REGEXP_REPLACE(t, '\b(fahrenheit|farenheit|fahrenhiet)\b', ' f ', 'g') AS t
    FROM s5
  ),
  s7 AS (
    SELECT REGEXP_REPLACE(t, '°', '', 'g') AS t
    FROM s6
  ),
  s8 AS (
    SELECT REGEXP_REPLACE(t, '\bmetre\b', 'm', 'g') AS t
    FROM s7
  ),
  s9 AS (
    SELECT REGEXP_REPLACE(t, '\bmeters\b|\bmetres\b', 'm', 'g') AS t
    FROM s8
  ),
  s10 AS (
    SELECT REGEXP_REPLACE(t, '[^a-z0-9]+', ' ', 'g') AS t
    FROM s9
  )
  SELECT TRIM(REGEXP_REPLACE(t, '\s+', ' ', 'g'))
  FROM s10;
$$;

CREATE OR REPLACE FUNCTION normalize_short_form_rule_terms(match_value TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT normalize_short_form_text(term)
      FROM UNNEST(REGEXP_SPLIT_TO_ARRAY(COALESCE(match_value, ''), '\s*\|\|\s*')) AS term
      WHERE normalize_short_form_text(term) <> ''
    ),
    ARRAY[]::TEXT[]
  );
$$;

DROP VIEW IF EXISTS short_form_result_parts;

CREATE OR REPLACE VIEW short_form_part_scoring AS
WITH base_answers AS (
  SELECT
    s.id AS short_form_result_id,
    s.received_at,
    s.timestamp,
    s.session_id,
    s.participant_id,
    COALESCE(NULLIF(s.question_id, ''), NULLIF(s.task_id, '')) AS question_id,
    s.task_id,
    s.task_label,
    s.trial_mode,
    s.duration_ms,
    'a'::TEXT AS part_key,
    COALESCE(NULLIF(s.part_a_answer_text, ''), NULLIF(s.answer_text, '')) AS answer_text
  FROM short_form_results s
  WHERE COALESCE(NULLIF(s.question_id, ''), NULLIF(s.task_id, '')) IS NOT NULL
    AND COALESCE(NULLIF(s.question_id, ''), NULLIF(s.task_id, '')) <> ''
),
answers AS (
  SELECT
    b.short_form_result_id,
    b.received_at,
    b.timestamp,
    b.session_id,
    b.participant_id,
    b.question_id,
    b.task_id,
    b.task_label,
    b.trial_mode,
    b.duration_ms,
    b.part_key,
    b.answer_text,
    normalize_short_form_text(b.answer_text) AS answer_text_normalized,
    CASE
      WHEN b.answer_text IS NULL THEN NULL
      ELSE NULLIF(REGEXP_REPLACE((REGEXP_MATCH(LOWER(b.answer_text), '(-?\d+(?:\.\d+)?)'))[1], ',', '', 'g'), '')::NUMERIC
    END AS answer_first_number
  FROM base_answers b
  WHERE b.answer_text IS NOT NULL
    AND TRIM(b.answer_text) <> ''
),
candidate_matches AS (
  SELECT
    a.short_form_result_id,
    a.received_at,
    a.timestamp,
    a.session_id,
    a.participant_id,
    a.question_id,
    a.task_id,
    a.task_label,
    a.trial_mode,
    a.duration_ms,
    a.part_key,
    a.answer_text,
    a.answer_text_normalized,
    a.answer_first_number,
    r.id AS matched_rule_id,
    r.rubric_version,
    r.rule_label,
    r.match_type,
    r.score_value,
    ROW_NUMBER() OVER (
      PARTITION BY a.short_form_result_id, a.part_key
      ORDER BY r.rule_order ASC, r.id ASC
    ) AS match_rank
  FROM answers a
  LEFT JOIN short_form_rubric_rules r
    ON r.is_active = TRUE
    AND r.question_id = a.question_id
    AND r.part_key = a.part_key
    AND (
      (r.match_type = 'exact' AND a.answer_text_normalized = normalize_short_form_text(r.match_value))
      OR (r.match_type = 'contains' AND a.answer_text_normalized LIKE '%' || normalize_short_form_text(r.match_value) || '%')
      OR (
        r.match_type = 'contains_any'
        AND EXISTS (
          SELECT 1
          FROM UNNEST(normalize_short_form_rule_terms(r.match_value)) AS term
          WHERE a.answer_text_normalized LIKE '%' || term || '%'
        )
      )
      OR (
        r.match_type = 'contains_all'
        AND NOT EXISTS (
          SELECT 1
          FROM UNNEST(normalize_short_form_rule_terms(r.match_value)) AS term
          WHERE a.answer_text_normalized NOT LIKE '%' || term || '%'
        )
      )
      OR (r.match_type = 'regex' AND a.answer_text ~* r.match_value)
      OR (
        r.match_type = 'numeric_range'
        AND a.answer_first_number IS NOT NULL
        AND a.answer_first_number >= r.numeric_min
        AND a.answer_first_number <= r.numeric_max
      )
    )
)
SELECT
  c.short_form_result_id,
  c.received_at,
  c.timestamp,
  c.session_id,
  c.participant_id,
  c.question_id,
  c.task_id,
  c.task_label,
  c.trial_mode,
  c.duration_ms,
  c.part_key,
  c.answer_text,
  c.answer_text_normalized,
  c.answer_first_number,
  c.matched_rule_id,
  c.rubric_version,
  c.rule_label,
  c.match_type,
  COALESCE(c.score_value, 0)::NUMERIC(6,3) AS score_value,
  CASE WHEN c.matched_rule_id IS NOT NULL AND COALESCE(c.score_value, 0) > 0 THEN 1 ELSE 0 END AS score_binary,
  CASE WHEN c.matched_rule_id IS NULL THEN TRUE ELSE FALSE END AS needs_manual_review
FROM candidate_matches c
WHERE c.match_rank = 1;

CREATE OR REPLACE VIEW short_form_result_scores AS
WITH expected_parts AS (
  SELECT
    question_id,
    part_key
  FROM short_form_rubric_rules
  WHERE is_active = TRUE
  GROUP BY question_id, part_key
),
result_expected AS (
  SELECT
    s.id AS short_form_result_id,
    COALESCE(NULLIF(s.question_id, ''), NULLIF(s.task_id, '')) AS question_id,
    e.part_key
  FROM short_form_results s
  INNER JOIN expected_parts e
    ON e.question_id = COALESCE(NULLIF(s.question_id, ''), NULLIF(s.task_id, ''))
),
joined AS (
  SELECT
    re.short_form_result_id,
    re.question_id,
    re.part_key,
    ps.score_binary,
    ps.score_value,
    ps.needs_manual_review
  FROM result_expected re
  LEFT JOIN short_form_part_scoring ps
    ON ps.short_form_result_id = re.short_form_result_id
    AND ps.part_key = re.part_key
),
metadata AS (
  SELECT
    s.id AS short_form_result_id,
    s.received_at,
    s.timestamp,
    s.session_id,
    s.participant_id,
    COALESCE(NULLIF(s.question_id, ''), NULLIF(s.task_id, '')) AS question_id,
    s.task_id,
    s.task_label,
    s.trial_mode,
    s.duration_ms,
    COALESCE(NULLIF(s.part_a_answer_text, ''), NULLIF(s.answer_text, '')) AS entered_answer_text
  FROM short_form_results s
)
SELECT
  m.short_form_result_id,
  m.received_at,
  m.timestamp,
  m.session_id,
  m.participant_id,
  m.question_id,
  m.task_id,
  m.task_label,
  m.trial_mode,
  m.duration_ms,
  COUNT(*)::INTEGER AS expected_parts_count,
  COUNT(*) FILTER (WHERE COALESCE(j.score_binary, 0) = 1)::INTEGER AS correct_parts_count,
  SUM(COALESCE(j.score_value, 0))::NUMERIC(8,3) AS total_score_value,
  CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE ROUND((COUNT(*) FILTER (WHERE COALESCE(j.score_binary, 0) = 1)::NUMERIC / COUNT(*)::NUMERIC), 4)
  END AS proportion_correct,
  CASE
    WHEN COUNT(*) = 0 THEN NULL
    WHEN COUNT(*) FILTER (WHERE COALESCE(j.score_binary, 0) = 1) = COUNT(*) THEN 1
    ELSE 0
  END AS all_parts_correct_binary,
  BOOL_OR(COALESCE(j.needs_manual_review, TRUE)) AS has_any_manual_review_flag,
  m.entered_answer_text
FROM metadata m
LEFT JOIN joined j
  ON j.short_form_result_id = m.short_form_result_id
GROUP BY
  m.short_form_result_id,
  m.received_at,
  m.timestamp,
  m.session_id,
  m.participant_id,
  m.question_id,
  m.task_id,
  m.task_label,
  m.trial_mode,
  m.duration_ms,
  m.entered_answer_text;

DROP VIEW IF EXISTS short_form_result_scores_final;
DROP VIEW IF EXISTS short_form_part_scores_final;
DROP TABLE IF EXISTS short_form_score_overrides;

INSERT INTO short_form_rubric_rules (
  question_id,
  part_key,
  rubric_version,
  is_active,
  rule_order,
  rule_label,
  match_type,
  match_value,
  numeric_min,
  numeric_max,
  score_value
)
VALUES
  ('short_form_q1', 'a', 'v1', TRUE, 1, 'Reject not weekly phrasing', 'regex', '(not\s+weekly|never\s+weekly)', NULL, NULL, 0.000),
  ('short_form_q1', 'a', 'v1', TRUE, 10, 'Weekly cleaning (weekly)', 'contains', 'weekly', NULL, NULL, 1.000),
  ('short_form_q1', 'a', 'v1', TRUE, 20, 'Weekly cleaning (once a week)', 'contains', 'once a week', NULL, NULL, 1.000),
  ('short_form_q1', 'a', 'v1', TRUE, 30, 'Weekly cleaning (every week)', 'contains', 'every week', NULL, NULL, 1.000),
  ('short_form_q1', 'a', 'v1', TRUE, 40, 'Weekly cleaning (7 days)', 'regex', '(^|[^0-9])7\s*(day|days)($|[^a-z])', NULL, NULL, 1.000),
  ('short_form_q1', 'a', 'v1', TRUE, 45, 'Weekly cleaning (every 7 days)', 'contains', 'every 7 days', NULL, NULL, 1.000),
  ('short_form_q1', 'a', 'v1', TRUE, 50, 'Weekly cleaning (once weekly)', 'contains', 'once weekly', NULL, NULL, 1.000),
  ('short_form_q1', 'a', 'v1', TRUE, 55, 'Weekly cleaning (per week)', 'contains', 'per week', NULL, NULL, 1.000),
  ('short_form_q1', 'a', 'v1', TRUE, 60, 'Weekly cleaning (typo-tolerant)', 'regex', '\bw[e]{0,2}kly\b', NULL, NULL, 1.000),

  ('short_form_q2', 'a', 'v1', TRUE, 1, 'Reject do not contact provider', 'regex', '(do\s*not\s*contact|dont\s*contact).*(care\s*provider|provider)', NULL, NULL, 0.000),
  ('short_form_q2', 'a', 'v1', TRUE, 10, 'Contact care provider', 'contains', 'contact your care provider', NULL, NULL, 1.000),
  ('short_form_q2', 'a', 'v1', TRUE, 20, 'Contact provider', 'contains', 'contact provider', NULL, NULL, 1.000),
  ('short_form_q2', 'a', 'v1', TRUE, 30, 'Call care provider', 'contains', 'call care provider', NULL, NULL, 1.000),
  ('short_form_q2', 'a', 'v1', TRUE, 40, 'Do not open and contact provider', 'regex', '(do\s*not\s*open).*(contact|call).*(provider)', NULL, NULL, 1.000),
  ('short_form_q2', 'a', 'v1', TRUE, 50, 'Get in touch with care provider', 'contains', 'get in touch with care provider', NULL, NULL, 1.000),
  ('short_form_q2', 'a', 'v1', TRUE, 60, 'Action + provider intent', 'contains_all', 'contact||care provider', NULL, NULL, 1.000),
  ('short_form_q2', 'a', 'v1', TRUE, 70, 'Seek medical advice', 'contains_any', 'seek medical advice||contact clinic||speak to clinic||call clinic', NULL, NULL, 1.000),

  ('short_form_q3', 'a', 'v1', TRUE, 1, 'Reject not storage range', 'regex', '(not\s*-?20\s*(to|-)\s*50|outside\s*-?20\s*(to|-)\s*50)', NULL, NULL, 0.000),
  ('short_form_q3', 'a', 'v1', TRUE, 10, 'Storage -20 to 50 C', 'regex', '(-?20\s*(to|-)\s*50\s*°?\s*c)', NULL, NULL, 1.000),
  ('short_form_q3', 'a', 'v1', TRUE, 20, 'Storage -4 to 122 F', 'regex', '(-?4\s*(to|-)\s*122\s*°?\s*f)', NULL, NULL, 1.000),
  ('short_form_q3', 'a', 'v1', TRUE, 30, 'Mentions both storage bounds with C', 'regex', '(-?20).*50.*(c|celsius)', NULL, NULL, 1.000),
  ('short_form_q3', 'a', 'v1', TRUE, 40, 'Storage range no unit', 'regex', '(-?20\s*(to|-|–)\s*50)(\b|\s)', NULL, NULL, 1.000),
  ('short_form_q3', 'a', 'v1', TRUE, 50, 'Storage between phrasing', 'regex', 'between\s*-?20\s*and\s*50', NULL, NULL, 1.000),
  ('short_form_q3', 'a', 'v1', TRUE, 60, 'Storage minus phrasing', 'regex', 'minus\s*20\s*(to|-|–)\s*50', NULL, NULL, 1.000),

  ('short_form_q4', 'a', 'v1', TRUE, 1, 'Reject yes-only', 'exact', 'yes', NULL, NULL, 0.000),
  ('short_form_q4', 'a', 'v1', TRUE, 2, 'Reject sufficient at 7ft', 'regex', '(7\s*(ft|feet)).*(sufficient|enough|long enough)', NULL, NULL, 0.000),
  ('short_form_q4', 'a', 'v1', TRUE, 10, '7ft not sufficient', 'regex', '(7\s*(ft|feet|foot)).*(not|no|insufficient|too short)', NULL, NULL, 1.000),
  ('short_form_q4', 'a', 'v1', TRUE, 20, 'ClimateLineAir length 6''6"', 'regex', '(6\s*''\s*6\"|6\.?5\s*(ft|feet)|2\s*m)', NULL, NULL, 1.000),
  ('short_form_q4', 'a', 'v1', TRUE, 30, 'No, 7ft exceeds tubing length', 'regex', '(no|not sufficient|insufficient).*(7\s*(ft|feet)).*(6\s*''\s*6\"|2\s*m)', NULL, NULL, 1.000),
  ('short_form_q4', 'a', 'v1', TRUE, 40, 'No-only accepted (binary question)', 'exact', 'no', NULL, NULL, 1.000),
  ('short_form_q4', 'a', 'v1', TRUE, 50, 'Comparison phrasing 7ft vs 2m', 'contains_all', '7 ft||2 m', NULL, NULL, 1.000)
ON CONFLICT DO NOTHING;
