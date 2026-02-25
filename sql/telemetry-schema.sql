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
  response_length INTEGER,
  duration_ms INTEGER,
  referrer TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_participant_timestamp
  ON telemetry_events (participant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_session_timestamp
  ON telemetry_events (session_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_event_type_timestamp
  ON telemetry_events (event_type, received_at DESC);
