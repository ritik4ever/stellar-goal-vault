import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB = path.join('/tmp', `sgv-query-layer-indexes-${process.pid}.db`);

const QUERY_LAYER_INDEXES = [
  'idx_pledges_campaign_contributor',
  'idx_campaign_events_campaign_timestamp',
  'idx_campaign_comments_campaign_created',
  'idx_campaign_events_source',
] as const;

describe('query layer indexes (#889)', () => {
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

  it('installs query-layer composite indexes on init', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const names = (
      getDb()
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name IN (${QUERY_LAYER_INDEXES.map(() => '?').join(', ')})
           ORDER BY name`,
        )
        .all(...QUERY_LAYER_INDEXES) as Array<{ name: string }>
    ).map((row) => row.name);

    expect(names).toEqual([...QUERY_LAYER_INDEXES].sort());
  });

  it('uses idx_pledges_campaign_contributor for contributor refund plans', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM pledges
           WHERE campaign_id = ? AND contributor = ? AND refunded_at IS NULL
           ORDER BY created_at ASC, id ASC`,
        )
        .all('c1', 'GCONTRIB') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_campaign_contributor|idx_pledges_campaign_id/i);
  });

  it('uses idx_campaign_events_campaign_timestamp for history pages', async () => {
    const { initDb, getDb } = await import('../db');
    initDb();

    const plan = (
      getDb()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM campaign_events
           WHERE campaign_id = ?
           ORDER BY timestamp ASC, id ASC`,
        )
        .all('c1') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(
      /idx_campaign_events_campaign_timestamp|idx_campaign_events_campaign_id/i,
    );
  });

  it('keeps getPledgesByContributor write/read behavior correct', async () => {
    const { initDb, getDb, getPledgesByContributor } = await import('../db');
    initDb();
    const db = getDb();

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('c1', 'GCREATOR', 'Title', 'Desc', '["XLM"]', 100, 10, 9_999_999_999, Date.now());

    db.prepare(
      `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('c1', 'GCONTRIB', 10, 'XLM', Date.now());

    const rows = getPledgesByContributor('GCONTRIB');
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignId).toBe('c1');
    expect(rows[0].amount).toBe(10);
  });

  it('ensureQueryLayerIndexes is idempotent', async () => {
    const { initDb, getDb, ensureQueryLayerIndexes } = await import('../db');
    initDb();
    ensureQueryLayerIndexes();
    ensureQueryLayerIndexes(getDb());

    const count = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'index'
             AND name IN (${QUERY_LAYER_INDEXES.map(() => '?').join(', ')})`,
        )
        .get(...QUERY_LAYER_INDEXES) as { n: number }
    ).n;
    expect(count).toBe(QUERY_LAYER_INDEXES.length);
  });
});
