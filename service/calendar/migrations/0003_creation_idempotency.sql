-- Nullable columns preserve legacy clients and existing subscriptions.
-- Recovery keys and management tokens are capabilities: store only their hashes.
ALTER TABLE subscriptions ADD COLUMN creation_key_hash TEXT;
ALTER TABLE subscriptions ADD COLUMN creation_body_hash TEXT;
CREATE UNIQUE INDEX subscriptions_creation_key ON subscriptions(creation_key_hash);
