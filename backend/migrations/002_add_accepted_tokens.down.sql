-- Rollback 002_add_accepted_tokens. The triggers reference the column, so they
-- must be dropped before it (SQLite rejects DROP COLUMN otherwise).

DROP TRIGGER IF EXISTS campaigns_persistence_integrity_update;
DROP TRIGGER IF EXISTS campaigns_persistence_integrity_insert;

ALTER TABLE campaigns DROP COLUMN accepted_tokens_json;
