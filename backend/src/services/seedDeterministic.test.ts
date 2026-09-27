import fs from 'fs';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-seed-regression-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;

type DbModule = typeof import('./db');
type SeedModule = typeof import('./seedDeterministic');

let getDb: DbModule['getDb'];
let resetDbForTests: DbModule['resetDbForTests'];
let seedDeterministicState: SeedModule['seedDeterministicState'];
let parseCountArg: SeedModule['parseCountArg'];

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  fs.rmSync(`${TEST_DB_PATH}-wal`, { force: true });
  fs.rmSync(`${TEST_DB_PATH}-shm`, { force: true });
  ({ getDb, resetDbForTests } = await import('./db'));
  ({ seedDeterministicState, parseCountArg } = await import('./seedDeterministic'));
});

beforeEach(() => {
  seedDeterministicState();
});

afterEach(() => {
  // Keep the module singleton pointed at the same isolated file between cases.
});

describe('deterministic seed state', () => {
  it('produces stable campaign and pledge rows across repeated runs', () => {
    const db = getDb();
    const firstCampaigns = db
      .prepare(
        `SELECT id, creator, target_amount, pledged_amount, deadline, created_at, claimed_at
         FROM campaigns ORDER BY id ASC`,
      )
      .all();
    const firstPledges = db
      .prepare(`SELECT campaign_id, contributor, amount, created_at FROM pledges ORDER BY id ASC`)
      .all();

    seedDeterministicState();
    const secondCampaigns = db
      .prepare(
        `SELECT id, creator, target_amount, pledged_amount, deadline, created_at, claimed_at
         FROM campaigns ORDER BY id ASC`,
      )
      .all();
    const secondPledges = db
      .prepare(`SELECT campaign_id, contributor, amount, created_at FROM pledges ORDER BY id ASC`)
      .all();

    expect(secondCampaigns).toEqual(firstCampaigns);
    expect(secondPledges).toEqual(firstPledges);
  });
});

describe('seed workflow database regression', () => {
  it('returns campaign ids in insertion order', () => {
    const ids = seedDeterministicState(5);
    expect(ids).toEqual(['1', '2', '3', '4', '5']);

    const db = getDb();
    const rows = db.prepare(`SELECT id FROM campaigns ORDER BY CAST(id AS INTEGER) ASC`).all() as Array<{
      id: string;
    }>;
    expect(rows.map((r) => r.id)).toEqual(ids);
  });

  it('enforces pledge foreign-key constraint (failure mode missed by happy-path API tests)', () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at, refunded_at, transaction_hash)
           VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .run('missing-campaign', `G${'Z'.repeat(55)}`, 10, 'USDC', 1_750_000_000),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('rejects duplicate campaign primary keys after seed', () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json, target_amount, pledged_amount, deadline, created_at, claimed_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run('1', `G${'A'.repeat(55)}`, 'dup', 'dup', '["USDC"]', 1, 0, 1_750_000_000, 1_750_000_000, null),
    ).toThrow(/UNIQUE|constraint/i);
  });

  it('rolls back partial seed writes when the transaction body throws', () => {
    const db = getDb();
    const beforeCampaigns = (
      db.prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as { n: number }
    ).n;
    const beforePledges = (db.prepare(`SELECT COUNT(*) AS n FROM pledges`).get() as { n: number }).n;

    expect(() =>
      db.transaction(() => {
        db.prepare(`DELETE FROM campaign_events`).run();
        db.prepare(`DELETE FROM pledges`).run();
        db.prepare(`DELETE FROM campaigns`).run();
        db.prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json, target_amount, pledged_amount, deadline, created_at, claimed_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        ).run(
          'rollback-temp',
          `G${'R'.repeat(55)}`,
          'temp',
          'temp',
          '["USDC"]',
          10,
          0,
          1_750_000_000,
          1_750_000_000,
          null,
        );
        throw new Error('forced seed abort');
      })(),
    ).toThrow(/forced seed abort/);

    const afterCampaigns = (
      db.prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as { n: number }
    ).n;
    const afterPledges = (db.prepare(`SELECT COUNT(*) AS n FROM pledges`).get() as { n: number }).n;
    expect(afterCampaigns).toBe(beforeCampaigns);
    expect(afterPledges).toBe(beforePledges);
    expect(
      db.prepare(`SELECT id FROM campaigns WHERE id = ?`).get('rollback-temp'),
    ).toBeUndefined();
  });

  it('clears dependent rows and FTS so reseed is not blocked by FK children', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO notifications (campaign_id, type, title, body, target_wallet, actor_wallet, is_read, created_at)
       VALUES (?, 'new_pledge', 't', 'b', ?, NULL, 0, ?)`,
    ).run('1', `G${'N'.repeat(55)}`, 1_750_000_000);
    db.prepare(
      `INSERT INTO campaign_comments (campaign_id, author, content, created_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run('1', `G${'M'.repeat(55)}`, 'stale comment', 1_750_000_000);
    db.prepare(
      `INSERT INTO campaign_events (campaign_id, event_type, timestamp, actor, amount, metadata, blockchain_metadata)
       VALUES (?, 'pledge', ?, NULL, 1, NULL, NULL)`,
    ).run('1', 1_750_000_000);

    // Without child cleanup this reseed would fail under foreign_keys=ON.
    const ids = seedDeterministicState(3);
    expect(ids).toEqual(['1', '2', '3']);

    expect((db.prepare(`SELECT COUNT(*) AS n FROM notifications`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM campaign_comments`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM campaign_events`).get() as { n: number }).n).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM campaigns_fts`).get() as { n: number }).n).toBe(3);

    const fts = db
      .prepare(`SELECT id, title FROM campaigns_fts WHERE id = '1'`)
      .get() as { id: string; title: string };
    expect(fts.title).toBe('Open deterministic campaign');
  });

  it('keeps pledged_amount accounting aligned with non-refunded pledges after seed', () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.id, c.pledged_amount AS pledged,
                COALESCE((SELECT SUM(p.amount) FROM pledges p
                          WHERE p.campaign_id = c.id AND p.refunded_at IS NULL), 0) AS sum_pledges
         FROM campaigns c
         ORDER BY CAST(c.id AS INTEGER) ASC`,
      )
      .all() as Array<{ id: string; pledged: number; sum_pledges: number }>;

    for (const row of rows) {
      expect(row.pledged).toBe(row.sum_pledges);
    }
  });

  it('handles edge-case counts and parseCountArg validation', () => {
    expect(seedDeterministicState(1)).toEqual(['1']);
    expect((getDb().prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as { n: number }).n).toBe(1);
    expect((getDb().prepare(`SELECT COUNT(*) AS n FROM pledges`).get() as { n: number }).n).toBe(1);

    expect(seedDeterministicState(7)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(() => seedDeterministicState(0)).toThrow(/positive integer/i);

    expect(parseCountArg([])).toBe(3);
    expect(parseCountArg(['--count', '4'])).toBe(4);
    expect(parseCountArg(['--count=12'])).toBe(12);
    expect(() => parseCountArg(['--count', '0'])).toThrow(/Invalid --count/);
    expect(() => parseCountArg(['--count', 'nope'])).toThrow(/Invalid --count/);
  });

  it('leaves no orphan pledges after seeding extras', () => {
    seedDeterministicState(9);
    const orphans = getDb()
      .prepare(
        `SELECT p.campaign_id FROM pledges p
         LEFT JOIN campaigns c ON c.id = p.campaign_id
         WHERE c.id IS NULL`,
      )
      .all();
    expect(orphans).toEqual([]);
  });
});

