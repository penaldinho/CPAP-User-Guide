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
  referrer TEXT
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
  answer_text TEXT NOT NULL
);

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
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'physical_manual'
);

CREATE INDEX IF NOT EXISTS idx_physical_trial_participant_time
  ON physical_trial_events (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_physical_trial_task_time
  ON physical_trial_events (participant_id, task_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_physical_trial_event_type_time
  ON physical_trial_events (event_type, received_at DESC);

CREATE TABLE IF NOT EXISTS pre_trial_questionnaire (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  observer_id TEXT,
  age_years INTEGER,
  gender TEXT,
  education TEXT,
  tech_comfort INTEGER,
  baseline_q6 INTEGER,
  baseline_q7 INTEGER,
  baseline_q8 INTEGER,
  device_experience_none BOOLEAN,
  device_experience_blood_pressure_monitor BOOLEAN,
  device_experience_blood_glucose_monitor BOOLEAN,
  device_experience_inhaler_nebuliser BOOLEAN,
  device_experience_sleep_fitness_tracker BOOLEAN,
  device_experience_other BOOLEAN,
  device_experience_other_text TEXT,
  free_text_notes TEXT,
  raw_response JSONB
);

CREATE INDEX IF NOT EXISTS idx_pre_trial_questionnaire_participant_time
  ON pre_trial_questionnaire (participant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS post_trial_questionnaire (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp TIMESTAMPTZ,
  session_id TEXT,
  participant_id TEXT NOT NULL,
  observer_id TEXT,
  post_q1 INTEGER,
  post_q2 INTEGER,
  post_q3 INTEGER,
  post_q4 INTEGER,
  post_q5 INTEGER,
  post_q6 INTEGER,
  post_q7 INTEGER,
  format_preference TEXT,
  free_text_notes TEXT,
  raw_response JSONB
);

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
page_views AS (
  SELECT
    b.session_id,
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
    e.id AS page_view_id,
    e.page_path,
    e.event_at AS page_opened_at,
    b.task_ended_at
  FROM telemetry_task_events_enriched e
  INNER JOIN task_bounds b
    ON b.participant_id = e.participant_id
    AND b.task_id = e.task_id
    AND b.task_instance_seq = e.task_instance_seq
  WHERE e.event_type = 'page_view'
    AND e.page_path IS NOT NULL
    AND e.page_path <> ''
    AND (b.task_ended_at IS NULL OR e.event_at <= b.task_ended_at)
),
page_exit_candidates AS (
  SELECT
    pv.page_view_id,
    pe.id AS page_exit_id,
    pe.event_at AS page_exit_at,
    ROW_NUMBER() OVER (
      PARTITION BY pv.page_view_id
      ORDER BY pe.event_at ASC, pe.id ASC
    ) AS rn
  FROM page_views pv
  INNER JOIN telemetry_task_events_enriched pe
    ON pe.participant_id = pv.participant_id
    AND pe.task_id = pv.task_id
    AND pe.task_instance_seq = pv.task_instance_seq
    AND pe.event_type = 'page_exit'
    AND pe.page_path = pv.page_path
    AND pe.event_at >= pv.page_opened_at
    AND (pv.task_ended_at IS NULL OR pe.event_at <= pv.task_ended_at)
),
first_page_exits AS (
  SELECT
    page_view_id,
    page_exit_id,
    page_exit_at
  FROM page_exit_candidates
  WHERE rn = 1
),
page_spans AS (
  SELECT
    pv.participant_id,
    pv.task_id,
    pv.task_instance_seq,
    CASE
      WHEN COALESCE(fpe.page_exit_at, pv.task_ended_at) IS NULL THEN NULL
      ELSE GREATEST(
        0,
        (EXTRACT(EPOCH FROM (COALESCE(fpe.page_exit_at, pv.task_ended_at) - pv.page_opened_at)) * 1000)::BIGINT
      )
    END AS page_time_spent_ms
  FROM page_views pv
  LEFT JOIN first_page_exits fpe
    ON fpe.page_view_id = pv.page_view_id
),
task_page_totals AS (
  SELECT
    participant_id,
    task_id,
    task_instance_seq,
    SUM(page_time_spent_ms)::BIGINT AS task_total_page_dwell_ms
  FROM page_spans
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
  b.task_event_count
FROM task_bounds b
LEFT JOIN task_page_totals t
  ON t.participant_id = b.participant_id
  AND t.task_id = b.task_id
  AND t.task_instance_seq = b.task_instance_seq;

CREATE OR REPLACE VIEW telemetry_task_page_metrics AS
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
page_exit_overlap AS (
  SELECT
    b.session_id,
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
    e.page_path,
    CASE
      WHEN b.task_started_at IS NULL OR e.duration_ms IS NULL OR e.duration_ms <= 0 THEN 0
      ELSE GREATEST(
        0,
        (EXTRACT(EPOCH FROM (
          LEAST(e.event_at, COALESCE(b.task_ended_at, e.event_at))
          -
          GREATEST(e.event_at - (e.duration_ms * INTERVAL '1 millisecond'), b.task_started_at)
        )) * 1000)::BIGINT
      )
    END AS dwell_ms_within_task
  FROM telemetry_task_events_enriched e
  INNER JOIN task_bounds b
    ON b.participant_id = e.participant_id
    AND b.task_id = e.task_id
    AND b.task_instance_seq = e.task_instance_seq
  WHERE e.event_type = 'page_exit'
    AND e.page_path IS NOT NULL
    AND e.page_path <> ''
),
page_dwell AS (
  SELECT
    MIN(session_id) AS session_id,
    participant_id,
    task_id,
    task_instance_seq,
    page_path,
    SUM(dwell_ms_within_task)::BIGINT AS page_dwell_ms,
    COUNT(*) AS page_exit_count
  FROM page_exit_overlap
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
WITH task_bounds AS (
  SELECT
    participant_id,
    task_id,
    task_instance_seq,
    task_started_at,
    task_ended_at
  FROM telemetry_task_instances
  WHERE task_started_at IS NOT NULL
),
page_views AS (
  SELECT
    e.id AS page_view_id,
    e.session_id,
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
    e.page_path,
    e.event_at AS page_opened_at,
    b.task_ended_at
  FROM telemetry_task_events_enriched e
  INNER JOIN task_bounds b
    ON b.participant_id = e.participant_id
    AND b.task_id = e.task_id
    AND b.task_instance_seq = e.task_instance_seq
  WHERE e.event_type = 'page_view'
    AND e.page_path IS NOT NULL
    AND e.page_path <> ''
    AND (b.task_ended_at IS NULL OR e.event_at <= b.task_ended_at)
),
page_exit_candidates AS (
  SELECT
    pv.page_view_id,
    pe.id AS page_exit_id,
    pe.event_at AS page_exit_at,
    ROW_NUMBER() OVER (
      PARTITION BY pv.page_view_id
      ORDER BY pe.event_at ASC, pe.id ASC
    ) AS rn
  FROM page_views pv
  INNER JOIN telemetry_task_events_enriched pe
    ON pe.participant_id = pv.participant_id
    AND pe.task_id = pv.task_id
    AND pe.task_instance_seq = pv.task_instance_seq
    AND pe.event_type = 'page_exit'
    AND pe.page_path = pv.page_path
    AND pe.event_at >= pv.page_opened_at
    AND (pv.task_ended_at IS NULL OR pe.event_at <= pv.task_ended_at)
),
first_page_exits AS (
  SELECT
    page_view_id,
    page_exit_id,
    page_exit_at
  FROM page_exit_candidates
  WHERE rn = 1
),
page_spans AS (
  SELECT
    pv.session_id,
    pv.participant_id,
    pv.task_id,
    pv.task_instance_seq,
    pv.page_path,
    pv.page_opened_at,
    COALESCE(fpe.page_exit_at, pv.task_ended_at) AS page_closed_at,
    CASE
      WHEN fpe.page_exit_id IS NOT NULL THEN 'page_exit'
      WHEN pv.task_ended_at IS NOT NULL THEN 'task_end'
      ELSE NULL
    END AS close_reason
  FROM page_views pv
  LEFT JOIN first_page_exits fpe
    ON fpe.page_view_id = pv.page_view_id
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
  CASE
    WHEN page_closed_at IS NULL THEN NULL
    ELSE GREATEST(0, (EXTRACT(EPOCH FROM (page_closed_at - page_opened_at)) * 1000)::BIGINT)
  END AS page_time_spent_ms
FROM page_spans;

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
