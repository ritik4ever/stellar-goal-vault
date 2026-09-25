import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB = path.join('/tmp', `sgv-campaigns-integrity-${process.pid}.db`);

describe('Campaigns persistence integrity constraints (#868)', () => {
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
    mod.resetDbForTests();
    mod.initDb(TEST_DB);
    return mod;
  }

  const validCampaign = {
    id: '1',
    creator: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
    title: 'Valid Title Here',
    description: 'A valid description that is long enough for the campaign.',
    accepted_tokens_json: '["XLM"]',
    target_amount: 100,
    pledged_amount: 0,
    deadline: 1_800_000_000,
    created_at: 1_700_000_000,
  };

  it('installs campaigns persistence integrity triggers on init', async () => {
    const { getDb } = await boot();
    const triggers = getDb()
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger' AND name LIKE 'campaigns_persistence_integrity%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    expect(triggers.map((t) => t.name)).toEqual([
      'campaigns_persistence_integrity_insert',
      'campaigns_persistence_integrity_update',
    ]);
  });

  it('accepts valid campaign rows', async () => {
    const { getDb } = await boot();
    const db = getDb();

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      validCampaign.id,
      validCampaign.creator,
      validCampaign.title,
      validCampaign.description,
      validCampaign.accepted_tokens_json,
      validCampaign.target_amount,
      validCampaign.pledged_amount,
      validCampaign.deadline,
      validCampaign.created_at,
    );

    const row = db.prepare(`SELECT id, pledged_amount FROM campaigns WHERE id = ?`).get('1') as {
      id: string;
      pledged_amount: number;
    };
    expect(row.id).toBe('1');
    expect(row.pledged_amount).toBe(0);
  });

  it('rejects non-positive target_amount', async () => {
    const { getDb } = await boot();
    const db = getDb();

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
          validCampaign.creator,
          'Bad Target',
          validCampaign.description,
          '["XLM"]',
          0,
          0,
          validCampaign.deadline,
          validCampaign.created_at,
        ),
    ).toThrow(/target_amount/);
  });

  it('rejects empty title and negative pledged_amount updates', async () => {
    const { getDb } = await boot();
    const db = getDb();

    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '3',
      validCampaign.creator,
      validCampaign.title,
      validCampaign.description,
      '["XLM"]',
      50,
      0,
      validCampaign.deadline,
      validCampaign.created_at,
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
          '4',
          validCampaign.creator,
          '   ',
          validCampaign.description,
          '["XLM"]',
          50,
          0,
          validCampaign.deadline,
          validCampaign.created_at,
        ),
    ).toThrow(/title/);

    expect(() =>
      db.prepare(`UPDATE campaigns SET pledged_amount = -1 WHERE id = ?`).run('3'),
    ).toThrow(/pledged_amount/);
  });

  it('rejects mutually exclusive claimed_at and failed_at', async () => {
    const { getDb } = await boot();
    const db = getDb();

    expect(() =>
      db
        .prepare(
          `INSERT INTO campaigns (
            id, creator, title, description, accepted_tokens_json,
            target_amount, pledged_amount, deadline, created_at, claimed_at, failed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          '5',
          validCampaign.creator,
          'Both Terminal',
          validCampaign.description,
          '["XLM"]',
          50,
          0,
          validCampaign.deadline,
          validCampaign.created_at,
          1_700_000_100,
          1_700_000_200,
        ),
    ).toThrow(/claimed and failed/);
  });

  it('soft-cleans negative pledged_amount on migrate and remains idempotent', async () => {
    const { getDb, resetDbForTests, initDb, ensureCampaignsIntegrityConstraints } = await boot();
    const db = getDb();

    // Bypass triggers temporarily to seed a corrupt cached total, then re-run
    // the integrity installer (as migrate would) and confirm soft-clean.
    db.exec(`DROP TRIGGER IF EXISTS campaigns_persistence_integrity_insert`);
    db.exec(`DROP TRIGGER IF EXISTS campaigns_persistence_integrity_update`);
    db.prepare(
      `INSERT INTO campaigns (
        id, creator, title, description, accepted_tokens_json,
        target_amount, pledged_amount, deadline, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '6',
      validCampaign.creator,
      validCampaign.title,
      validCampaign.description,
      '["XLM"]',
      100,
      -5,
      validCampaign.deadline,
      validCampaign.created_at,
    );

    ensureCampaignsIntegrityConstraints(db);
    const row = db.prepare(`SELECT pledged_amount FROM campaigns WHERE id = ?`).get('6') as {
      pledged_amount: number;
    };
    expect(row.pledged_amount).toBe(0);

    // Idempotent second call
    ensureCampaignsIntegrityConstraints(db);
    const again = db.prepare(`SELECT pledged_amount FROM campaigns WHERE id = ?`).get('6') as {
      pledged_amount: number;
    };
    expect(again.pledged_amount).toBe(0);

    // Re-init path stays safe
    resetDbForTests();
    initDb(TEST_DB);
  });
});
