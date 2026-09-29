import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureCampaignsIntegrityConstraints,
  ensureMigrationRunnerIndexes,
  getDb,
  initDb,
  migrate,
  resetDbForTests,
  runMigrations,
  type SQLiteDatabase,
} from './index';

const TEST_DB = path.join('/tmp', `sgv-migration-runner-regression-${process.pid}.db`);

function removeTestDatabase(dbPath: string = TEST_DB): void {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
}

describe('Migration runner database regression tests (#881)', () => {
  beforeEach(() => {
    resetDbForTests();
    removeTestDatabase();
  });

  afterEach(() => {
    resetDbForTests();
    removeTestDatabase();
  });

  // =========================================================================
  // 1. ORDERING & SCHEMA EVOLUTION (Failure mode missed by happy-path tests)
  // =========================================================================
  describe('Ordering and schema evolution', () => {
    it('reproduces failure mode: index creation before column addition fails on legacy schema', () => {
      // In an older schema snapshot, pledges lacked token_id and transaction_hash.
      // If ensureMigrationRunnerIndexes runs before ALTER TABLE adds token_id,
      // SQLite raises: "no such column: token_id".
      const db = new Database(TEST_DB);
      try {
        db.exec(`
          CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            creator TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            accepted_tokens_json TEXT NOT NULL,
            target_amount REAL NOT NULL,
            pledged_amount REAL NOT NULL DEFAULT 0,
            deadline INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            claimed_at INTEGER,
            deleted_at INTEGER
          );
          CREATE TABLE pledges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL,
            contributor TEXT NOT NULL,
            amount REAL NOT NULL,
            created_at INTEGER NOT NULL
          );
        `);

        // Demonstrates the failure mode that happy-path tests miss:
        // Trying to create the runner index directly on the un-migrated table throws.
        expect(() => {
          db.exec(
            'CREATE INDEX idx_pledges_token_id_null ON pledges(token_id) WHERE token_id IS NULL;',
          );
        }).toThrow(/no such column: token_id/i);
      } finally {
        db.close();
      }
    });

    it('safely upgrades a legacy database missing newer columns without missing-column errors', () => {
      const db = new Database(TEST_DB);
      try {
        // Legacy schema: pledges has no transaction_hash, token_id, or asset_code;
        // campaigns has no failed_at or max_per_contributor.
        db.exec(`
          CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            creator TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            accepted_tokens_json TEXT NOT NULL,
            target_amount REAL NOT NULL,
            pledged_amount REAL NOT NULL DEFAULT 0,
            deadline INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            claimed_at INTEGER,
            deleted_at INTEGER
          );
          CREATE TABLE pledges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL,
            contributor TEXT NOT NULL,
            amount REAL NOT NULL,
            created_at INTEGER NOT NULL,
            refunded_at INTEGER,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
          );
        `);

        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'c-legacy',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          'Legacy Campaign',
          'Created before migration runner additions.',
          '["XLM"]',
          500,
          50,
          1_800_000_000,
          1_700_000_000,
        );

        db.prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(
          'c-legacy',
          'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          50,
          1_700_000_100,
        );

        // Run full migration on the legacy database instance
        migrate(db);

        // Verify columns were added in correct order before indexes
        const pledgeCols = (db.prepare('PRAGMA table_info(pledges)').all() as Array<{ name: string }>).map(
          (c) => c.name,
        );
        expect(pledgeCols).toContain('transaction_hash');
        expect(pledgeCols).toContain('asset_code');
        expect(pledgeCols).toContain('token_id');

        const campaignCols = (
          db.prepare('PRAGMA table_info(campaigns)').all() as Array<{ name: string }>
        ).map((c) => c.name);
        expect(campaignCols).toContain('failed_at');
        expect(campaignCols).toContain('max_per_contributor');

        // Verify runner indexes exist
        const indexes = (
          db
            .prepare(
              `SELECT name FROM sqlite_master
               WHERE type = 'index' AND name IN (
                 'idx_pledges_token_id_null',
                 'idx_pledges_tx_hash_migration',
                 'idx_pledges_campaign_refunded',
                 'idx_pledges_transaction_hash'
               )`,
            )
            .all() as Array<{ name: string }>
        ).map((r) => r.name);

        expect(indexes).toContain('idx_pledges_token_id_null');
        expect(indexes).toContain('idx_pledges_tx_hash_migration');
        expect(indexes).toContain('idx_pledges_campaign_refunded');
        expect(indexes).toContain('idx_pledges_transaction_hash');

        // Verify default/backfilled data
        const pledge = db
          .prepare('SELECT amount, asset_code, token_id FROM pledges WHERE campaign_id = ?')
          .get('c-legacy') as { amount: number; asset_code: string; token_id: string };
        expect(pledge.asset_code).toBe('XLM');
        expect(pledge.token_id).toBe('XLM');
      } finally {
        db.close();
      }
    });

    it('ensures after_campaigns_delete trigger synchronizes campaigns_fts on delete', () => {
      initDb(TEST_DB);
      const db = getDb();

      // Verify trigger exists on fresh DB
      const triggers = (
        db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'trigger' AND name = 'after_campaigns_delete'`,
          )
          .all() as Array<{ name: string }>
      ).map((t) => t.name);
      expect(triggers).toContain('after_campaigns_delete');

      // Insert a campaign
      db.prepare(
        `INSERT INTO campaigns (
          id, creator, title, description, accepted_tokens_json,
          target_amount, pledged_amount, deadline, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'c-search-sync',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'Quantum Computing Fund',
        'Next-generation quantum algorithms on Stellar.',
        '["XLM"]',
        1000,
        0,
        1_800_000_000,
        1_700_000_000,
      );

      // Verify FTS table has the entry
      const ftsBefore = db
        .prepare('SELECT id, title FROM campaigns_fts WHERE id = ?')
        .get('c-search-sync') as { id: string; title: string } | undefined;
      expect(ftsBefore?.id).toBe('c-search-sync');
      expect(ftsBefore?.title).toBe('Quantum Computing Fund');

      // Delete the campaign
      db.prepare('DELETE FROM campaigns WHERE id = ?').run('c-search-sync');

      // Verify FTS entry is purged via after_campaigns_delete
      const ftsAfter = db
        .prepare('SELECT id FROM campaigns_fts WHERE id = ?')
        .get('c-search-sync');
      expect(ftsAfter).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. CONSTRAINTS
  // =========================================================================
  describe('Constraints and schema invariants', () => {
    it('enforces unique non-null transaction_hash and allows multiple nulls', () => {
      initDb(TEST_DB);
      const db = getDb();

      db.prepare(
        `INSERT INTO campaigns (
          id, creator, title, description, accepted_tokens_json,
          target_amount, pledged_amount, deadline, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'c-unique',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'Unique Constraint Campaign',
        'Testing pledge hash uniqueness.',
        '["XLM"]',
        100,
        0,
        1_800_000_000,
        1_700_000_000,
      );

      const insertPledge = db.prepare(
        `INSERT INTO pledges (
          campaign_id, contributor, amount, asset_code, token_id, created_at, transaction_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      // First insert with hash succeeds
      insertPledge.run(
        'c-unique',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        10,
        'XLM',
        'XLM',
        1_700_000_000,
        'hash-001',
      );

      // Duplicate hash must be rejected by unique index
      expect(() => {
        insertPledge.run(
          'c-unique',
          'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          10,
          'XLM',
          'XLM',
          1_700_000_001,
          'hash-001',
        );
      }).toThrow(/UNIQUE constraint failed/i);

      // Multiple null transaction_hash values are explicitly allowed
      expect(() => {
        insertPledge.run(
          'c-unique',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          5,
          'XLM',
          'XLM',
          1_700_000_002,
          null,
        );
        insertPledge.run(
          'c-unique',
          'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          5,
          'XLM',
          'XLM',
          1_700_000_003,
          null,
        );
      }).not.toThrow();
    });

    it('enforces campaigns integrity constraints on inserts and updates', () => {
      initDb(TEST_DB);
      const db = getDb();

      const insertCampaign = db.prepare(
        `INSERT INTO campaigns (
          id, creator, title, description, accepted_tokens_json,
          target_amount, pledged_amount, deadline, created_at, max_per_contributor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      // Rejects empty creator
      expect(() =>
        insertCampaign.run('c1', '   ', 'Title', 'Desc', '["XLM"]', 100, 0, 1000, 100, null),
      ).toThrow();

      // Rejects non-positive target_amount
      expect(() =>
        insertCampaign.run('c2', 'GAA', 'Title', 'Desc', '["XLM"]', 0, 0, 1000, 100, null),
      ).toThrow();

      // Rejects negative pledged_amount
      expect(() =>
        insertCampaign.run('c3', 'GAA', 'Title', 'Desc', '["XLM"]', 100, -10, 1000, 100, null),
      ).toThrow();

      // Rejects negative max_per_contributor
      expect(() =>
        insertCampaign.run('c4', 'GAA', 'Title', 'Desc', '["XLM"]', 100, 0, 1000, 100, -5),
      ).toThrow();

      // Rejects conflicting lifecycle timestamps (both claimed and failed)
      expect(() => {
        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at, claimed_at, failed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('c5', 'GAA', 'Title', 'Desc', '["XLM"]', 100, 0, 1000, 100, 500, 600);
      }).toThrow();
    });

    it('enforces foreign key constraints between pledges and campaigns', () => {
      initDb(TEST_DB);
      const db = getDb();

      // Foreign keys must be ON
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);

      // Pledging to non-existent campaign must fail
      expect(() => {
        db.prepare(
          `INSERT INTO pledges (
            campaign_id, contributor, amount, asset_code, token_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run('non-existent-campaign', 'GAA', 50, 'XLM', 'XLM', 1_700_000_000);
      }).toThrow(/FOREIGN KEY constraint failed/i);
    });
  });

  // =========================================================================
  // 3. TRANSACTION ROLLBACK
  // =========================================================================
  describe('Transaction rollback', () => {
    it('rolls back all schema and data changes when a migration step aborts', () => {
      const db = new Database(TEST_DB);
      try {
        // Initial setup before running migrate()
        db.exec(`
          CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            creator TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            accepted_tokens_json TEXT NOT NULL,
            target_amount REAL NOT NULL,
            pledged_amount REAL NOT NULL DEFAULT 0,
            deadline INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            claimed_at INTEGER,
            deleted_at INTEGER
          );
        `);
        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('c-init', 'GAA', 'Initial', 'Initial Desc', '["XLM"]', 100, 42, 1000, 100);

        // Inject a failure into runMigrations via a trigger on campaigns
        // that fires during the UPDATE campaigns SET pledged_amount step
        db.exec(`
          CREATE TRIGGER abort_on_pledged_recompute
          BEFORE UPDATE OF pledged_amount ON campaigns
          BEGIN
            SELECT RAISE(ABORT, 'forced rollback during migration test');
          END;
        `);

        // migrate() wraps runMigrations in database.transaction()
        expect(() => migrate(db)).toThrow('forced rollback during migration test');

        // Verify that partial migration state (such as notifications table or created indexes)
        // was rolled back completely and does not exist in the database
        const tables = (
          db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
            name: string;
          }>
        ).map((t) => t.name);

        expect(tables).toContain('campaigns');
        expect(tables).not.toContain('notifications');

        // Original row data is unchanged
        const campaign = db
          .prepare('SELECT pledged_amount FROM campaigns WHERE id = ?')
          .get('c-init') as { pledged_amount: number };
        expect(campaign.pledged_amount).toBe(42);

        // Remove the failure injection and retry
        db.exec('DROP TRIGGER abort_on_pledged_recompute;');
        expect(() => migrate(db)).not.toThrow();

        // Verify clean completion after retry
        const migratedTables = (
          db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
            name: string;
          }>
        ).map((t) => t.name);

        expect(migratedTables).toContain('pledges');
        expect(migratedTables).toContain('notifications');
        expect(migratedTables).toContain('campaign_events');
        expect(migratedTables).toContain('campaign_comments');
      } finally {
        db.close();
      }
    });
  });

  // =========================================================================
  // 4. EDGE-CASE DATA & ACCOUNTING INVARIANTS
  // =========================================================================
  describe('Edge-case data handling', () => {
    it('deduplicates duplicate transaction hashes preserving lowest id and non-null totals', () => {
      const db = new Database(TEST_DB);
      try {
        db.exec(`
          CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            creator TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            accepted_tokens_json TEXT NOT NULL,
            target_amount REAL NOT NULL,
            pledged_amount REAL NOT NULL DEFAULT 0,
            deadline INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            claimed_at INTEGER,
            deleted_at INTEGER
          );
          CREATE TABLE pledges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL,
            contributor TEXT NOT NULL,
            amount REAL NOT NULL,
            asset_code TEXT NOT NULL,
            token_id TEXT,
            created_at INTEGER NOT NULL,
            refunded_at INTEGER,
            transaction_hash TEXT
          );
        `);

        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('c-dedup', 'GAA', 'Dedup Test', 'Dedup Desc', '["XLM"]', 1000, 300, 2000, 1000);

        const insertPledge = db.prepare(
          `INSERT INTO pledges (
            campaign_id, contributor, amount, asset_code, token_id, created_at, refunded_at, transaction_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        // Duplicate group with tx_hash 'tx-dup-1'
        insertPledge.run('c-dedup', 'GAA', 100, 'XLM', 'XLM', 1001, null, 'tx-dup-1'); // id 1 (keep)
        insertPledge.run('c-dedup', 'GAA', 100, 'XLM', 'XLM', 1002, null, 'tx-dup-1'); // id 2 (drop)

        // Unique hash
        insertPledge.run('c-dedup', 'GBB', 50, 'XLM', 'XLM', 1003, null, 'tx-unique-1'); // id 3 (keep)

        // Multiple NULL hashes (must NOT be treated as duplicates of each other)
        insertPledge.run('c-dedup', 'GCC', 20, 'XLM', 'XLM', 1004, null, null); // id 4 (keep)
        insertPledge.run('c-dedup', 'GDD', 30, 'XLM', 'XLM', 1005, null, null); // id 5 (keep)

        // Run migration
        migrate(db);

        // Verify remaining pledges
        const remainingPledges = db
          .prepare('SELECT id, amount, transaction_hash FROM pledges ORDER BY id ASC')
          .all() as Array<{ id: number; amount: number; transaction_hash: string | null }>;

        expect(remainingPledges.map((p) => p.id)).toEqual([1, 3, 4, 5]);

        // Verify unique index was created successfully without error
        const uniqueIndex = db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index' AND name = 'idx_pledges_transaction_hash'`,
          )
          .get();
        expect(uniqueIndex).toBeDefined();

        // Verify campaign accounting recomputed: 100 (pledge 1) + 50 (pledge 3) + 20 (pledge 4) + 30 (pledge 5) = 200
        const campaign = db
          .prepare('SELECT pledged_amount FROM campaigns WHERE id = ?')
          .get('c-dedup') as { pledged_amount: number };
        expect(campaign.pledged_amount).toBe(200);
      } finally {
        db.close();
      }
    });

    it('correctly recomputes pledged_amount excluding refunded pledges and defaulting to 0', () => {
      const db = new Database(TEST_DB);
      try {
        db.exec(`
          CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            creator TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            accepted_tokens_json TEXT NOT NULL,
            target_amount REAL NOT NULL,
            pledged_amount REAL NOT NULL DEFAULT 0,
            deadline INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            claimed_at INTEGER,
            deleted_at INTEGER
          );
          CREATE TABLE pledges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL,
            contributor TEXT NOT NULL,
            amount REAL NOT NULL,
            asset_code TEXT NOT NULL,
            token_id TEXT,
            created_at INTEGER NOT NULL,
            refunded_at INTEGER,
            transaction_hash TEXT
          );
        `);

        // Campaign with mixed active and refunded pledges
        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('c-refund', 'GAA', 'Refund Campaign', 'Desc', '["XLM"]', 1000, 9999, 2000, 1000);

        // Campaign with zero pledges
        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('c-empty', 'GBB', 'Empty Campaign', 'Desc', '["XLM"]', 500, -50, 2000, 1000);

        const insertPledge = db.prepare(
          `INSERT INTO pledges (
            campaign_id, contributor, amount, asset_code, token_id, created_at, refunded_at, transaction_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        // Active pledges
        insertPledge.run('c-refund', 'GAA', 150.5, 'XLM', 'XLM', 1001, null, 'tx-active-1');
        insertPledge.run('c-refund', 'GBB', 49.5, 'XLM', 'XLM', 1002, null, 'tx-active-2');

        // Refunded pledge (must NOT be counted)
        insertPledge.run('c-refund', 'GCC', 200, 'XLM', 'XLM', 1003, 1050, 'tx-refunded-1');

        migrate(db);

        const refundCampaign = db
          .prepare('SELECT pledged_amount FROM campaigns WHERE id = ?')
          .get('c-refund') as { pledged_amount: number };
        expect(refundCampaign.pledged_amount).toBe(200); // 150.5 + 49.5

        const emptyCampaign = db
          .prepare('SELECT pledged_amount FROM campaigns WHERE id = ?')
          .get('c-empty') as { pledged_amount: number };
        expect(emptyCampaign.pledged_amount).toBe(0);
      } finally {
        db.close();
      }
    });

    it('backfills NULL token_id from asset_code while preserving explicit token_ids', () => {
      const db = new Database(TEST_DB);
      try {
        db.exec(`
          CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            creator TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            accepted_tokens_json TEXT NOT NULL,
            target_amount REAL NOT NULL,
            pledged_amount REAL NOT NULL DEFAULT 0,
            deadline INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            claimed_at INTEGER,
            deleted_at INTEGER
          );
          CREATE TABLE pledges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL,
            contributor TEXT NOT NULL,
            amount REAL NOT NULL,
            asset_code TEXT NOT NULL,
            token_id TEXT,
            created_at INTEGER NOT NULL,
            refunded_at INTEGER,
            transaction_hash TEXT
          );
        `);

        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('c-tokens', 'GAA', 'Tokens Campaign', 'Desc', '["XLM","USDC"]', 1000, 0, 2000, 1000);

        const insertPledge = db.prepare(
          `INSERT INTO pledges (
            campaign_id, contributor, amount, asset_code, token_id, created_at, transaction_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );

        // Pledge 1: NULL token_id with asset_code USDC
        insertPledge.run('c-tokens', 'GAA', 50, 'USDC', null, 1001, 'tx-t1');
        // Pledge 2: already has explicit canonical token_id
        insertPledge.run('c-tokens', 'GBB', 100, 'USDC', 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', 1002, 'tx-t2');

        migrate(db);

        const rows = db
          .prepare('SELECT id, asset_code, token_id FROM pledges ORDER BY id ASC')
          .all() as Array<{ id: number; asset_code: string; token_id: string }>;

        expect(rows[0].token_id).toBe('USDC');
        expect(rows[1].token_id).toBe(
          'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        );
      } finally {
        db.close();
      }
    });

    it('soft-cleans legacy negative pledged_amount to 0', () => {
      const db = new Database(TEST_DB);
      try {
        // Create unconstrained table simulating pre-#868 DB
        db.exec(`
          CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            creator TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            accepted_tokens_json TEXT NOT NULL,
            target_amount REAL NOT NULL,
            pledged_amount REAL NOT NULL,
            deadline INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            claimed_at INTEGER,
            deleted_at INTEGER
          );
        `);

        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run('c-corrupt', 'GAA', 'Corrupt Cached', 'Desc', '["XLM"]', 100, -999, 2000, 1000);

        migrate(db);

        const row = db
          .prepare('SELECT pledged_amount FROM campaigns WHERE id = ?')
          .get('c-corrupt') as { pledged_amount: number };
        expect(row.pledged_amount).toBe(0);

        // Confirm subsequent update to non-negative pledged_amount succeeds under integrity triggers
        expect(() => {
          db.prepare('UPDATE campaigns SET pledged_amount = 75 WHERE id = ?').run('c-corrupt');
        }).not.toThrow();

        // But attempting to set negative pledged_amount is rejected by trigger
        expect(() => {
          db.prepare('UPDATE campaigns SET pledged_amount = -1 WHERE id = ?').run('c-corrupt');
        }).toThrow(/campaigns\.pledged_amount must be >= 0/);
      } finally {
        db.close();
      }
    });

    it('is strictly idempotent across multiple consecutive migrate calls', () => {
      initDb(TEST_DB);
      const db = getDb();

      // Seed campaign and pledge
      db.prepare(
        `INSERT INTO campaigns (
          id, creator, title, description, accepted_tokens_json,
          target_amount, pledged_amount, deadline, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('c-idem', 'GAA', 'Idempotent Test', 'Desc', '["XLM"]', 100, 50, 2000, 1000);

      db.prepare(
        `INSERT INTO pledges (
          campaign_id, contributor, amount, asset_code, token_id, created_at, transaction_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('c-idem', 'GBB', 50, 'XLM', 'XLM', 1001, 'tx-idem-1');

      // Re-run migrate 3 additional times
      migrate(db);
      migrate(db);
      migrate(db);

      const campaignCount = (db.prepare('SELECT COUNT(*) AS c FROM campaigns').get() as { c: number }).c;
      const pledgeCount = (db.prepare('SELECT COUNT(*) AS c FROM pledges').get() as { c: number }).c;
      expect(campaignCount).toBe(1);
      expect(pledgeCount).toBe(1);

      const campaign = db
        .prepare('SELECT pledged_amount FROM campaigns WHERE id = ?')
        .get('c-idem') as { pledged_amount: number };
      expect(campaign.pledged_amount).toBe(50);
    });
  });
});
