/**
 * Adoption of databases created before the versioned migration runner.
 *
 * Those databases have tables but no `schema_migrations` history, and may be
 * any older snapshot (missing columns, tables, or indexes). They cannot simply
 * run 001+ because the tables already exist. Instead, `upgradeLegacySchema()`
 * idempotently brings them to the schema of migration LEGACY_BASELINE_VERSION,
 * after which the runner records 001..LEGACY_BASELINE_VERSION as applied and
 * continues with any newer migrations normally.
 *
 * FROZEN: this reproduces the schema at LEGACY_BASELINE_VERSION. Do not change
 * it for new schema work; add a migration file instead.
 */

import type { SQLiteDatabase } from '../services/db';

export const LEGACY_BASELINE_VERSION = 4;

const LEGACY_TABLES = [
  'campaigns',
  'pledges',
  'campaign_events',
  'campaign_comments',
  'webhook_dead_letter_queue',
  'notifications',
];

/** Columns added over time, in the order older snapshots gained them. */
const LEGACY_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'campaigns', column: 'claimed_at', definition: 'INTEGER' },
  { table: 'campaigns', column: 'failed_at', definition: 'INTEGER' },
  { table: 'campaigns', column: 'deleted_at', definition: 'INTEGER' },
  { table: 'campaigns', column: 'metadata_json', definition: 'TEXT' },
  { table: 'campaigns', column: 'max_per_contributor', definition: 'INTEGER' },
  { table: 'pledges', column: 'refunded_at', definition: 'INTEGER' },
  { table: 'pledges', column: 'transaction_hash', definition: 'TEXT' },
  { table: 'pledges', column: 'asset_code', definition: `TEXT NOT NULL DEFAULT 'XLM'` },
  { table: 'pledges', column: 'token_id', definition: 'TEXT' },
  { table: 'campaign_events', column: 'blockchain_metadata', definition: 'TEXT' },
  { table: 'campaign_comments', column: 'deleted_at', definition: 'INTEGER' },
];

