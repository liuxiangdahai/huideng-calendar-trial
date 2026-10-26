-- Additive cache only: the publication ledger remains the source of UID and
-- SEQUENCE history. Dropping/expiring a snapshot never resets that history.
CREATE TABLE IF NOT EXISTS feed_snapshots (
  subscription_id TEXT PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  settings_revision INTEGER NOT NULL,
  data_version TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  local_day TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ics TEXT NOT NULL,
  etag TEXT NOT NULL,
  last_modified TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feed_snapshots_expiry ON feed_snapshots(expires_at);
