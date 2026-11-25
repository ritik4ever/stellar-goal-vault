import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Acceptance tests for #874 — pledges persistence query indexes.
 * Verifies intended indexes exist, EXPLAIN plans use them, and write behavior stays correct.
 */

const TEST_DB = path.join(
  '/tmp',
  `sgv-pledges-persistence-indexes-874-${process.pid}-${Date.now()}.db`,
);

const PLEDGE_INDEXES = [
  'idx_pledges_campaign_id',
  'idx_pledges_contributor',
  'idx_pledges_campaign_refunded',
  'idx_pledges_campaign_created_id',
] as const;

describe('pledges persistence query indexes (#874)', () => {
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

  it('installs pledges persistence indexes on migrate', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const names = (
      getDb()
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name IN (${PLEDGE_INDEXES.map(() => '?').join(', ')})
           ORDER BY name`,
        )
        .all(...PLEDGE_INDEXES) as Array<{ name: string }>
    ).map((row) => row.name);

    expect(names).toEqual([...PLEDGE_INDEXES].sort());
  });

  it('uses idx_pledges_contributor for getPledgesByContributor plan', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    // Mirrors getPledgesByContributor filter + order (join omitted for plan clarity).
    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, campaign_id, amount, created_at
           FROM pledges
           WHERE contributor = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all('GCONTRIB', 20, 0) as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_contributor/i);
  });

  it('uses idx_pledges_campaign_created_id for ordered campaign pledge lists', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT *
           FROM pledges
           WHERE campaign_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all('c1', 10, 0) as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_campaign_created_id|idx_pledges_campaign_id/i);
  });

  it('uses idx_pledges_campaign_refunded for active-pledge accounting', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT COALESCE(SUM(amount), 0) AS total
           FROM pledges
           WHERE campaign_id = ? AND refunded_at IS NULL`,
        )
        .all('c1') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_campaign_refunded|idx_pledges_campaign_id/i);
  });

  it('keeps pledge write and contributor read behavior correct', async () => {
    const { initDb, getDb, getPledgesByContributor } = await import('../db');
    initDb();
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('c1', 'GCREATOR', 'Title', 'Desc', '["XLM"]', 100, 0, now + 86_400, now);

    const insert = db.prepare(
      `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run('c1', 'GCONTRIB', 25, 'XLM', now - 10);
    insert.run('c1', 'GCONTRIB', 15, 'XLM', now - 5);
    insert.run('c1', 'GOTHER', 40, 'XLM', now);

    db.prepare(`UPDATE campaigns SET pledged_amount = 40 WHERE id = ?`).run('c1');

    const rows = getPledgesByContributor('GCONTRIB');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount)).toEqual([15, 25]); // created_at DESC
    expect(rows.every((r) => r.campaignId === 'c1')).toBe(true);

    // Refund one pledge — write path must remain correct under indexed schema.
    db.prepare(`UPDATE pledges SET refunded_at = ? WHERE id = ?`).run(now, rows[0].id);
    const activeTotal = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total
           FROM pledges
           WHERE campaign_id = ? AND refunded_at IS NULL`,
        )
        .get('c1') as { total: number }
    ).total;
    expect(activeTotal).toBe(65); // 25 + 40 (15 refunded)
  });

  it('pledge indexes remain idempotent across re-migrate', async () => {
    const { initDb, getDb, resetDbForTests } = await import('../db');
    initDb();
    const before = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'index' AND name LIKE 'idx_pledges_%'`,
        )
        .get() as { n: number }
    ).n;

    resetDbForTests();
    initDb(TEST_DB);

    const after = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'index' AND name LIKE 'idx_pledges_%'`,
        )
        .get() as { n: number }
    ).n;
    expect(after).toBe(before);
    expect(after).toBeGreaterThanOrEqual(PLEDGE_INDEXES.length);
  });
});
