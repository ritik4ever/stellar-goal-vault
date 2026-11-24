-- Rollback 007_add_idempotency_keys.
--
-- Drops the durable idempotency store and its timestamp index.

DROP INDEX IF EXISTS idx_idempotency_keys_stored_at;
DROP TABLE IF EXISTS idempotency_keys;
