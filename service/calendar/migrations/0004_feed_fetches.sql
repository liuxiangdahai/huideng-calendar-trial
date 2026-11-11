-- When each calendar app last fetched a subscription (11-11). One row per
-- subscription and app family (google, apple, xiaomi, outlook, android,
-- browser, other), updated at most once an hour. It answers "did Google come
-- back after the change?" without guessing. No tokens or addresses are kept.
CREATE TABLE feed_fetches (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  client TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, client)
);
