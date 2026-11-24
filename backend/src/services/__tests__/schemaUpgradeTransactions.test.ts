import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb, resetDbForTests } from '../db';
import { addPledge, createCampaign } from '../campaignStore';

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

function futureDeadline(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function newCampaign(overrides: { targetAmount?: number; maxPerContributor?: number } = {}) {
  return createCampaign({
    creator: CREATOR,
    title: 'Pledge boundary',
    description: 'Campaign used to test the pledge write boundary.',
    acceptedTokens: ['USDC'],
    targetAmount: overrides.targetAmount ?? 500,
    deadline: futureDeadline(),
    ...(overrides.maxPerContributor ? { maxPerContributor: overrides.maxPerContributor } : {}),
  });
}

/** What a pledge writes: the pledge row, the campaign total, and 'pledged' history. */
function state(campaignId: string) {
  const db = getDb();
  const pledges = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM pledges WHERE campaign_id = ?`)
    .get(campaignId) as { n: number; sum: number };
  const total = db.prepare(`SELECT pledged_amount AS v FROM campaigns WHERE id = ?`).get(campaignId) as {
    v: number;
  };
  const events = db
    .prepare(
      `SELECT COUNT(*) AS n FROM campaign_events WHERE campaign_id = ? AND event_type = 'pledged'`,
    )
    .get(campaignId) as { n: number };
  return {
    pledgeCount: pledges.n,
    pledgeSum: pledges.sum,
    campaignTotal: total.v,
    pledgedEvents: events.n,
  };
}

const FAIL_PLEDGED_EVENT = `
  CREATE TRIGGER fail_pledged_event BEFORE INSERT ON campaign_events
  WHEN NEW.event_type = 'pledged'
  BEGIN SELECT RAISE(ABORT, 'simulated event history failure'); END;`;

const FAIL_LIMIT_EVENT = `
  CREATE TRIGGER fail_limit_event BEFORE INSERT ON campaign_events
  WHEN NEW.event_type = 'pledge_limit_reached'
  BEGIN SELECT RAISE(ABORT, 'simulated limit event failure'); END;`;

const FAIL_TOTAL_UPDATE = `
  CREATE TRIGGER fail_total_update BEFORE UPDATE OF pledged_amount ON campaigns
  BEGIN SELECT RAISE(ABORT, 'simulated total update failure'); END;`;

describe('pledge write boundary: pledge, campaign total and event history are atomic', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    resetDbForTests();
    initDb();
  });

  afterEach(() => {
    resetDbForTests();
  });

  it('commits the pledge, the campaign total and the history event together', () => {
    const campaign = newCampaign();

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 120, assetCode: 'USDC' });

    expect(state(campaign.id)).toEqual({
      pledgeCount: 1,
      pledgeSum: 120,
      campaignTotal: 120,
      pledgedEvents: 1,
    });
  });

  it('rolls back the pledge and total when the history write fails', () => {
    const campaign = newCampaign();
    getDb().exec(FAIL_PLEDGED_EVENT);

    expect(() =>
      addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 120, assetCode: 'USDC' }),
    ).toThrow(/simulated event history failure/);

    expect(state(campaign.id)).toEqual({
      pledgeCount: 0,
      pledgeSum: 0,
      campaignTotal: 0,
      pledgedEvents: 0,
    });
  });

  it('rolls back the pledge when the campaign total update fails', () => {
    const campaign = newCampaign();
    getDb().exec(FAIL_TOTAL_UPDATE);

    expect(() =>
      addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 120, assetCode: 'USDC' }),
    ).toThrow(/simulated total update failure/);

    expect(state(campaign.id)).toEqual({
      pledgeCount: 0,
      pledgeSum: 0,
      campaignTotal: 0,
      pledgedEvents: 0,
    });
  });

  it('rolls everything back when the second history write fails after the first succeeded', () => {
    // A pledge that reaches the contributor limit writes two events: the pledge
    // and then `pledge_limit_reached`. The first event is already written when
    // the second fails, so a partial commit would leave a pledge event behind.
    const campaign = newCampaign({ maxPerContributor: 100 });
    getDb().exec(FAIL_LIMIT_EVENT);

    expect(() =>
      addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100, assetCode: 'USDC' }),
    ).toThrow(/simulated limit event failure/);

    expect(state(campaign.id)).toEqual({
      pledgeCount: 0,
      pledgeSum: 0,
      campaignTotal: 0,
      pledgedEvents: 0,
    });
  });

  it('commits exactly once when the same pledge is retried after the failure clears', () => {
    const campaign = newCampaign();
    const db = getDb();
    db.exec(FAIL_PLEDGED_EVENT);

    expect(() =>
      addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 120, assetCode: 'USDC' }),
    ).toThrow();

    db.exec(`DROP TRIGGER fail_pledged_event`);
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 120, assetCode: 'USDC' });

    // Neither dropped by the failed attempt nor duplicated by the retry.
    expect(state(campaign.id)).toEqual({
      pledgeCount: 1,
      pledgeSum: 120,
      campaignTotal: 120,
      pledgedEvents: 1,
    });
  });

  it('leaves committed pledges untouched when a later pledge fails', () => {
    const campaign = newCampaign();
    const db = getDb();
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100, assetCode: 'USDC' });

    db.exec(FAIL_PLEDGED_EVENT);
    expect(() =>
      addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 50, assetCode: 'USDC' }),
    ).toThrow();

    expect(state(campaign.id)).toEqual({
      pledgeCount: 1,
      pledgeSum: 100,
      campaignTotal: 100,
      pledgedEvents: 1,
    });
  });

  it('writes nothing for a pledge rejected by the funding cap', () => {
    const campaign = newCampaign({ targetAmount: 500 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 400, assetCode: 'USDC' });

    expect(() =>
      addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 200, assetCode: 'USDC' }),
    ).toThrow(/funding cap/);

    expect(state(campaign.id)).toEqual({
      pledgeCount: 1,
      pledgeSum: 400,
      campaignTotal: 400,
      pledgedEvents: 1,
    });
  });
});

describe('pledge write boundary after upgrading an existing database', () => {
  let dir: string;
  let dbFile: string;

  beforeEach(() => {
    resetDbForTests();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgv-upgrade-'));
    dbFile = path.join(dir, 'legacy.db');

    // A database from before versioned migrations: no history table, no
    // asset_code / transaction_hash on pledges, and rows with NULLs where
    // later columns now exist.
    const legacy = new Database(dbFile);
    legacy.exec(`
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
    legacy
      .prepare(
        `INSERT INTO campaigns (id, creator, title, description, accepted_tokens_json,
                                target_amount, pledged_amount, deadline, created_at)
         VALUES ('legacy-1', ?, 'Old campaign', 'Created before migrations', '["USDC"]',
                 500, 40, ?, 1000)`,
      )
      .run(CREATOR, futureDeadline());
    legacy
      .prepare(
        `INSERT INTO pledges (campaign_id, contributor, amount, created_at)
         VALUES ('legacy-1', ?, 40, 1500)`,
      )
      .run(CONTRIBUTOR);
    legacy.close();

    initDb(dbFile);
  });

  afterEach(() => {
    resetDbForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the old pledge and total intact through the upgrade', () => {
    expect(state('legacy-1')).toEqual({
      pledgeCount: 1,
      pledgeSum: 40,
      campaignTotal: 40,
      pledgedEvents: 0,
    });
    const old = getDb()
      .prepare(`SELECT transaction_hash AS tx, refunded_at AS refunded FROM pledges WHERE campaign_id = 'legacy-1'`)
      .get() as { tx: string | null; refunded: number | null };
    expect(old).toEqual({ tx: null, refunded: null });
  });

  it('commits a new pledge, the total and its event together on the upgraded database', () => {
    addPledge('legacy-1', { contributor: CONTRIBUTOR, amount: 10, assetCode: 'USDC' });

    expect(state('legacy-1')).toEqual({
      pledgeCount: 2,
      pledgeSum: 50,
      campaignTotal: 50,
      pledgedEvents: 1,
    });
  });

  it('rolls back to the upgraded state when the history write fails, then commits once on retry', () => {
    const db = getDb();
    db.exec(FAIL_PLEDGED_EVENT);

    expect(() =>
      addPledge('legacy-1', { contributor: CONTRIBUTOR, amount: 10, assetCode: 'USDC' }),
    ).toThrow(/simulated event history failure/);
    expect(state('legacy-1')).toEqual({
      pledgeCount: 1,
      pledgeSum: 40,
      campaignTotal: 40,
      pledgedEvents: 0,
    });

    db.exec(`DROP TRIGGER fail_pledged_event`);
    addPledge('legacy-1', { contributor: CONTRIBUTOR, amount: 10, assetCode: 'USDC' });
    expect(state('legacy-1')).toEqual({
      pledgeCount: 2,
      pledgeSum: 50,
      campaignTotal: 50,
      pledgedEvents: 1,
    });
  });

  it('does not change data when the upgraded database is opened again', () => {
    addPledge('legacy-1', { contributor: CONTRIBUTOR, amount: 10, assetCode: 'USDC' });
    const before = state('legacy-1');

    resetDbForTests();
    initDb(dbFile);

    expect(state('legacy-1')).toEqual(before);
  });
});
