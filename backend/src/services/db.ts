import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

type SQLiteDatabase = ReturnType<typeof Database>;

// Module-level singleton for production use only.
// Tests should use initDb(path) with an isolated path or :memory:.
let db: SQLiteDatabase | null = null;

/** Hard cap for query-layer pagination (matches API list limits). */
export const QUERY_LAYER_MAX_LIMIT = 100;

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

  db = new Database(dbPath);

  // Enable Write-Ahead Logging (WAL) mode.
  // This is the chosen journal mode to prevent unnecessary lock contention,
  // allowing reads and writes to occur concurrently without blocking each other.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
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

/**
 * Normalize pagination for the query layer so OFFSET/LIMIT cannot go negative
 * or unbounded. Invalid values fall back to page=1, limit=20.
 */
export function normalizeQueryPagination(
  page: number = 1,
  limit: number = 20,
): { page: number; limit: number; offset: number } {
  const safePage =
    typeof page === 'number' && Number.isFinite(page) && Number.isInteger(page) && page >= 1
      ? page
      : 1;
  const rawLimit =
    typeof limit === 'number' && Number.isFinite(limit) && Number.isInteger(limit) && limit >= 1
      ? limit
      : 20;
  const safeLimit = Math.min(rawLimit, QUERY_LAYER_MAX_LIMIT);
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

export function getPledgesByContributor(
  contributor: string,
  page = 1,
  limit = 20,
): ContributorPledge[] {
  if (typeof contributor !== 'string' || contributor.trim().length === 0) {
    throw new Error('contributor must be a non-empty string');
  }

  const database = getDb();
  const { limit: safeLimit, offset } = normalizeQueryPagination(page, limit);
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
    .all(contributor.trim(), safeLimit, offset) as ContributorPledge[];
  return rows;
}


/**
 * Install query-layer integrity enforcement for existing databases.
 *
 * SQLite cannot ADD CHECK via ALTER TABLE, so CREATE TABLE CHECKs only apply to
 * freshly created schemas. Triggers mirror the same safe invariant subset for
 * databases that already exist, without requiring a destructive rebuild.
 */
function ensureQueryLayerIntegrityConstraints(database: SQLiteDatabase): void {
  // Soft-clean cached totals that violate the non-negative invariant so later
  // accounting UPDATEs succeed under the new rules. Do not invent target/pledge
  // amounts — those are application-owned history.
  database.exec(`
    UPDATE campaigns SET pledged_amount = 0 WHERE pledged_amount < 0;
  `);

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS campaigns_query_integrity_insert
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

    CREATE TRIGGER IF NOT EXISTS campaigns_query_integrity_update
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

    CREATE TRIGGER IF NOT EXISTS pledges_query_integrity_insert
    BEFORE INSERT ON pledges
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.campaign_id IS NULL OR length(trim(NEW.campaign_id)) = 0
          THEN RAISE(ABORT, 'pledges.campaign_id must be non-empty')
        WHEN NEW.contributor IS NULL OR length(trim(NEW.contributor)) = 0
          THEN RAISE(ABORT, 'pledges.contributor must be non-empty')
        WHEN NEW.amount IS NULL OR NEW.amount <= 0
          THEN RAISE(ABORT, 'pledges.amount must be > 0')
        WHEN NEW.asset_code IS NULL OR length(trim(NEW.asset_code)) = 0
          THEN RAISE(ABORT, 'pledges.asset_code must be non-empty')
        WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
          THEN RAISE(ABORT, 'pledges.created_at must be > 0')
        WHEN NEW.refunded_at IS NOT NULL AND NEW.refunded_at < NEW.created_at
          THEN RAISE(ABORT, 'pledges.refunded_at must be >= created_at')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS pledges_query_integrity_update
    BEFORE UPDATE ON pledges
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.campaign_id IS NULL OR length(trim(NEW.campaign_id)) = 0
          THEN RAISE(ABORT, 'pledges.campaign_id must be non-empty')
        WHEN NEW.contributor IS NULL OR length(trim(NEW.contributor)) = 0
          THEN RAISE(ABORT, 'pledges.contributor must be non-empty')
        WHEN NEW.amount IS NULL OR NEW.amount <= 0
          THEN RAISE(ABORT, 'pledges.amount must be > 0')
        WHEN NEW.asset_code IS NULL OR length(trim(NEW.asset_code)) = 0
          THEN RAISE(ABORT, 'pledges.asset_code must be non-empty')
        WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
          THEN RAISE(ABORT, 'pledges.created_at must be > 0')
        WHEN NEW.refunded_at IS NOT NULL AND NEW.refunded_at < NEW.created_at
          THEN RAISE(ABORT, 'pledges.refunded_at must be >= created_at')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS campaign_events_query_integrity_insert
    BEFORE INSERT ON campaign_events
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.campaign_id IS NULL OR length(trim(NEW.campaign_id)) = 0
          THEN RAISE(ABORT, 'campaign_events.campaign_id must be non-empty')
        WHEN NEW.event_type IS NULL OR length(trim(NEW.event_type)) = 0
          THEN RAISE(ABORT, 'campaign_events.event_type must be non-empty')
        WHEN NEW.timestamp IS NULL OR NEW.timestamp <= 0
          THEN RAISE(ABORT, 'campaign_events.timestamp must be > 0')
        WHEN NEW.amount IS NOT NULL AND NEW.amount < 0
          THEN RAISE(ABORT, 'campaign_events.amount must be >= 0')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS campaign_comments_query_integrity_insert
    BEFORE INSERT ON campaign_comments
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.campaign_id IS NULL OR length(trim(NEW.campaign_id)) = 0
          THEN RAISE(ABORT, 'campaign_comments.campaign_id must be non-empty')
        WHEN NEW.author IS NULL OR length(trim(NEW.author)) = 0
          THEN RAISE(ABORT, 'campaign_comments.author must be non-empty')
        WHEN NEW.content IS NULL OR length(trim(NEW.content)) = 0
          THEN RAISE(ABORT, 'campaign_comments.content must be non-empty')
        WHEN NEW.created_at IS NULL OR NEW.created_at <= 0
          THEN RAISE(ABORT, 'campaign_comments.created_at must be > 0')
      END;
    END;
  `);
}

function migrate(database: SQLiteDatabase): void {
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
      campaign_id       TEXT NOT NULL CHECK(length(trim(campaign_id)) > 0),
      contributor       TEXT NOT NULL CHECK(length(trim(contributor)) > 0),
      amount            REAL NOT NULL CHECK(amount > 0),
      asset_code        TEXT NOT NULL CHECK(length(trim(asset_code)) > 0),
      token_id          TEXT,
      created_at        INTEGER NOT NULL CHECK(created_at > 0),
      refunded_at       INTEGER,
      transaction_hash TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      CHECK(refunded_at IS NULL OR refunded_at >= created_at)
    );

    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_id ON pledges(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_pledges_contributor ON pledges(contributor, created_at, id);

    CREATE TABLE IF NOT EXISTS campaign_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id         TEXT NOT NULL CHECK(length(trim(campaign_id)) > 0),
      event_type          TEXT NOT NULL CHECK(length(trim(event_type)) > 0),
      timestamp           INTEGER NOT NULL CHECK(timestamp > 0),
      actor               TEXT,
      amount              REAL CHECK(amount IS NULL OR amount >= 0),
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
      campaign_id TEXT NOT NULL CHECK(length(trim(campaign_id)) > 0),
      author      TEXT NOT NULL CHECK(length(trim(author)) > 0),
      content     TEXT NOT NULL CHECK(length(trim(content)) > 0),
      created_at  INTEGER NOT NULL CHECK(created_at > 0),
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

  try {
    database.exec(`ALTER TABLE campaign_events ADD COLUMN blockchain_metadata TEXT;`);
  } catch {
    // Column already exists, ignore error.
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

  // Query-layer integrity: CHECK on fresh tables + triggers for existing DBs.
  ensureQueryLayerIntegrityConstraints(database);
}

/**
 * Indexes used by the deterministic seed wipe/reseed path and the accounting
 * queries that validate seed output. Safe to call repeatedly (IF NOT EXISTS).
 */
export function ensureSeedWorkflowIndexes(database: SQLiteDatabase = getDb()): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_campaign_id
      ON notifications(campaign_id);

    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_refunded
      ON pledges(campaign_id, refunded_at);

    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_created_id
      ON pledges(campaign_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_campaigns_created_at
      ON campaigns(created_at);
  `);
}
