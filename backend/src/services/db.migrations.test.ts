import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb, resetDbForTests } from './db';

const TEST_DB = path.join('/tmp', `sgv-migration-transactions-${process.pid}.db`);

function removeTestDatabase(): void {
  fs.rmSync(TEST_DB, { force: true });
  fs.rmSync(`${TEST_DB}-wal`, { force: true });
  fs.rmSync(`${TEST_DB}-shm`, { force: true });
}

describe('Migration transactions (#880)', () => {
  beforeEach(() => {
    resetDbForTests();
    removeTestDatabase();
  });

  afterEach(() => {
    resetDbForTests();
    removeTestDatabase();
  });

  it('rolls back partial migration state and allows a clean retry', () => {
    initDb(TEST_DB);
    const database = getDb();

    database
      .prepare(
        `INSERT INTO campaigns (
          id, creator, title, description, accepted_tokens_json,
          target_amount, pledged_amount, deadline, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'migration-test',
        'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
        'Migration Test',
        'A campaign used to verify migration rollback.',
        '["XLM"]',
        100,
        0,
        1_800_000_000,
        1_700_000_000,
      );
    database
      .prepare(
        `INSERT INTO pledges (
          campaign_id, contributor, amount, asset_code, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'migration-test',
        'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
        25,
        'XLM',
        1_700_000_000,
      );
    database
      .prepare(`UPDATE campaigns SET pledged_amount = 999 WHERE id = ?`)
      .run('migration-test');
    database.exec(`
      DROP INDEX idx_campaigns_status;
      CREATE TRIGGER fail_migration_recompute
      BEFORE UPDATE OF pledged_amount ON campaigns
      BEGIN
        SELECT RAISE(ABORT, 'injected migration failure');
      END;
    `);
    resetDbForTests();

    expect(() => initDb(TEST_DB)).toThrow('injected migration failure');

    const persistedDatabase = new Database(TEST_DB);
    try {
      const campaign = persistedDatabase
        .prepare(`SELECT pledged_amount FROM campaigns WHERE id = ?`)
        .get('migration-test') as { pledged_amount: number };
      const recreatedIndex = persistedDatabase
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_campaigns_status'`,
        )
        .get();

      expect(campaign.pledged_amount).toBe(999);
      expect(recreatedIndex).toBeUndefined();
    } finally {
      persistedDatabase.exec(`DROP TRIGGER IF EXISTS fail_migration_recompute`);
      persistedDatabase.close();
    }

    expect(() => initDb(TEST_DB)).not.toThrow();

    const migratedDatabase = getDb();
    const campaign = migratedDatabase
      .prepare(`SELECT pledged_amount FROM campaigns WHERE id = ?`)
      .get('migration-test') as { pledged_amount: number };
    const recreatedIndex = migratedDatabase
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_campaigns_status'`,
      )
      .get();

    expect(campaign.pledged_amount).toBe(25);
    expect(recreatedIndex).toBeDefined();
  });
});
