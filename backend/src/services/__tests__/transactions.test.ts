/**
 * Transaction rollback tests for issue #890 — "Make transactions explicit in query layer"
 *
 * These tests verify that injected mid-operation failures leave no partial persisted
 * state and that retries of successful operations remain safe. Every multi-step write
 * that was given an explicit db.transaction() boundary is covered:
 *
 *   • createCampaign   – INSERT campaigns + recordEvent
 *   • softDeleteCampaign – UPDATE campaigns (deleted_at) + recordEvent (archived)
 *   • restoreCampaign  – UPDATE campaigns (deleted_at = NULL) + recordEvent (restored)
 *   • refundContributor – UPDATE pledges + UPDATE campaigns (pledged_amount) +
 *                          recordEvent + createNotification
 *
 * For each operation we:
 *   1. Spy on recordEvent to throw after the first DB write succeeds, simulating a
 *      mid-transaction failure.
 *   2. Assert that both the primary table write AND the event are absent after the error.
 *   3. Assert that a clean retry (no spy) succeeds and leaves consistent state.
 */

import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-tx-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

// ── Type imports ──────────────────────────────────────────────────────────────
type CampaignStoreModule = typeof import('../campaignStore');
type DbModule = typeof import('../db');
type EventHistoryModule = typeof import('../eventHistory');

