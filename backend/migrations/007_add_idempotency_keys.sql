-- 007_add_idempotency_keys: durable, restart-safe storage for pledge idempotency keys.
--
-- Stores both in-flight claims and completed 2xx responses in SQLite so that:
--   1. Separate worker processes sharing the database coordinate on the same
--      Idempotency-Key instead of executing duplicate pledges concurrently.
--   2. Completed responses survive process restarts even when Redis is absent.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key          TEXT PRIMARY KEY,
  fingerprint  TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  owner_id     TEXT,
  status_code  INTEGER,
  body         TEXT,
  headers_json TEXT,
  stored_at    INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_stored_at
  ON idempotency_keys(stored_at);
