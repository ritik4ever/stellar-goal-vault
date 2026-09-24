/**
 * Transaction boundary tests for issue #870
 * [DB] Make transactions explicit in campaigns persistence
 *
 * Verifies multi-step campaign lifecycle writes are atomic:
 *   - createCampaign: INSERT campaigns + recordEvent('created')
 *   - softDeleteCampaign: UPDATE deleted_at + recordEvent('archived')
 *   - restoreCampaign: CLEAR deleted_at + recordEvent('restored')
 *
 * Injected mid-operation failures leave no partial persisted state;
 * retries remain safe.
 */

import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-campaigns-tx-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

type CampaignStoreModule = typeof import('../campaignStore');
type DbModule = typeof import('../db');
type EventHistoryModule = typeof import('../eventHistory');

let createCampaign: CampaignStoreModule['createCampaign'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let getCampaign: CampaignStoreModule['getCampaign'];
let listCampaigns: CampaignStoreModule['listCampaigns'];
let softDeleteCampaign: CampaignStoreModule['softDeleteCampaign'];
let restoreCampaign: CampaignStoreModule['restoreCampaign'];
let getDb: DbModule['getDb'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];

const CREATOR = `G${'A'.repeat(55)}`;
const future = (offsetSeconds = 86400) => Math.floor(Date.now() / 1000) + offsetSeconds;

function campaignBase(
  overrides: Partial<{ title: string; targetAmount: number; deadline: number }> = {},
) {
  return {
    creator: CREATOR,
    title: overrides.title ?? 'Test Campaign',
    description: 'Campaigns persistence transaction test',
    assetCode: 'USDC',
    targetAmount: overrides.targetAmount ?? 500,
    deadline: overrides.deadline ?? future(),
  };
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,
    initCampaignStore,
    getCampaign,
    listCampaigns,
    softDeleteCampaign,
    restoreCampaign,
  } = await import('../campaignStore'));
  ({ getDb } = await import('../db'));
  ({ getCampaignHistory } = await import('../eventHistory'));

  initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  const db = getDb();
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM campaign_events').run();
  db.prepare('DELETE FROM pledges').run();
  db.prepare('DELETE FROM campaigns').run();
});

describe('createCampaign – transaction rollback (#870)', () => {
  it('rolls back the campaign INSERT when recordEvent throws mid-transaction', async () => {
    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated event write failure');
    });

    expect(() => createCampaign(campaignBase())).toThrow('Simulated event write failure');

    const { campaigns } = listCampaigns({ includeDeleted: true });
    expect(campaigns).toHaveLength(0);

    const db = getDb();
    const eventCount = (
      db.prepare('SELECT COUNT(*) AS count FROM campaign_events').get() as { count: number }
    ).count;
    expect(eventCount).toBe(0);
  });

  it('succeeds on a clean retry after a failed attempt', async () => {
    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated event write failure');
    });
    expect(() => createCampaign(campaignBase({ title: 'Retry Campaign' }))).toThrow();

    vi.restoreAllMocks();
    const campaign = createCampaign(campaignBase({ title: 'Retry Campaign' }));

    expect(campaign.title).toBe('Retry Campaign');
    expect(getCampaign(campaign.id)).toBeDefined();
    expect(getCampaignHistory(campaign.id)).toHaveLength(1);
    expect(getCampaignHistory(campaign.id)[0].eventType).toBe('created');
  });

  it('persists both the campaign row and the created event on success', () => {
    const campaign = createCampaign(campaignBase({ title: 'Atomic Campaign' }));

    expect(getCampaign(campaign.id)).toBeDefined();
    const history = getCampaignHistory(campaign.id);
    expect(history).toHaveLength(1);
    expect(history[0].eventType).toBe('created');
    expect(history[0].actor).toBe(CREATOR);
  });
});

describe('softDeleteCampaign – transaction rollback (#870)', () => {
  it('rolls back the deleted_at update when recordEvent throws mid-transaction', async () => {
    const campaign = createCampaign(campaignBase());

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated archived event failure');
    });

    expect(() => softDeleteCampaign(campaign.id)).toThrow('Simulated archived event failure');

    const refreshed = getCampaign(campaign.id);
    expect(refreshed?.deletedAt).toBeUndefined();

    const archivedEvents = getCampaignHistory(campaign.id).filter((e) => e.eventType === 'archived');
    expect(archivedEvents).toHaveLength(0);
  });

  it('succeeds on clean retry after a failed attempt', async () => {
    const campaign = createCampaign(campaignBase());

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated archived event failure');
    });
    expect(() => softDeleteCampaign(campaign.id)).toThrow();

    vi.restoreAllMocks();
    const deleted = softDeleteCampaign(campaign.id);
    expect(deleted.deletedAt).toBeDefined();

    const archivedEvents = getCampaignHistory(campaign.id).filter((e) => e.eventType === 'archived');
    expect(archivedEvents).toHaveLength(1);
  });
});

describe('restoreCampaign – transaction rollback (#870)', () => {
  it('rolls back the restore when recordEvent throws mid-transaction', async () => {
    const campaign = createCampaign(campaignBase());
    softDeleteCampaign(campaign.id);
    expect(getCampaign(campaign.id)?.deletedAt).toBeDefined();

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated restored event failure');
    });

    expect(() => restoreCampaign(campaign.id)).toThrow('Simulated restored event failure');

    expect(getCampaign(campaign.id)?.deletedAt).toBeDefined();
    const restoredEvents = getCampaignHistory(campaign.id).filter((e) => e.eventType === 'restored');
    expect(restoredEvents).toHaveLength(0);
  });

  it('succeeds on clean retry after a failed attempt', async () => {
    const campaign = createCampaign(campaignBase());
    softDeleteCampaign(campaign.id);

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated restored event failure');
    });
    expect(() => restoreCampaign(campaign.id)).toThrow();

    vi.restoreAllMocks();
    const restored = restoreCampaign(campaign.id);
    expect(restored.deletedAt).toBeUndefined();

    const restoredEvents = getCampaignHistory(campaign.id).filter((e) => e.eventType === 'restored');
    expect(restoredEvents).toHaveLength(1);

    const { campaigns } = listCampaigns({});
    expect(campaigns.some((c) => c.id === campaign.id)).toBe(true);
  });
});
