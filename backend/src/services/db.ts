import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  applyPendingMigrations,
  getAppliedMigrations,
  loadMigrations,
  markMigrationsApplied,
} from '../db/migrator';
import { isLegacyDatabase, LEGACY_BASELINE_VERSION, upgradeLegacySchema } from '../db/legacySchema';

export type SQLiteDatabase = ReturnType<typeof Database>;

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

export function migrate(database: SQLiteDatabase = getDb()): void {
  database.transaction(() => runMigrations(database))();
}

export function runMigrations(database: SQLiteDatabase): void {
  const migrations = loadMigrations();

  // Databases created before versioned migrations have tables but no history.
  // Bring them to the baseline schema once, then record 001..baseline as applied.
  if (getAppliedMigrations(database).length === 0 && isLegacyDatabase(database)) {
    upgradeLegacySchema(database);
    markMigrationsApplied(
      database,
      migrations.filter((migration) => migration.version <= LEGACY_BASELINE_VERSION),
    );
  }

  applyPendingMigrations(database, migrations);
  applyStartupInvariants(database);
}

/**
 * Data repairs and drift guards run on every startup, after versioned
 * migrations. Schema changes do not belong here; add a migration file instead.
 */
export function applyStartupInvariants(database: SQLiteDatabase): void {
  ensureMigrationRunnerIndexes(database);

  // Backfill token_id for pledges written without one.
  database.exec(`UPDATE pledges SET token_id = asset_code WHERE token_id IS NULL`);

  // pledged_amount is a cache of non-refunded pledges; rebuild it from source.
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

  ensureSeedWorkflowIndexes(database);
  ensureQueryLayerIndexes(database);
  ensureCampaignsIntegrityConstraints(database);
}

/**
 * Indexes used by the migration runner (runMigrations) to accelerate backfill,
 * deduplication, and pledged_amount accounting queries across schema upgrades.
 * Safe to call repeatedly (IF NOT EXISTS).
 */
export function ensureMigrationRunnerIndexes(database: SQLiteDatabase = getDb()): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_pledges_token_id_null
      ON pledges(token_id) WHERE token_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_refunded
      ON pledges(campaign_id, refunded_at);

    CREATE INDEX IF NOT EXISTS idx_pledges_tx_hash_migration
      ON pledges(transaction_hash) WHERE transaction_hash IS NOT NULL;
  `);
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

    CREATE INDEX IF NOT EXISTS idx_campaigns_status
      ON campaigns(claimed_at, failed_at, deleted_at);
  `);
}
