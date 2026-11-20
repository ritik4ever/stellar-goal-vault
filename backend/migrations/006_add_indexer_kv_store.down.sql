-- Rollback 006_add_indexer_kv_store.
--
-- Drops the indexer cursor table. startEventIndexer() recreates an empty one if
-- the worker runs again, in which case it resumes from ledger 0.

DROP TABLE IF EXISTS kv_store;