// ── Module references (populated in beforeAll) ────────────────────────────────
let createCampaign: CampaignStoreModule['createCampaign'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let getCampaign: CampaignStoreModule['getCampaign'];
let listCampaigns: CampaignStoreModule['listCampaigns'];
let addPledge: CampaignStoreModule['addPledge'];
let refundContributor: CampaignStoreModule['refundContributor'];
let softDeleteCampaign: CampaignStoreModule['softDeleteCampaign'];
let restoreCampaign: CampaignStoreModule['restoreCampaign'];
let getDb: DbModule['getDb'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];

// ── Constants ─────────────────────────────────────────────────────────────────
const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

const future = (offsetSeconds = 86400) => Math.floor(Date.now() / 1000) + offsetSeconds;
const past = (offsetSeconds = 86400) => Math.floor(Date.now() / 1000) - offsetSeconds;

function campaignBase(overrides: Partial<{
  title: string;
  targetAmount: number;
  deadline: number;
}> = {}) {
  return {
    creator: CREATOR,
    title: overrides.title ?? 'Test Campaign',
    description: 'Transaction rollback test campaign',
    assetCode: 'USDC',
    targetAmount: overrides.targetAmount ?? 500,
    deadline: overrides.deadline ?? future(),
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,
    initCampaignStore,
    getCampaign,
    listCampaigns,
    addPledge,
    refundContributor,
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

// ══════════════════════════════════════════════════════════════════════════════
// createCampaign — atomic INSERT + event
// ══════════════════════════════════════════════════════════════════════════════
describe('createCampaign – transaction rollback', () => {
  it('rolls back the campaign INSERT when recordEvent throws mid-transaction', async () => {
    // Dynamically import eventHistory so we can spy on the real module
    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated event write failure');
    });

    expect(() => createCampaign(campaignBase())).toThrow('Simulated event write failure');

    // Both the campaign row and any event must be absent — no partial state
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

    // First attempt: event write throws → full rollback
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated event write failure');
    });
    expect(() => createCampaign(campaignBase({ title: 'Retry Campaign' }))).toThrow();

    // Second attempt: no spy, must succeed
    vi.restoreAllMocks();
    const campaign = createCampaign(campaignBase({ title: 'Retry Campaign' }));

    expect(campaign).toBeDefined();
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

// ══════════════════════════════════════════════════════════════════════════════
// softDeleteCampaign — atomic UPDATE + archived event
// ══════════════════════════════════════════════════════════════════════════════
describe('softDeleteCampaign – transaction rollback', () => {
  it('rolls back the deleted_at update when recordEvent throws mid-transaction', async () => {
    const campaign = createCampaign(campaignBase());

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated archived event failure');
    });

    expect(() => softDeleteCampaign(campaign.id)).toThrow('Simulated archived event failure');

    // Campaign must still be visible (not deleted)
    const refreshed = getCampaign(campaign.id);
    expect(refreshed).toBeDefined();
    expect(refreshed?.deletedAt).toBeUndefined();

    // No archived event should exist
    const history = getCampaignHistory(campaign.id);
    const archivedEvents = history.filter((e) => e.eventType === 'archived');
    expect(archivedEvents).toHaveLength(0);
  });

  it('succeeds on clean retry after a failed attempt', async () => {
    const campaign = createCampaign(campaignBase());

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated archived event failure');
    });
    expect(() => softDeleteCampaign(campaign.id)).toThrow();

    // Retry succeeds
    vi.restoreAllMocks();
    const deleted = softDeleteCampaign(campaign.id);
    expect(deleted.deletedAt).toBeDefined();

    // Exactly one archived event
    const history = getCampaignHistory(campaign.id);
    const archivedEvents = history.filter((e) => e.eventType === 'archived');
    expect(archivedEvents).toHaveLength(1);
  });

  it('persists both the deleted_at timestamp and the archived event on success', () => {
    const campaign = createCampaign(campaignBase());
    const deleted = softDeleteCampaign(campaign.id);

    expect(deleted.deletedAt).toBeDefined();
    const history = getCampaignHistory(campaign.id);
    const archived = history.find((e) => e.eventType === 'archived');
    expect(archived).toBeDefined();
    expect(archived?.actor).toBe(CREATOR);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// restoreCampaign — atomic UPDATE (deleted_at = NULL) + restored event
// ══════════════════════════════════════════════════════════════════════════════
describe('restoreCampaign – transaction rollback', () => {
  it('rolls back the deleted_at clearance when recordEvent throws mid-transaction', async () => {
    const campaign = createCampaign(campaignBase());
    softDeleteCampaign(campaign.id); // archive it first

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated restored event failure');
    });

    expect(() => restoreCampaign(campaign.id)).toThrow('Simulated restored event failure');

    // Campaign must still appear deleted
    const { campaigns: withDeleted } = listCampaigns({ includeDeleted: true });
    const refreshed = withDeleted.find((c) => c.id === campaign.id);
    expect(refreshed?.deletedAt).toBeDefined();

    // No restored event
    const history = getCampaignHistory(campaign.id);
    const restoredEvents = history.filter((e) => e.eventType === 'restored');
    expect(restoredEvents).toHaveLength(0);
  });

  it('succeeds on clean retry after a failed restore attempt', async () => {
    const campaign = createCampaign(campaignBase());
    softDeleteCampaign(campaign.id);

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated restored event failure');
    });
    expect(() => restoreCampaign(campaign.id)).toThrow();

    // Retry
    vi.restoreAllMocks();
    const restored = restoreCampaign(campaign.id);
    expect(restored.deletedAt).toBeUndefined();

    const history = getCampaignHistory(campaign.id);
    expect(history.filter((e) => e.eventType === 'restored')).toHaveLength(1);
  });

  it('persists both the cleared deleted_at and the restored event on success', () => {
    const campaign = createCampaign(campaignBase());
    softDeleteCampaign(campaign.id);
    const restored = restoreCampaign(campaign.id);

    expect(restored.deletedAt).toBeUndefined();
    const history = getCampaignHistory(campaign.id);
    const restoredEvent = history.find((e) => e.eventType === 'restored');
    expect(restoredEvent).toBeDefined();
    expect(restoredEvent?.actor).toBe(CREATOR);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// refundContributor — atomic UPDATE pledges + UPDATE campaigns + event
// ══════════════════════════════════════════════════════════════════════════════
describe('refundContributor – transaction rollback', () => {
  /** Helper: create a failed campaign with one active pledge */
  function setupFailedCampaignWithPledge() {
    const campaign = createCampaign(campaignBase({ targetAmount: 500, deadline: future(3600) }));

    // Add pledge as an off-chain insert so we can back-date it
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100 });

    // Back-date deadline to make campaign failed
    const db = getDb();
    const pastDeadline = past(3600);
    db.prepare(`UPDATE campaigns SET deadline = ? WHERE id = ?`).run(pastDeadline, campaign.id);

    return campaign;
  }

  it('rolls back pledge & campaign updates when recordEvent throws mid-transaction', async () => {
    const campaign = setupFailedCampaignWithPledge();

    const beforeCampaign = getCampaign(campaign.id)!;
    const pledgedBefore = beforeCampaign.pledgedAmount;

    const eventHistoryModule = await import('../eventHistory');
    // The spy fires on the SECOND recordEvent call (first was "created", second is "refunded")
    // We need to let the real function run for "pledged" then throw for "refunded"
    let callCount = 0;
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementation((...args) => {
      callCount++;
      // "created" and "pledged" events already stored; this call is for "refunded"
      if (callCount === 1) {
        throw new Error('Simulated refund event failure');
      }
      return eventHistoryModule.recordEvent(...args);
    });

    expect(() => refundContributor(campaign.id, CONTRIBUTOR)).toThrow(
      'Simulated refund event failure',
    );

    // pledged_amount must not have changed
    const afterCampaign = getCampaign(campaign.id)!;
    expect(afterCampaign.pledgedAmount).toBe(pledgedBefore);

    // pledges must still be unrefunded
    const db = getDb();
    const unrefundedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = ? AND refunded_at IS NULL`,
        )
        .get(campaign.id) as { count: number }
    ).count;
    expect(unrefundedCount).toBeGreaterThan(0);

    // No refunded event must exist
    const history = getCampaignHistory(campaign.id);
    expect(history.filter((e) => e.eventType === 'refunded')).toHaveLength(0);
  });

  it('succeeds on clean retry after a failed refund attempt', async () => {
    const campaign = setupFailedCampaignWithPledge();

    const eventHistoryModule = await import('../eventHistory');
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated refund event failure');
    });
    expect(() => refundContributor(campaign.id, CONTRIBUTOR)).toThrow();

    // Retry without spy
    vi.restoreAllMocks();
    const { campaign: after, refundedAmount } = refundContributor(campaign.id, CONTRIBUTOR);

    expect(refundedAmount).toBeGreaterThan(0);
    expect(after.pledgedAmount).toBe(0);

    const history = getCampaignHistory(campaign.id);
    expect(history.filter((e) => e.eventType === 'refunded')).toHaveLength(1);
  });

  it('persists pledge refunds, campaign deduction, and refunded event atomically on success', () => {
    const campaign = setupFailedCampaignWithPledge();

    const { campaign: after, refundedAmount } = refundContributor(campaign.id, CONTRIBUTOR);

    expect(refundedAmount).toBe(100);
    expect(after.pledgedAmount).toBe(0);

    const db = getDb();
    const unrefunded = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = ? AND refunded_at IS NULL`,
        )
        .get(campaign.id) as { count: number }
    ).count;
    expect(unrefunded).toBe(0);

    const history = getCampaignHistory(campaign.id);
    const refundEvent = history.find((e) => e.eventType === 'refunded');
    expect(refundEvent).toBeDefined();
    expect(refundEvent?.amount).toBe(100);
    expect(refundEvent?.actor).toBe(CONTRIBUTOR);
  });
});