describe('seed workflow query indexes', () => {
  it('installs indexes used by wipe FK checks and accounting queries', () => {
    const db = getDb();
    const names = (
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name IN (
               'idx_notifications_campaign_id',
               'idx_pledges_campaign_refunded',
               'idx_pledges_campaign_created_id',
               'idx_campaigns_created_at'
             )
           ORDER BY name`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(names).toEqual([
      'idx_campaigns_created_at',
      'idx_notifications_campaign_id',
      'idx_pledges_campaign_created_id',
      'idx_pledges_campaign_refunded',
    ]);
  });

  it('uses idx_pledges_campaign_refunded for active pledge accounting plans', () => {
    const db = getDb();
    const plan = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT COALESCE(SUM(amount), 0) AS total
           FROM pledges
           WHERE campaign_id = ? AND refunded_at IS NULL`,
        )
        .all('1') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_pledges_campaign_refunded|idx_pledges_campaign_id/i);
  });

  it('uses idx_notifications_campaign_id for campaign-scoped notification lookups', () => {
    const db = getDb();
    const plan = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id FROM notifications WHERE campaign_id = ?`,
        )
        .all('1') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join(' | ');

    expect(plan).toMatch(/idx_notifications_campaign_id/i);
  });

  it('keeps write behavior correct after indexed reseed', () => {
    const ids = seedDeterministicState(4);
    expect(ids).toEqual(['1', '2', '3', '4']);

    const db = getDb();
    const accounting = db
      .prepare(
        `SELECT c.id,
                c.pledged_amount AS pledged,
                COALESCE((
                  SELECT SUM(p.amount) FROM pledges p
                  WHERE p.campaign_id = c.id AND p.refunded_at IS NULL
                ), 0) AS sum_pledges
         FROM campaigns c
         ORDER BY CAST(c.id AS INTEGER) ASC`,
      )
      .all() as Array<{ id: string; pledged: number; sum_pledges: number }>;

    for (const row of accounting) {
      expect(row.pledged).toBe(row.sum_pledges);
    }
  });
});