function columnNames(database: SQLiteDatabase, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** True when the database has application tables but no migration history. */
export function isLegacyDatabase(database: SQLiteDatabase): boolean {
  const row = database
    .prepare(
      `SELECT 1 AS found FROM sqlite_master
       WHERE type = 'table' AND name IN (${LEGACY_TABLES.map(() => '?').join(', ')})
       LIMIT 1`,
    )
    .get(...LEGACY_TABLES);
  return row !== undefined;
}

export function upgradeLegacySchema(database: SQLiteDatabase): void {
  // 1. Tables missing from the snapshot are created in their baseline shape.
  database.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id                    TEXT PRIMARY KEY,
      creator               TEXT NOT NULL CHECK(length(trim(creator)) > 0),
      title                 TEXT NOT NULL CHECK(length(trim(title)) > 0),
      description           TEXT NOT NULL CHECK(length(trim(description)) > 0),
      accepted_tokens_json  TEXT NOT NULL CHECK(length(trim(accepted_tokens_json)) > 0),
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

    CREATE VIRTUAL TABLE IF NOT EXISTS campaigns_fts USING fts5(
      id UNINDEXED,
      title,
      description
    );

    CREATE TABLE IF NOT EXISTS pledges (
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

    CREATE TABLE IF NOT EXISTS campaign_events (
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

    CREATE TABLE IF NOT EXISTS webhook_dead_letter_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event         TEXT NOT NULL,
      campaign_id   TEXT NOT NULL,
      payload       TEXT NOT NULL,
      error_message TEXT,
      failed_at     INTEGER NOT NULL,
      attempts      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      author      TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      deleted_at  INTEGER,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id   TEXT NOT NULL,
      type          TEXT NOT NULL CHECK(type IN ('new_pledge', 'campaign_funded', 'refund_available', 'creator_update')),
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      target_wallet TEXT NOT NULL,
      actor_wallet  TEXT,
      is_read       INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );
  `);

  // 2. Columns missing from existing tables. Must precede dependent indexes.
  for (const { table, column, definition } of LEGACY_COLUMNS) {
    if (!columnNames(database, table).has(column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // Single-asset campaigns predate accepted_tokens_json; carry the asset over.
  const campaignColumns = columnNames(database, 'campaigns');
  if (!campaignColumns.has('accepted_tokens_json')) {
    database.exec(`
      ALTER TABLE campaigns
        ADD COLUMN accepted_tokens_json TEXT NOT NULL DEFAULT '["XLM"]'
        CHECK(length(trim(accepted_tokens_json)) > 0)
    `);
    if (campaignColumns.has('asset_code')) {
      database.exec(`
        UPDATE campaigns
        SET accepted_tokens_json = json_array(asset_code)
        WHERE asset_code IS NOT NULL AND length(trim(asset_code)) > 0
      `);
    }
  }

  // 3. Duplicate transaction hashes must be removed before the unique index.
  database.exec(`
    DELETE FROM pledges
    WHERE transaction_hash IS NOT NULL
      AND id NOT IN (
        SELECT MIN(id)
        FROM pledges
        WHERE transaction_hash IS NOT NULL
        GROUP BY transaction_hash
      );
  `);

  // 4. Indexes and triggers from migrations 001-004.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_creator ON campaigns(creator);
    CREATE INDEX IF NOT EXISTS idx_campaigns_deadline ON campaigns(deadline);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(claimed_at, failed_at, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);

    CREATE TRIGGER IF NOT EXISTS after_campaigns_insert AFTER INSERT ON campaigns BEGIN
      INSERT INTO campaigns_fts(id, title, description)
      VALUES (new.id, new.title, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS after_campaigns_update AFTER UPDATE ON campaigns BEGIN
      UPDATE campaigns_fts
      SET title = new.title, description = new.description
      WHERE id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS after_campaigns_delete AFTER DELETE ON campaigns BEGIN
      DELETE FROM campaigns_fts WHERE id = old.id;
    END;

    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_id ON pledges(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_pledges_contributor ON pledges(contributor, created_at, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pledges_transaction_hash
      ON pledges(transaction_hash) WHERE transaction_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_pledges_token_id_null
      ON pledges(token_id) WHERE token_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_refunded
      ON pledges(campaign_id, refunded_at);
    CREATE INDEX IF NOT EXISTS idx_pledges_tx_hash_migration
      ON pledges(transaction_hash) WHERE transaction_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_created_id
      ON pledges(campaign_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_contributor
      ON pledges(campaign_id, contributor, refunded_at);

    CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_id ON campaign_events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_timestamp ON campaign_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_timestamp
      ON campaign_events(campaign_id, timestamp ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_source
      ON campaign_events(json_extract(blockchain_metadata, '$.source'));
    CREATE INDEX IF NOT EXISTS idx_campaign_events_tx_hash
      ON campaign_events(json_extract(blockchain_metadata, '$.txHash'));
    CREATE INDEX IF NOT EXISTS idx_campaign_events_ledger
      ON campaign_events(json_extract(blockchain_metadata, '$.ledgerNumber'));

    CREATE INDEX IF NOT EXISTS idx_webhook_dlq_campaign_id ON webhook_dead_letter_queue(campaign_id);

    CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign_id ON campaign_comments(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign_created
      ON campaign_comments(campaign_id, deleted_at, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_target_wallet
      ON notifications(target_wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread
      ON notifications(target_wallet, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_campaign_id
      ON notifications(campaign_id);
  `);

  // 5. Campaigns that predate the FTS table are not yet searchable.
  database.exec(`
    INSERT INTO campaigns_fts (id, title, description)
    SELECT id, title, description FROM campaigns
    WHERE id NOT IN (SELECT id FROM campaigns_fts);
  `);

  // The campaigns_persistence_integrity_* triggers (migration 002) are
  // installed by ensureCampaignsIntegrityConstraints() on every startup, after
  // negative cached totals are soft-cleaned.
}
