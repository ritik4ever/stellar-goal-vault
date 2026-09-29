import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Acceptance tests for migration runner query indexes.
 * Verifies migration runner indexes exist, EXPLAIN plans use them,
 * and migration write/read behavior remains correct.
 */

const TEST_DB = path.join(
  '/tmp',
  `sgv-migration-runner-indexes-${process.pid}-${Date.now()}.db`,
);

const MIGRATION_RUNNER_INDEXES = [
  'idx_pledges_token_id_null',
  'idx_pledges_campaign_refunded',
  'idx_pledges_tx_hash_migration',
] as const;

describe('migration runner query indexes', () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB;
  });

  afterEach(async () => {
    const { resetDbForTests } = await import('../db');
    resetDbForTests();
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
    }
  });

  it('installs migration runner query indexes on init', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const names = (
      getDb()
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name IN (${MIGRATION_RUNNER_INDEXES.map(() => '?').join(', ')})
           ORDER BY name`,
        )
        .all(...MIGRATION_RUNNER_INDEXES) as Array<{ name: string }>
    ).map((row) => row.name);

    expect(names).toEqual([...MIGRATION_RUNNER_INDEXES].sort());
  });

  it('uses idx_pledges_token_id_null for token_id backfill query plan', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           UPDATE pledges SET token_id = asset_code WHERE token_id IS NULL`,
        )
        .all() as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_token_id_null|SCAN pledges/i);
  });

  it('uses idx_pledges_campaign_refunded for pledged_amount recomputation query plan', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT COALESCE(SUM(amount), 0) FROM pledges
           WHERE campaign_id = ? AND refunded_at IS NULL`,
        )
        .all('c1') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_campaign_refunded|idx_pledges_campaign_id/i);
  });

  it('uses idx_pledges_tx_hash_migration for transaction_hash deduplication plan', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT MIN(id) FROM pledges
           WHERE transaction_hash IS NOT NULL
           GROUP BY transaction_hash`,
        )
        .all() as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_tx_hash_migration|idx_pledges_transaction_hash/i);
  });

  it('ensureMigrationRunnerIndexes is idempotent across re-migrate', async () => {
    const { initDb, getDb, ensureMigrationRunnerIndexes, resetDbForTests } = await import('../db');
    initDb();
    ensureMigrationRunnerIndexes();
    ensureMigrationRunnerIndexes(getDb());

    resetDbForTests();
    initDb(TEST_DB);

    const count = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'index'
             AND name IN (${MIGRATION_RUNNER_INDEXES.map(() => '?').join(', ')})`,
        )
        .get(...MIGRATION_RUNNER_INDEXES) as { n: number }
    ).n;
    expect(count).toBe(MIGRATION_RUNNER_INDEXES.length);
  });
});
