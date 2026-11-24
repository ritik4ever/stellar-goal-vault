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
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCampaignInput,
  buildFutureDeadline,
  freezeClock,
  type Clock,
  WALLETS,
} from '../../../tests/fixtures';

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
let addPledge: CampaignStoreModule['addPledge'];
let getPledges: CampaignStoreModule['getPledges'];
let setCurrentTime: CampaignStoreModule['setCurrentTime'];
let resetTime: CampaignStoreModule['resetTime'];
let getDb: DbModule['getDb'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];
let clock: Clock;

function campaignBase(
  overrides: Partial<{ title: string; targetAmount: number; deadline: number }> = {},
) {
  return buildCampaignInput({
    creator: WALLETS.creator,
    title: overrides.title ?? 'Test Campaign',
    description: 'Campaigns persistence transaction test',
    targetAmount: overrides.targetAmount ?? 500,
    deadline: overrides.deadline ?? buildFutureDeadline(),
  });
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
    addPledge,
    getPledges,
    setCurrentTime,
    resetTime,
  } = await import('../campaignStore'));
  ({ getDb } = await import('../db'));
  ({ getCampaignHistory } = await import('../eventHistory'));

  initCampaignStore();
});

afterAll(() => {
  getDb().close();
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  clock = freezeClock(undefined, {
    setStoreTime: setCurrentTime,
    resetStoreTime: resetTime,
  });
  const db = getDb();
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM campaign_events').run();
  db.prepare('DELETE FROM pledges').run();
  db.prepare('DELETE FROM campaigns').run();
});

afterEach(() => {
  clock.restore();
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
    expect(history[0].actor).toBe(WALLETS.creator);
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

    const archivedEvents = getCampaignHistory(campaign.id).filter(
      (e) => e.eventType === 'archived',
    );
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

    const archivedEvents = getCampaignHistory(campaign.id).filter(
      (e) => e.eventType === 'archived',
    );
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
    const restoredEvents = getCampaignHistory(campaign.id).filter(
      (e) => e.eventType === 'restored',
    );
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

    const restoredEvents = getCampaignHistory(campaign.id).filter(
      (e) => e.eventType === 'restored',
    );
    expect(restoredEvents).toHaveLength(1);

    const { campaigns } = listCampaigns({});
    expect(campaigns.some((c) => c.id === campaign.id)).toBe(true);
  });
});

describe('addPledge – accounting transaction rollback (#891)', () => {
  it('rolls back the pledge row and campaign total when event persistence fails', async () => {
    const campaign = createCampaign(campaignBase({ targetAmount: 500 }));
    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated pledge event failure');
    });

    expect(() => addPledge(campaign.id, { contributor: WALLETS.alice, amount: 125 })).toThrow(
      'Simulated pledge event failure',
    );

    expect(getPledges(campaign.id)).toHaveLength(0);
    expect(getCampaign(campaign.id)?.pledgedAmount).toBe(0);
    expect(
      getCampaignHistory(campaign.id).filter((event) => event.eventType === 'pledged'),
    ).toHaveLength(0);
  });
});

describe('campaign transaction observability (SGV-2026-169)', () => {
  it('logs pending and committed outcomes with a redacted campaign reference on success', async () => {
    const loggerModule = await import('../../logger');
    const infoSpy = vi.spyOn(loggerModule, 'logInfo');
    const errorSpy = vi.spyOn(loggerModule, 'logError');

    const campaign = createCampaign(campaignBase({ title: 'Observable Campaign' }));

    const txInfoCalls = infoSpy.mock.calls.filter(
      ([event]) =>
        event === 'campaign_transaction_pending' || event === 'campaign_transaction_committed',
    );
    expect(txInfoCalls).toHaveLength(2);

    const [pendingEvent, pendingMeta] = txInfoCalls[0];
    expect(pendingEvent).toBe('campaign_transaction_pending');
    expect(pendingMeta).toMatchObject({
      outcome: 'pending',
      operation: 'createCampaign',
    });
    expect(String((pendingMeta as Record<string, unknown>).campaignRef)).not.toBe(campaign.id);

    const [committedEvent, committedMeta] = txInfoCalls[1];
    expect(committedEvent).toBe('campaign_transaction_committed');
    expect(committedMeta).toMatchObject({
      outcome: 'committed',
      operation: 'createCampaign',
      completedWrites: 2,
    });
    expect(String((committedMeta as Record<string, unknown>).campaignRef)).not.toBe(campaign.id);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs redacted campaign reference and rejected outcome when the second write fails after the first succeeds', async () => {
    const campaign = createCampaign(campaignBase({ targetAmount: 500 }));

    const loggerModule = await import('../../logger');
    const eventHistoryModule = await import('../eventHistory');
    const infoSpy = vi.spyOn(loggerModule, 'logInfo');
    const errorSpy = vi.spyOn(loggerModule, 'logError');

    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated second write failure');
    });

    expect(() => addPledge(campaign.id, { contributor: WALLETS.alice, amount: 125 })).toThrow(
      'Simulated second write failure',
    );

    // Pending was logged before the transaction started
    const pendingCall = infoSpy.mock.calls.find(
      ([event, meta]) =>
        event === 'campaign_transaction_pending' &&
        (meta as Record<string, unknown>)?.operation === 'addPledge',
    );
    expect(pendingCall).toBeDefined();
    expect((pendingCall?.[1] as Record<string, unknown>).outcome).toBe('pending');

    // Rejected was logged after rollback with failedAfterFirstWrite: true and redacted campaignRef
    const rejectedCall = errorSpy.mock.calls.find(
      ([, meta]) => (meta as Record<string, unknown>)?.event === 'campaign_transaction_rejected',
    );
    expect(rejectedCall).toBeDefined();
    const rejectedMeta = rejectedCall?.[1] as Record<string, unknown>;
    expect(rejectedMeta).toMatchObject({
      event: 'campaign_transaction_rejected',
      outcome: 'rejected',
      operation: 'addPledge',
      failedAfterFirstWrite: true,
      rolledBack: true,
    });
    expect(Number(rejectedMeta.completedWrites)).toBeGreaterThanOrEqual(1);
    expect(String(rejectedMeta.campaignRef)).not.toBe(campaign.id);
    expect(String(rejectedMeta.campaignRef)).toMatch(/^.{4}\.\.\..{4}$|^\*\*\*$/);

    // No committed log was emitted for the failed transaction
    const committedCall = infoSpy.mock.calls.find(
      ([event, meta]) =>
        event === 'campaign_transaction_committed' &&
        (meta as Record<string, unknown>)?.operation === 'addPledge',
    );
    expect(committedCall).toBeUndefined();

    // Retry succeeds and logs pending -> committed
    vi.restoreAllMocks();
    const retryInfoSpy = vi.spyOn(loggerModule, 'logInfo');
    addPledge(campaign.id, { contributor: WALLETS.alice, amount: 125 });

    const retryCommitted = retryInfoSpy.mock.calls.find(
      ([event, meta]) =>
        event === 'campaign_transaction_committed' &&
        (meta as Record<string, unknown>)?.operation === 'addPledge',
    );
    expect(retryCommitted).toBeDefined();
    expect((retryCommitted?.[1] as Record<string, unknown>).outcome).toBe('committed');
  });
});
