-- 006_add_indexer_kv_store: durable key/value state for the Soroban event indexer.
--
-- The event indexer stores its resume cursor here. Before this migration the
-- table was only created by startEventIndexer(), so anything that persisted or
-- read the cursor before the worker started (tests, backfill, tooling) failed
-- with "no such table: kv_store".
--
-- IF NOT EXISTS keeps this a no-op on databases where the worker already
-- created the table at runtime, so existing cursors are preserved.

CREATE TABLE IF NOT EXISTS kv_store (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
