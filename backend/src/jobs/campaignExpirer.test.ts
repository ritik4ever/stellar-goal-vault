import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-expirer-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

type CampaignStoreModule = typeof import('../services/campaignStore');
type EventHistoryModule = typeof import('../services/eventHistory');
type DbModule = typeof import('../services/db');
type ExpirerModule = typeof import('./campaignExpirer');

let createCampaign: CampaignStoreModule['createCampaign'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let getCampaign: CampaignStoreModule['getCampaign'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];
let getDb: DbModule['getDb'];
let expireCampaigns: ExpirerModule['expireCampaigns'];

const CREATOR = `G${'A'.repeat(55)}`;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, initCampaignStore, getCampaign } = await import('../services/campaignStore'));
  ({ getCampaignHistory } = await import('../services/eventHistory'));
  ({ getDb } = await import('../services/db'));
  ({ expireCampaigns } = await import('./campaignExpirer'));
  initCampaignStore();
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

describe('campaignExpirer', () => {
  it('expires a campaign past deadline with insufficient pledges', () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
    createCampaign({
      creator: CREATOR,
      title: 'Expired campaign',
      description: 'Should fail',
      targetAmount: 100,
      deadline: pastDeadline,
    });

    const count = expireCampaigns();

    expect(count).toBe(1);
    const campaign = getCampaign('1');
    expect(campaign?.failedAt).toBe(pastDeadline);
  });

  it('does not expire a campaign still within deadline', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 3600;
    createCampaign({
      creator: CREATOR,
      title: 'Active campaign',
      description: 'Should not fail',
      targetAmount: 100,
      deadline: futureDeadline,
    });

    const count = expireCampaigns();

    expect(count).toBe(0);
    const campaign = getCampaign('1');
    expect(campaign?.failedAt).toBeUndefined();
  });

  it('does not expire a funded campaign past deadline', () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
    createCampaign({
      creator: CREATOR,
      title: 'Funded campaign',
      description: 'Should not fail',
      targetAmount: 100,
      deadline: pastDeadline,
    });
    const db = getDb();
    db.prepare(`UPDATE campaigns SET pledged_amount = 100 WHERE id = 1`).run();

    const count = expireCampaigns();

    expect(count).toBe(0);
    const campaign = getCampaign('1');
    expect(campaign?.failedAt).toBeUndefined();
  });

  it('does not expire an already-failed campaign', () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
    createCampaign({
      creator: CREATOR,
      title: 'Already failed',
      description: 'Should not double-expire',
      targetAmount: 100,
      deadline: pastDeadline,
    });
    const db = getDb();
    db.prepare(`UPDATE campaigns SET failed_at = ? WHERE id = 1`).run(pastDeadline - 100);

    const count = expireCampaigns();

    expect(count).toBe(0);
  });

  it('does not expire a claimed campaign past deadline', () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
    createCampaign({
      creator: CREATOR,
      title: 'Claimed campaign',
      description: 'Should not fail',
      targetAmount: 100,
      deadline: pastDeadline,
    });
    const db = getDb();
    db.prepare(`UPDATE campaigns SET claimed_at = ? WHERE id = 1`).run(pastDeadline);

    const count = expireCampaigns();

    expect(count).toBe(0);
  });

  it('records campaign_expired event for each expired campaign', () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
    createCampaign({
      creator: CREATOR,
      title: 'Expired A',
      description: 'Event test',
      targetAmount: 100,
      deadline: pastDeadline,
    });
    createCampaign({
      creator: CREATOR,
      title: 'Expired B',
      description: 'Event test',
      targetAmount: 200,
      deadline: pastDeadline,
    });

    const count = expireCampaigns();

    expect(count).toBe(2);
    const events1 = getCampaignHistory('1');
    const events2 = getCampaignHistory('2');
    expect(events1.some((e) => e.eventType === 'campaign_expired')).toBe(true);
    expect(events2.some((e) => e.eventType === 'campaign_expired')).toBe(true);
  });

  it('is idempotent — second run returns 0', () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
    createCampaign({
      creator: CREATOR,
      title: 'Idempotent test',
      description: 'Should only expire once',
      targetAmount: 100,
      deadline: pastDeadline,
    });

    const first = expireCampaigns();
    const second = expireCampaigns();

    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});
