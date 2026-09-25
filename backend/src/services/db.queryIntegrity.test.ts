import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB = path.join('/tmp', `sgv-query-integrity-${process.pid}.db`);

describe('Query-layer integrity constraints (#888)', () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB;
  });

  afterEach(async () => {
    const { resetDbForTests } = await import('./db');
    resetDbForTests();
    const fs = await import('fs');
    fs.rmSync(TEST_DB, { force: true });
    fs.rmSync(`${TEST_DB}-wal`, { force: true });
    fs.rmSync(`${TEST_DB}-shm`, { force: true });
  });

  async function boot() {
    const mod = await import('./db');
    // Force a fresh module singleton for each test file run path.
    mod.resetDbForTests();
    mod.initDb(TEST_DB);
    return mod;
  }

  it('installs query integrity triggers on init', async () => {
    const { getDb } = await boot();
    const triggers = getDb()
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%query_integrity%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    expect(triggers.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'campaigns_query_integrity_insert',
        'campaigns_query_integrity_update',
        'pledges_query_integrity_insert',
        'pledges_query_integrity_update',
        'campaign_events_query_integrity_insert',
        'campaign_comments_query_integrity_insert',
      ]),
    );
  });

  it('rejects invalid campaign rows while accepting valid ones', async () => {
    const { getDb } = await boot();
    const db = getDb();

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '1',
      'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
      'Valid Title Here',
      'A valid description that is long enough for the campaign.',
      '["XLM"]',
      100,
      0,
      1_800_000_000,
      1_700_000_000,
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          '2',
          'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
          'Bad Target',
          'A valid description that is long enough for the campaign.',
          '["XLM"]',
          0,
          0,
          1_800_000_000,
          1_700_000_000,
        ),
    ).toThrow(/target_amount/);

    expect(() =>
      db
        .prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at, claimed_at, failed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          '3',
          'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
          'Both Terminal',
          'A valid description that is long enough for the campaign.',
          '["XLM"]',
          50,
          0,
          1_800_000_000,
          1_700_000_000,
          1_700_000_100,
          1_700_000_200,
        ),
    ).toThrow(/claimed and failed/);
  });

  it('rejects non-positive pledges and empty contributors', async () => {
    const { getDb } = await boot();
    const db = getDb();

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '10',
      'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
      'Pledge Host',
      'A valid description that is long enough for the campaign.',
      '["XLM"]',
      100,
      0,
      1_800_000_000,
      1_700_000_000,
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('10', 'GCONTRIBUTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 0, 'XLM', 1_700_000_010),
    ).toThrow(/amount/);

    expect(() =>
      db
        .prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('10', '   ', 5, 'XLM', 1_700_000_010),
    ).toThrow(/contributor/);

    db.prepare(
      `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      '10',
      'GCONTRIBUTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      25,
      'XLM',
      1_700_000_010,
    );
  });

  it('normalizes query pagination and validates contributor input', async () => {
    const { getPledgesByContributor, normalizeQueryPagination, getDb } = await boot();
    const db = getDb();

    expect(normalizeQueryPagination(0, -5)).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(normalizeQueryPagination(2, 500).limit).toBe(100);
    expect(normalizeQueryPagination(3, 10)).toEqual({ page: 3, limit: 10, offset: 20 });

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '20',
      'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
      'Query Host',
      'A valid description that is long enough for the campaign.',
      '["XLM"]',
      100,
      25,
      1_800_000_000,
      1_700_000_000,
    );
    db.prepare(
      `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      '20',
      'GCONTRIBUTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      25,
      'XLM',
      1_700_000_010,
    );

    const rows = getPledgesByContributor(
      'GCONTRIBUTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      1,
      10,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(25);
    expect(rows[0].status).toBe('active');

    expect(() => getPledgesByContributor('   ')).toThrow(/contributor/);
  });

  it('re-runs migrate idempotently without breaking valid data', async () => {
    const mod = await boot();
    const db = mod.getDb();

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '30',
      'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
      'Idempotent Host',
      'A valid description that is long enough for the campaign.',
      '["XLM"]',
      100,
      0,
      1_800_000_000,
      1_700_000_000,
    );

    // Second init on same connection path should no-op (singleton), so close and reopen.
    mod.resetDbForTests();
    mod.initDb(TEST_DB);

    const count = mod
      .getDb()
      .prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE id = '30'`)
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});
