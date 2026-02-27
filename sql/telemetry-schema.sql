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
  task_action_index INTEGER,
  duration_ms INTEGER,
  referrer TEXT
);

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS response_message TEXT;

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS task_action_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_telemetry_participant_timestamp
  ON telemetry_events (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_session_timestamp
  ON telemetry_events (session_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_event_type_timestamp
  ON telemetry_events (event_type, received_at DESC);

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
        PARTITION BY session_id, participant_id, NULLIF(task_id, '')
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
    session_id,
    participant_id,
    task_id,
    task_instance_seq,
    MIN(event_at) FILTER (WHERE event_type = 'task_start') AS task_started_at
  FROM scoped
  GROUP BY session_id, participant_id, task_id, task_instance_seq
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
  ON i.session_id = s.session_id
  AND i.participant_id = s.participant_id
  AND i.task_id = s.task_id
  AND i.task_instance_seq = s.task_instance_seq;

CREATE OR REPLACE VIEW telemetry_task_instances AS
WITH task_bounds AS (
  SELECT
    session_id,
    participant_id,
    task_id,
    task_instance_seq,
    MIN(task_label) FILTER (WHERE task_label IS NOT NULL AND task_label <> '') AS task_label,
    MIN(event_at) FILTER (WHERE event_type = 'task_start') AS task_started_at,
    MAX(event_at) FILTER (WHERE event_type = 'task_end') AS task_ended_at,
    MAX(duration_ms) FILTER (WHERE event_type = 'task_end' AND duration_ms IS NOT NULL) AS task_end_duration_ms,
    COUNT(*) AS task_event_count
  FROM telemetry_task_events_enriched
  GROUP BY session_id, participant_id, task_id, task_instance_seq
),
page_exit_overlap AS (
  SELECT
    e.session_id,
    e.participant_id,
    e.task_id,
    e.task_instance_seq,
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
    ON b.session_id = e.session_id
    AND b.participant_id = e.participant_id
    AND b.task_id = e.task_id
    AND b.task_instance_seq = e.task_instance_seq
  WHERE e.event_type = 'page_exit'
),
task_page_totals AS (
  SELECT
    session_id,
    participant_id,
    task_id,
    task_instance_seq,
    SUM(dwell_ms_within_task)::BIGINT AS task_total_page_dwell_ms
  FROM page_exit_overlap
  GROUP BY session_id, participant_id, task_id, task_instance_seq
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
  ON t.session_id = b.session_id
  AND t.participant_id = b.participant_id
  AND t.task_id = b.task_id
  AND t.task_instance_seq = b.task_instance_seq;

CREATE OR REPLACE VIEW telemetry_task_page_metrics AS
WITH task_bounds AS (
  SELECT
    session_id,
    participant_id,
    task_id,
    task_instance_seq,
    MIN(event_at) FILTER (WHERE event_type = 'task_start') AS task_started_at,
    MAX(event_at) FILTER (WHERE event_type = 'task_end') AS task_ended_at
  FROM telemetry_task_events_enriched
  GROUP BY session_id, participant_id, task_id, task_instance_seq
),
page_exit_overlap AS (
  SELECT
    e.session_id,
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
    ON b.session_id = e.session_id
    AND b.participant_id = e.participant_id
    AND b.task_id = e.task_id
    AND b.task_instance_seq = e.task_instance_seq
  WHERE e.event_type = 'page_exit'
    AND e.page_path IS NOT NULL
    AND e.page_path <> ''
),
page_dwell AS (
  SELECT
    session_id,
    participant_id,
    task_id,
    task_instance_seq,
    page_path,
    SUM(dwell_ms_within_task)::BIGINT AS page_dwell_ms,
    COUNT(*) AS page_exit_count
  FROM page_exit_overlap
  GROUP BY session_id, participant_id, task_id, task_instance_seq, page_path
),
page_views AS (
  SELECT
    session_id,
    participant_id,
    task_id,
    task_instance_seq,
    page_path,
    COUNT(*) AS page_view_count
  FROM telemetry_task_events_enriched
  WHERE event_type = 'page_view'
    AND page_path IS NOT NULL
    AND page_path <> ''
  GROUP BY session_id, participant_id, task_id, task_instance_seq, page_path
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
  ON v.session_id = d.session_id
  AND v.participant_id = d.participant_id
  AND v.task_id = d.task_id
  AND v.task_instance_seq = d.task_instance_seq
  AND v.page_path = d.page_path;
