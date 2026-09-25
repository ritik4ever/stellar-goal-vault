import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

type SQLiteDatabase = ReturnType<typeof Database>;

// Module-level singleton for production use only.
// Tests should use initDb(path) with an isolated path or :memory:.
let db: SQLiteDatabase | null = null;

function resolveDbPath(): string {
  return process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'campaigns.db');
}

export type DbHealthStatus = 'up' | 'down';

export function getDb(): SQLiteDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }

  return db;
}

export function initDb(customPath?: string): void {
  if (db) {
    return;
  }

  const dbPath = customPath || resolveDbPath();
  const dir = path.dirname(dbPath);

  if (dbPath !== ':memory:' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const database = new Database(dbPath);

  try {
    // Enable Write-Ahead Logging (WAL) mode.
    // This is the chosen journal mode to prevent unnecessary lock contention,
    // allowing reads and writes to occur concurrently without blocking each other.
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('foreign_keys = ON');

    migrate(database);
    db = database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function checkDbHealth(): {
  status: DbHealthStatus;
  reachable: boolean;
  error?: string;
} {
  try {
    const database = getDb();
    database.prepare('SELECT 1 AS ok').get();

    return {
      status: 'up',
      reachable: true,
    };
  } catch (error) {
    return {
      status: 'down',
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ContributorPledge {
  id: number;
  campaignId: string;
  campaignName: string;
  status: string;
  amount: number;
  assetCode: string;
  tokenId: string | null;
  createdAt: number;
  refundedAt: number | null;
  transactionHash: string | null;
}

export function getPledgesByContributor(
  contributor: string,
  page = 1,
  limit = 20,
): ContributorPledge[] {
  const database = getDb();
  const offset = Math.max((page - 1) * limit, 0);
  const rows = database
    .prepare(
      `
      SELECT
        p.id,
        p.campaign_id AS campaignId,
        c.title AS campaignName,
        CASE
          WHEN c.deleted_at IS NOT NULL THEN 'deleted'
          WHEN c.claimed_at IS NOT NULL THEN 'funded'
          WHEN c.failed_at IS NOT NULL THEN 'failed'
          ELSE 'active'
        END AS status,
        p.amount,
        p.asset_code AS assetCode,
        p.token_id AS tokenId,
        p.created_at AS createdAt,
        p.refunded_at AS refundedAt,
        p.transaction_hash AS transactionHash
      FROM pledges p
      INNER JOIN campaigns c ON c.id = p.campaign_id
      WHERE p.contributor = ?
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ? OFFSET ?
      `,
    )
    .all(contributor, limit, offset) as ContributorPledge[];
  return rows;
}

/**
 * Install campaigns-persistence integrity enforcement for existing databases.
 *
 * SQLite cannot ADD CHECK via ALTER TABLE, so CREATE TABLE CHECKs only apply to
 * freshly created schemas. Triggers mirror the same safe invariant subset for
 * databases that already exist, without requiring a destructive rebuild.
 */
export function ensureCampaignsIntegrityConstraints(database: SQLiteDatabase = getDb()): void {
  // Soft-clean cached totals that violate the non-negative invariant so later
  // accounting UPDATEs succeed under the new rules. Do not invent target/pledge
  // history — those are application-owned.
  database.exec(`
    UPDATE campaigns SET pledged_amount = 0 WHERE pledged_amount < 0;
  `);

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS campaigns_persistence_integrity_insert
    BEFORE INSERT ON campaigns
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.creator IS NULL OR length(trim(NEW.creator)) = 0
          THEN RAISE(ABORT, 'campaigns.creator must be non-empty')
        WHEN NEW.title IS NULL OR length(trim(NEW.title)) = 0
          THEN RAISE(ABORT, 'campaigns.title must be non-empty')
        WHEN NEW.description IS NULL OR length(trim(NEW.description)) = 0
          THEN RAISE(ABORT, 'campaigns.description must be non-empty')
        WHEN NEW.accepted_tokens_json IS NULL OR length(trim(NEW.accepted_tokens_json)) = 0
          THEN RAISE(ABORT, 'campaigns.accepted_tokens_json must be non-empty')
        WHEN NEW.target_amount IS NULL OR NEW.target_amount <= 0
          THEN RAISE(ABORT, 'campaigns.target_amount must be > 0')
        WHEN NEW.pledged_amount IS NULL OR NEW.pledged_amount < 0
          THEN RAISE(ABORT, 'campaigns.pledged_amount must be >= 0')
        WHEN NEW.deadline IS NULL OR NEW.deadline <= 0
          THEN RAISE(ABORT, 'campaigns.deadline must be > 0')
        WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
          THEN RAISE(ABORT, 'campaigns.created_at must be > 0')
        WHEN NEW.claimed_at IS NOT NULL AND NEW.failed_at IS NOT NULL
          THEN RAISE(ABORT, 'campaigns cannot be both claimed and failed')
        WHEN NEW.max_per_contributor IS NOT NULL AND NEW.max_per_contributor < 0
          THEN RAISE(ABORT, 'campaigns.max_per_contributor must be >= 0')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS campaigns_persistence_integrity_update
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.creator IS NULL OR length(trim(NEW.creator)) = 0
          THEN RAISE(ABORT, 'campaigns.creator must be non-empty')
        WHEN NEW.title IS NULL OR length(trim(NEW.title)) = 0
          THEN RAISE(ABORT, 'campaigns.title must be non-empty')
        WHEN NEW.description IS NULL OR length(trim(NEW.description)) = 0
          THEN RAISE(ABORT, 'campaigns.description must be non-empty')
        WHEN NEW.accepted_tokens_json IS NULL OR length(trim(NEW.accepted_tokens_json)) = 0
          THEN RAISE(ABORT, 'campaigns.accepted_tokens_json must be non-empty')
        WHEN NEW.target_amount IS NULL OR NEW.target_amount <= 0
          THEN RAISE(ABORT, 'campaigns.target_amount must be > 0')
        WHEN NEW.pledged_amount IS NULL OR NEW.pledged_amount < 0
          THEN RAISE(ABORT, 'campaigns.pledged_amount must be >= 0')
        WHEN NEW.deadline IS NULL OR NEW.deadline <= 0
          THEN RAISE(ABORT, 'campaigns.deadline must be > 0')
        WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
          THEN RAISE(ABORT, 'campaigns.created_at must be > 0')
        WHEN NEW.claimed_at IS NOT NULL AND NEW.failed_at IS NOT NULL
          THEN RAISE(ABORT, 'campaigns cannot be both claimed and failed')
        WHEN NEW.max_per_contributor IS NOT NULL AND NEW.max_per_contributor < 0
          THEN RAISE(ABORT, 'campaigns.max_per_contributor must be >= 0')
      END;
    END;
  `);
}

function migrate(database: SQLiteDatabase): void {
  database.transaction(() => runMigrations(database))();
}

function runMigrations(database: SQLiteDatabase): void {
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

    CREATE INDEX IF NOT EXISTS idx_campaigns_creator ON campaigns(creator);
    CREATE INDEX IF NOT EXISTS idx_campaigns_deadline ON campaigns(deadline);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(claimed_at, failed_at, deleted_at);

    -- 🌟 1. Create our new cheat-sheet search index table
    CREATE VIRTUAL TABLE IF NOT EXISTS campaigns_fts USING fts5(
      id UNINDEXED,
      title,
      description
    );

    -- 🔄 2. Automatically copy new campaigns into the cheat-sheet
    CREATE TRIGGER IF NOT EXISTS after_campaigns_insert AFTER INSERT ON campaigns BEGIN
      INSERT INTO campaigns_fts(id, title, description) 
      VALUES (new.id, new.title, new.description);
    END;

    -- 🔄 3. Automatically update the cheat-sheet if a campaign changes
    CREATE TRIGGER IF NOT EXISTS after_campaigns_update AFTER UPDATE ON campaigns BEGIN
      UPDATE campaigns_fts 
      SET title = new.title, description = new.description 
      WHERE id = old.id;
    END;

    CREATE TABLE IF NOT EXISTS pledges (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id       TEXT NOT NULL,
      contributor       TEXT NOT NULL,
      amount            REAL NOT NULL,
      asset_code        TEXT NOT NULL,
      token_id          TEXT,
      created_at        INTEGER NOT NULL,
      refunded_at       INTEGER,
      transaction_hash TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    -- #874 pledges persistence query indexes (concrete read plans only)
    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_id ON pledges(campaign_id);
    -- Supports getPledgesByContributor: WHERE contributor ORDER BY created_at DESC, id DESC
    CREATE INDEX IF NOT EXISTS idx_pledges_contributor ON pledges(contributor, created_at, id);

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

    CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_id ON campaign_events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_timestamp ON campaign_events(timestamp);

    CREATE TABLE IF NOT EXISTS webhook_dead_letter_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event         TEXT NOT NULL,
      campaign_id   TEXT NOT NULL,
      payload       TEXT NOT NULL,
      error_message TEXT,
      failed_at     INTEGER NOT NULL,
      attempts      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_dlq_campaign_id ON webhook_dead_letter_queue(campaign_id);

    CREATE TABLE IF NOT EXISTS campaign_comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      author      TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      deleted_at  INTEGER,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign_id ON campaign_comments(campaign_id);

  `);

  const pledgeColumns = database.prepare(`PRAGMA table_info(pledges)`).all() as Array<{
    name: string;
  }>;

  const hasTransactionHash = pledgeColumns.some((column) => column.name === 'transaction_hash');
  if (!hasTransactionHash) {
    database.exec(`ALTER TABLE pledges ADD COLUMN transaction_hash TEXT`);
  }

  const hasAssetCode = pledgeColumns.some((column) => column.name === 'asset_code');
  if (!hasAssetCode) {
    database.exec(`ALTER TABLE pledges ADD COLUMN asset_code TEXT NOT NULL DEFAULT 'XLM'`);
  }

  const hasTokenId = pledgeColumns.some((column) => column.name === 'token_id');
  if (!hasTokenId) {
    database.exec(`ALTER TABLE pledges ADD COLUMN token_id TEXT`);
  }

  // Backfill token_id for existing pledges where it's still NULL
  database.exec(`UPDATE pledges SET token_id = asset_code WHERE token_id IS NULL`);

  // Add failed_at column if not exists
  const campaignColumns = database.prepare(`PRAGMA table_info(campaigns)`).all() as Array<{
    name: string;
  }>;
  if (!campaignColumns.some((column) => column.name === 'failed_at')) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN failed_at INTEGER`);
  }

  // Migrate asset_code to accepted_tokens_json if needed
  if (
    campaignColumns.some((column) => column.name === 'asset_code') &&
    !campaignColumns.some((column) => column.name === 'accepted_tokens_json')
  ) {
    // 1. Create the FTS5 virtual table
    database.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS campaigns_fts USING fts5(
    id UNINDEXED,
    title,
    description
  );
`);

    // 2. Add the Triggers to keep data synchronized automatically
    database.exec(`
  -- Triggers for handling future changes
  CREATE TRIGGER IF NOT EXISTS after_campaigns_insert AFTER INSERT ON campaigns BEGIN
    INSERT INTO campaigns_fts(id, title, description) VALUES (new.id, new.title, new.description);
  END;

  CREATE TRIGGER IF NOT EXISTS after_campaigns_update AFTER UPDATE ON campaigns BEGIN
    UPDATE campaigns_fts SET title = new.title, description = new.description WHERE id = old.id;
  END;

  -- Fixes CodeRabbit: Delete trigger to prevent stale/corrupt terms
  CREATE TRIGGER IF NOT EXISTS after_campaigns_delete AFTER DELETE ON campaigns BEGIN
    DELETE FROM campaigns_fts WHERE id = old.id;
  END;
`);

    // 3. Fixes CodeRabbit: Backfill any pre-existing campaigns into the FTS table
    database.exec(`
  INSERT INTO campaigns_fts (id, title, description)
  SELECT id, title, description FROM campaigns
  WHERE id NOT IN (SELECT id FROM campaigns_fts);
`);
  }

  database.exec(`
    DELETE FROM pledges
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM pledges
      WHERE transaction_hash IS NOT NULL
      GROUP BY transaction_hash
    )
    AND transaction_hash IS NOT NULL;
  `);

  database.exec(`
    UPDATE campaigns
    SET pledged_amount = COALESCE(
      (
        SELECT SUM(amount)
        FROM pledges
        WHERE pledges.campaign_id = campaigns.id
          AND refunded_at IS NULL
      ),
      0
    );
  `);

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pledges_transaction_hash
    ON pledges(transaction_hash)
    WHERE transaction_hash IS NOT NULL
  `);

  const campaignEventColumns = database
    .prepare(`PRAGMA table_info(campaign_events)`)
    .all() as Array<{
    name: string;
  }>;
  if (!campaignEventColumns.some((column) => column.name === 'blockchain_metadata')) {
    database.exec(`ALTER TABLE campaign_events ADD COLUMN blockchain_metadata TEXT`);
  }

  const hasMaxPerContributor = campaignColumns.some(
    (column) => column.name === 'max_per_contributor',
  );
  if (!hasMaxPerContributor) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN max_per_contributor INTEGER`);
  }

  database.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_notifications_target_wallet
    ON notifications(target_wallet, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications(target_wallet, is_read);
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_campaign_events_tx_hash
    ON campaign_events(json_extract(blockchain_metadata, '$.txHash'));
    CREATE INDEX IF NOT EXISTS idx_campaign_events_ledger
    ON campaign_events(json_extract(blockchain_metadata, '$.ledgerNumber'));
  `);

  // Seed-workflow indexes: support FK child discovery during wipe/reseed,
  // pledged_amount accounting checks, and post-seed listing by created_at.
  // Only indexes backed by concrete seed + migrate query plans.
  ensureSeedWorkflowIndexes(database);

  // Query-layer indexes: composite plans for contributor/refund lookups,
  // campaign event history pages, and soft-deleted comment lists.
  ensureQueryLayerIndexes(database);

  // Campaigns persistence integrity: CHECK on fresh tables + triggers for
  // existing DBs (SQLite cannot ADD CHECK via ALTER TABLE).
  ensureCampaignsIntegrityConstraints(database);
}

/**
 * Indexes used by the deterministic seed wipe/reseed path and the accounting
 * queries that validate seed output. Safe to call repeatedly (IF NOT EXISTS).
 */
export function ensureSeedWorkflowIndexes(database: SQLiteDatabase = getDb()): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_campaign_id
      ON notifications(campaign_id);

    -- #874: active-pledge accounting (SUM/COUNT where refunded_at IS NULL)
    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_refunded
      ON pledges(campaign_id, refunded_at);

    -- #874: ordered campaign pledge lists (listCampaignPledges)
    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_created_id
      ON pledges(campaign_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_campaigns_created_at
      ON campaigns(created_at);
  `);
}

/**
 * Indexes used by the application query layer (campaignStore / eventHistory /
 * getPledgesByContributor). Safe to call repeatedly (IF NOT EXISTS).
 */
export function ensureQueryLayerIndexes(database: SQLiteDatabase = getDb()): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_contributor
      ON pledges(campaign_id, contributor, refunded_at);

    CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_timestamp
      ON campaign_events(campaign_id, timestamp ASC, id ASC);

    CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign_created
      ON campaign_comments(campaign_id, deleted_at, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_campaign_events_source
      ON campaign_events(json_extract(blockchain_metadata, '$.source'));
  `);
}
