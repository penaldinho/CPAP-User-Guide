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
SELECT
  session_id,
  participant_id,
  task_id,
  task_instance_seq,
  MIN(task_label) FILTER (WHERE task_label IS NOT NULL AND task_label <> '') AS task_label,
  MIN(event_at) FILTER (WHERE event_type = 'task_start') AS task_started_at,
  MAX(event_at) FILTER (WHERE event_type = 'task_end') AS task_ended_at,
  COALESCE(
    MAX(duration_ms) FILTER (WHERE event_type = 'task_end' AND duration_ms IS NOT NULL),
    CASE
      WHEN MIN(event_at) FILTER (WHERE event_type = 'task_start') IS NOT NULL
        AND MAX(event_at) FILTER (WHERE event_type = 'task_end') IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (
          MAX(event_at) FILTER (WHERE event_type = 'task_end')
          -
          MIN(event_at) FILTER (WHERE event_type = 'task_start')
        )) * 1000)::BIGINT
      ELSE NULL
    END
  ) AS task_total_duration_ms,
  SUM(COALESCE(duration_ms, 0)) FILTER (WHERE event_type = 'page_exit') AS task_total_page_dwell_ms,
  COUNT(*) AS task_event_count
FROM telemetry_task_events_enriched
GROUP BY session_id, participant_id, task_id, task_instance_seq;

CREATE OR REPLACE VIEW telemetry_task_page_metrics AS
SELECT
  session_id,
  participant_id,
  task_id,
  task_instance_seq,
  page_path,
  SUM(COALESCE(duration_ms, 0)) FILTER (WHERE event_type = 'page_exit') AS page_dwell_ms,
  COUNT(*) FILTER (WHERE event_type = 'page_view') AS page_view_count,
  COUNT(*) FILTER (WHERE event_type = 'page_exit') AS page_exit_count
FROM telemetry_task_events_enriched
WHERE page_path IS NOT NULL AND page_path <> ''
GROUP BY session_id, participant_id, task_id, task_instance_seq, page_path;
