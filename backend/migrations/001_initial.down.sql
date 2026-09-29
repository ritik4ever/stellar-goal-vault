-- Rollback 001_initial. Children are dropped before their parent tables.

DROP TABLE IF EXISTS campaign_comments;
DROP TABLE IF EXISTS webhook_dead_letter_queue;
DROP TABLE IF EXISTS campaign_events;
DROP TABLE IF EXISTS pledges;

DROP TRIGGER IF EXISTS after_campaigns_delete;
DROP TRIGGER IF EXISTS after_campaigns_update;
DROP TRIGGER IF EXISTS after_campaigns_insert;
DROP TABLE IF EXISTS campaigns_fts;

DROP TABLE IF EXISTS campaigns;
