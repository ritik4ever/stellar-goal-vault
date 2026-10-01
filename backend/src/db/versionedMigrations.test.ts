import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPendingMigrations,
  getAppliedMigrations,
  getSchemaVersion,
  LEGACY_BASELINE_VERSION,
  loadMigrations,
  migrate,
  rollbackMigrations,
  type SQLiteDatabase,
} from './index';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

interface SchemaSnapshot {
  tables: Record<string, string[]>;
  indexes: string[];
  triggers: string[];
}

function openDb(): SQLiteDatabase {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

/** Names of application tables, columns, indexes, and triggers. */
function snapshotSchema(db: SQLiteDatabase): SchemaSnapshot {
  const objects = db
    .prepare(
      `SELECT type, name FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'campaigns_fts_%'
         AND name <> 'schema_migrations'
       ORDER BY name`,
    )
    .all() as Array<{ type: string; name: string }>;

  const tables: Record<string, string[]> = {};
  for (const { name } of objects.filter((o) => o.type === 'table')) {
    tables[name] = (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>)
      .map((column) => column.name)
      .sort();
  }

  return {
    tables,
    indexes: objects.filter((o) => o.type === 'index').map((o) => o.name),
    triggers: objects.filter((o) => o.type === 'trigger').map((o) => o.name),
  };
}

function writeMigration(dir: string, file: string, sql: string): void {
  fs.writeFileSync(path.join(dir, file), sql);
}

describe('Versioned SQL migrations', () => {
  let db: SQLiteDatabase;
  let tmpDir: string;

  beforeEach(() => {
    db = openDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgv-migrations-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('migration files', () => {
    it('are named NNN_name.sql, contiguous from 001, each with a rollback script', () => {
      const migrations = loadMigrations(MIGRATIONS_DIR);

      expect(migrations.map((m) => `${String(m.version).padStart(3, '0')}_${m.name}`)).toEqual([
        '001_initial',
        '002_add_accepted_tokens',
        '003_add_notifications',
        '004_add_query_plan_indexes',
        '005_add_pledges_integrity_constraints',
      ]);
      for (const migration of migrations) {
        expect(migration.up.trim()).not.toBe('');
        expect(migration.down.trim()).not.toBe('');
        expect(
          fs.existsSync(
            path.join(
              MIGRATIONS_DIR,
              `${String(migration.version).padStart(3, '0')}_${migration.name}.down.sql`,
            ),
          ),
        ).toBe(true);
      }
      expect(LEGACY_BASELINE_VERSION).toBeLessThanOrEqual(migrations.length);
    });

    it('rejects a migration without a rollback script', () => {
      writeMigration(tmpDir, '001_first.sql', 'CREATE TABLE a (id INTEGER);');
      expect(() => loadMigrations(tmpDir)).toThrow(/missing its rollback/);
    });

    it('rejects gaps in the version sequence', () => {
      writeMigration(tmpDir, '001_first.sql', 'CREATE TABLE a (id INTEGER);');
      writeMigration(tmpDir, '001_first.down.sql', 'DROP TABLE a;');
      writeMigration(tmpDir, '003_third.sql', 'CREATE TABLE c (id INTEGER);');
      writeMigration(tmpDir, '003_third.down.sql', 'DROP TABLE c;');
      expect(() => loadMigrations(tmpDir)).toThrow(/contiguous/);
    });

    it('rejects duplicate versions', () => {
      writeMigration(tmpDir, '001_first.sql', 'CREATE TABLE a (id INTEGER);');
      writeMigration(tmpDir, '001_other.sql', 'CREATE TABLE b (id INTEGER);');
      expect(() => loadMigrations(tmpDir)).toThrow(/Duplicate migration version 1/);
    });
  });

  describe('runner', () => {
    it('executes pending migrations in version order regardless of directory order', () => {
      // 002 depends on the table created by 001; written first on purpose.
      writeMigration(tmpDir, '002_add_col.sql', 'ALTER TABLE items ADD COLUMN label TEXT;');
      writeMigration(tmpDir, '002_add_col.down.sql', 'ALTER TABLE items DROP COLUMN label;');
      writeMigration(tmpDir, '001_create.sql', 'CREATE TABLE items (id INTEGER PRIMARY KEY);');
      writeMigration(tmpDir, '001_create.down.sql', 'DROP TABLE items;');

      const applied = applyPendingMigrations(db, loadMigrations(tmpDir));

      expect(applied).toEqual([1, 2]);
      expect(getAppliedMigrations(db).map((m) => [m.version, m.name])).toEqual([
        [1, 'create'],
        [2, 'add_col'],
      ]);
      expect(snapshotSchema(db).tables.items).toEqual(['id', 'label']);
    });

    it('skips already-applied migrations', () => {
      writeMigration(tmpDir, '001_create.sql', 'CREATE TABLE items (id INTEGER PRIMARY KEY);');
      writeMigration(tmpDir, '001_create.down.sql', 'DROP TABLE items;');

      expect(applyPendingMigrations(db, loadMigrations(tmpDir))).toEqual([1]);
      const firstRun = getAppliedMigrations(db);

      // Re-running would fail with "table items already exists" if not skipped.
      expect(applyPendingMigrations(db, loadMigrations(tmpDir))).toEqual([]);
      expect(getAppliedMigrations(db)).toEqual(firstRun);

      writeMigration(tmpDir, '002_more.sql', 'CREATE TABLE more (id INTEGER);');
      writeMigration(tmpDir, '002_more.down.sql', 'DROP TABLE more;');
      expect(applyPendingMigrations(db, loadMigrations(tmpDir))).toEqual([2]);
    });

    it('rolls back a failing migration and does not record it', () => {
      writeMigration(tmpDir, '001_create.sql', 'CREATE TABLE items (id INTEGER PRIMARY KEY);');
      writeMigration(tmpDir, '001_create.down.sql', 'DROP TABLE items;');
      writeMigration(
        tmpDir,
        '002_broken.sql',
        'CREATE TABLE partial (id INTEGER); SELECT * FROM does_not_exist;',
      );
      writeMigration(tmpDir, '002_broken.down.sql', 'DROP TABLE partial;');

      expect(() => applyPendingMigrations(db, loadMigrations(tmpDir))).toThrow(
        /Migration 2_broken failed: no such table: does_not_exist/,
      );
      expect(getSchemaVersion(db)).toBe(1);
      expect(Object.keys(snapshotSchema(db).tables)).toEqual(['items']);
    });

    it('refuses to run when an applied migration has been edited', () => {
      writeMigration(tmpDir, '001_create.sql', 'CREATE TABLE items (id INTEGER PRIMARY KEY);');
      writeMigration(tmpDir, '001_create.down.sql', 'DROP TABLE items;');
      applyPendingMigrations(db, loadMigrations(tmpDir));

      writeMigration(tmpDir, '001_create.sql', 'CREATE TABLE items (id TEXT PRIMARY KEY);');
      expect(() => applyPendingMigrations(db, loadMigrations(tmpDir))).toThrow(
        /modified after being applied/,
      );
    });

    it('treats CRLF and LF checkouts of the same migration as identical', () => {
      writeMigration(tmpDir, '001_create.sql', 'CREATE TABLE items (id INTEGER);\n');
      writeMigration(tmpDir, '001_create.down.sql', 'DROP TABLE items;');
      applyPendingMigrations(db, loadMigrations(tmpDir));

      writeMigration(tmpDir, '001_create.sql', 'CREATE TABLE items (id INTEGER);\r\n');
      expect(() => applyPendingMigrations(db, loadMigrations(tmpDir))).not.toThrow();
    });
  });

  describe('schema', () => {
    it('is correct after a fresh init', () => {
      migrate(db);

      expect(getSchemaVersion(db)).toBe(5);

      const schema = snapshotSchema(db);
      expect(Object.keys(schema.tables).sort()).toEqual([
        'campaign_comments',
        'campaign_events',
        'campaigns',
        'campaigns_fts',
        'notifications',
        'pledges',
        'webhook_dead_letter_queue',
      ]);
      expect(schema.tables.campaigns).toEqual(
        [
          'accepted_tokens_json',
          'claimed_at',
          'created_at',
          'creator',
          'deadline',
          'deleted_at',
          'description',
          'failed_at',
          'id',
          'max_per_contributor',
          'metadata_json',
          'pledged_amount',
          'target_amount',
          'title',
        ].sort(),
      );
      expect(schema.tables.pledges).toEqual(
        [
          'amount',
          'asset_code',
          'campaign_id',
          'contributor',
          'created_at',
          'id',
          'refunded_at',
          'token_id',
          'transaction_hash',
        ].sort(),
      );
      expect(schema.triggers).toEqual([
        'after_campaigns_delete',
        'after_campaigns_insert',
        'after_campaigns_update',
        'campaigns_persistence_integrity_insert',
        'campaigns_persistence_integrity_update',
        'pledges_persistence_integrity_insert',
        'pledges_persistence_integrity_update',
      ]);
      expect(schema.indexes).toEqual(
        expect.arrayContaining([
          'idx_campaigns_status',
          'idx_pledges_transaction_hash',
          'idx_pledges_contributor',
          'idx_notifications_target_wallet',
          'idx_campaign_events_campaign_timestamp',
        ]),
      );
    });

    it('is identical after incremental migration from an older version', () => {
      const fresh = openDb();
      try {
        migrate(fresh);
        const expected = snapshotSchema(fresh);

        // A database last migrated at 001, with data written at that version.
        const migrations = loadMigrations(MIGRATIONS_DIR);
        applyPendingMigrations(db, migrations.slice(0, 1));
        db.prepare(
          `INSERT INTO campaigns (id, creator, title, description, target_amount, deadline, created_at)
           VALUES ('c-v1', 'GCREATOR', 'Old campaign', 'Created at schema v1', 100, 2000, 1000)`,
        ).run();
        db.prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
           VALUES ('c-v1', 'GCONTRIB', 40, 'XLM', 1001)`,
        ).run();
        expect(getSchemaVersion(db)).toBe(1);

        migrate(db);

        expect(getAppliedMigrations(db).map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
        expect(snapshotSchema(db)).toEqual(expected);

        const campaign = db
          .prepare(`SELECT accepted_tokens_json, pledged_amount FROM campaigns WHERE id = 'c-v1'`)
          .get() as { accepted_tokens_json: string; pledged_amount: number };
        expect(campaign.accepted_tokens_json).toBe('["XLM"]');
        expect(campaign.pledged_amount).toBe(40);

        const pledge = db.prepare(`SELECT token_id FROM pledges`).get() as { token_id: string };
        expect(pledge.token_id).toBe('XLM');
      } finally {
        fresh.close();
      }
    });

    it('re-running migrate on an up-to-date database applies nothing', () => {
      migrate(db);
      const before = getAppliedMigrations(db);
      const schema = snapshotSchema(db);

      migrate(db);
      migrate(db);

      expect(getAppliedMigrations(db)).toEqual(before);
      expect(snapshotSchema(db)).toEqual(schema);
    });
  });

  describe('rollback scripts', () => {
    it('each rollback restores the schema of the previous version', () => {
      const migrations = loadMigrations(MIGRATIONS_DIR);

      // Schema snapshot after each version, built forward.
      const snapshots: SchemaSnapshot[] = [snapshotSchema(db)];
      for (let version = 1; version <= migrations.length; version += 1) {
        applyPendingMigrations(db, migrations.slice(0, version));
        snapshots.push(snapshotSchema(db));
      }

      for (let version = migrations.length - 1; version >= 0; version -= 1) {
        expect(rollbackMigrations(db, version, migrations)).toEqual([version + 1]);
        expect(getSchemaVersion(db)).toBe(version);
        expect(snapshotSchema(db)).toEqual(snapshots[version]);
      }

      expect(snapshotSchema(db).tables).toEqual({});
    });

    it('supports rolling back and re-applying the full chain', () => {
      migrate(db);
      const expected = snapshotSchema(db);

      expect(rollbackMigrations(db, 0)).toEqual([5, 4, 3, 2, 1]);
      expect(getAppliedMigrations(db)).toEqual([]);

      migrate(db);
      expect(snapshotSchema(db)).toEqual(expected);
    });

    it('rolls back to a target version, leaving older migrations applied', () => {
      migrate(db);

      expect(rollbackMigrations(db, 2)).toEqual([5, 4, 3]);
      expect(getAppliedMigrations(db).map((m) => m.version)).toEqual([1, 2]);
      expect(snapshotSchema(db).tables.notifications).toBeUndefined();
      expect(snapshotSchema(db).tables.campaigns).toContain('accepted_tokens_json');
    });
  });

  describe('databases created before versioned migrations', () => {
    it('are adopted at the baseline version with the same schema as a fresh database', () => {
      const fresh = openDb();
      try {
        migrate(fresh);
        const expected = snapshotSchema(fresh);

        // Old snapshot: no history table, several columns and tables missing.
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
          INSERT INTO campaigns (id, creator, title, description, accepted_tokens_json,
                                 target_amount, deadline, created_at)
          VALUES ('c-old', 'GCREATOR', 'Old', 'Pre-runner campaign', '["XLM"]', 100, 2000, 1000);
        `);

        migrate(db);

        expect(getAppliedMigrations(db).map((m) => m.version)).toEqual(
          [...Array.from({ length: LEGACY_BASELINE_VERSION }, (_, i) => i + 1), 5],
        );
        expect(snapshotSchema(db)).toEqual(expected);

        // Pre-existing campaigns become searchable.
        const fts = db.prepare(`SELECT id FROM campaigns_fts WHERE id = 'c-old'`).get();
        expect(fts).toBeDefined();
      } finally {
        fresh.close();
      }
    });

    it('carries single-asset campaigns over to accepted_tokens_json', () => {
      db.exec(`
        CREATE TABLE campaigns (
          id TEXT PRIMARY KEY,
          creator TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          asset_code TEXT NOT NULL,
          target_amount REAL NOT NULL,
          pledged_amount REAL NOT NULL DEFAULT 0,
          deadline INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        INSERT INTO campaigns (id, creator, title, description, asset_code,
                               target_amount, deadline, created_at)
        VALUES ('c-usdc', 'GCREATOR', 'USDC only', 'Single asset campaign', 'USDC', 100, 2000, 1000);
      `);

      migrate(db);

      const row = db
        .prepare(`SELECT accepted_tokens_json FROM campaigns WHERE id = 'c-usdc'`)
        .get() as { accepted_tokens_json: string };
      expect(JSON.parse(row.accepted_tokens_json)).toEqual(['USDC']);
    });

    it('does not re-run the baseline once adopted', () => {
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
          created_at INTEGER NOT NULL
        );
      `);
      migrate(db);
      const adopted = getAppliedMigrations(db);

      migrate(db);
      expect(getAppliedMigrations(db)).toEqual(adopted);
    });
  });
});
