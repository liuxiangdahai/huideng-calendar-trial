PRAGMA foreign_keys = ON;

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  feed_token TEXT NOT NULL UNIQUE,
  manage_token_hash TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  render_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendar_entries (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  event_json TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  cancelled_at TEXT,
  PRIMARY KEY (subscription_id, uid)
);

CREATE INDEX calendar_entries_cancelled ON calendar_entries(cancelled_at);

-- Only a daily-salted digest is stored, never the request's IP address.
CREATE TABLE creation_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
