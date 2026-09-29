-- Rollback 004_add_query_plan_indexes.

DROP INDEX IF EXISTS idx_campaign_events_ledger;
DROP INDEX IF EXISTS idx_campaign_events_tx_hash;
DROP INDEX IF EXISTS idx_campaign_events_source;

DROP INDEX IF EXISTS idx_campaign_comments_campaign_created;
DROP INDEX IF EXISTS idx_campaign_events_campaign_timestamp;
DROP INDEX IF EXISTS idx_pledges_campaign_contributor;

DROP INDEX IF EXISTS idx_campaigns_created_at;
DROP INDEX IF EXISTS idx_pledges_campaign_created_id;

DROP INDEX IF EXISTS idx_pledges_tx_hash_migration;
DROP INDEX IF EXISTS idx_pledges_campaign_refunded;
DROP INDEX IF EXISTS idx_pledges_token_id_null;

DROP INDEX IF EXISTS idx_pledges_transaction_hash;
