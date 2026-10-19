-- 004_add_query_plan_indexes: pledge uniqueness plus indexes backed by concrete
-- query plans (see src/services/DB_SCHEMA.md, "Index Strategy").

-- A pledge's on-chain transaction may only be recorded once.
CREATE UNIQUE INDEX idx_pledges_transaction_hash
  ON pledges(transaction_hash)
  WHERE transaction_hash IS NOT NULL;

-- Startup backfill, deduplication, and pledged_amount accounting.
CREATE INDEX idx_pledges_token_id_null
  ON pledges(token_id) WHERE token_id IS NULL;
CREATE INDEX idx_pledges_campaign_refunded
  ON pledges(campaign_id, refunded_at);
CREATE INDEX idx_pledges_tx_hash_migration
  ON pledges(transaction_hash) WHERE transaction_hash IS NOT NULL;

-- Seed workflow and ordered listings.
CREATE INDEX idx_pledges_campaign_created_id
  ON pledges(campaign_id, created_at DESC, id DESC);
CREATE INDEX idx_campaigns_created_at
  ON campaigns(created_at);

-- Query layer (#889).
CREATE INDEX idx_pledges_campaign_contributor
  ON pledges(campaign_id, contributor, refunded_at);
CREATE INDEX idx_campaign_events_campaign_timestamp
  ON campaign_events(campaign_id, timestamp ASC, id ASC);
CREATE INDEX idx_campaign_comments_campaign_created
  ON campaign_comments(campaign_id, deleted_at, created_at DESC);

-- Blockchain metadata lookups on campaign events.
CREATE INDEX idx_campaign_events_source
  ON campaign_events(json_extract(blockchain_metadata, '$.source'));
CREATE INDEX idx_campaign_events_tx_hash
  ON campaign_events(json_extract(blockchain_metadata, '$.txHash'));
CREATE INDEX idx_campaign_events_ledger
  ON campaign_events(json_extract(blockchain_metadata, '$.ledgerNumber'));
