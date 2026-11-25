-- 001_initial: core campaign, pledge, event, comment, and webhook DLQ schema.

CREATE TABLE campaigns (
  id                    TEXT PRIMARY KEY,
  creator               TEXT NOT NULL CHECK(length(trim(creator)) > 0),
  title                 TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description           TEXT NOT NULL CHECK(length(trim(description)) > 0),
  target_amount         REAL NOT NULL CHECK(target_amount > 0),
  pledged_amount        REAL NOT NULL DEFAULT 0 CHECK(pledged_amount >= 0),
  deadline              INTEGER NOT NULL CHECK(deadline > 0),
  created_at            INTEGER NOT NULL CHECK(created_at > 0),
  claimed_at            INTEGER,
  failed_at             INTEGER,
  deleted_at            INTEGER,
  metadata_json         TEXT,
  max_per_contributor   INTEGER CHECK(max_per_contributor IS NULL OR max_per_contributor >= 0),
  CHECK(claimed_at IS NULL OR failed_at IS NULL)
);

CREATE INDEX idx_campaigns_creator ON campaigns(creator);
CREATE INDEX idx_campaigns_deadline ON campaigns(deadline);
CREATE INDEX idx_campaigns_status ON campaigns(claimed_at, failed_at, deleted_at);

-- Derived full-text search index over campaigns, kept in sync by triggers.
CREATE VIRTUAL TABLE campaigns_fts USING fts5(
  id UNINDEXED,
  title,
  description
);

CREATE TRIGGER after_campaigns_insert AFTER INSERT ON campaigns BEGIN
  INSERT INTO campaigns_fts(id, title, description)
  VALUES (new.id, new.title, new.description);
END;

CREATE TRIGGER after_campaigns_update AFTER UPDATE ON campaigns BEGIN
  UPDATE campaigns_fts
  SET title = new.title, description = new.description
  WHERE id = old.id;
END;

CREATE TRIGGER after_campaigns_delete AFTER DELETE ON campaigns BEGIN
  DELETE FROM campaigns_fts WHERE id = old.id;
END;

CREATE TABLE pledges (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id       TEXT NOT NULL,
  contributor       TEXT NOT NULL,
  amount            REAL NOT NULL,
  asset_code        TEXT NOT NULL,
  token_id          TEXT,
  created_at        INTEGER NOT NULL,
  refunded_at       INTEGER,
  transaction_hash  TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX idx_pledges_campaign_id ON pledges(campaign_id);
-- Supports getPledgesByContributor: WHERE contributor ORDER BY created_at DESC, id DESC
CREATE INDEX idx_pledges_contributor ON pledges(contributor, created_at, id);

CREATE TABLE campaign_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id         TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  timestamp           INTEGER NOT NULL,
  actor               TEXT,
  amount              REAL,
  metadata            TEXT,
  blockchain_metadata TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX idx_campaign_events_campaign_id ON campaign_events(campaign_id);
CREATE INDEX idx_campaign_events_timestamp ON campaign_events(timestamp);

CREATE TABLE webhook_dead_letter_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event         TEXT NOT NULL,
  campaign_id   TEXT NOT NULL,
  payload       TEXT NOT NULL,
  error_message TEXT,
  failed_at     INTEGER NOT NULL,
  attempts      INTEGER NOT NULL
);

CREATE INDEX idx_webhook_dlq_campaign_id ON webhook_dead_letter_queue(campaign_id);

CREATE TABLE campaign_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  author      TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX idx_campaign_comments_campaign_id ON campaign_comments(campaign_id);
