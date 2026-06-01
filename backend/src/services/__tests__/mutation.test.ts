/**
 * Mutation-killing tests for campaignStore.ts and eventHistory.ts
 *
 * These tests are specifically designed to kill surviving mutants that standard
 * unit tests miss. Each describe block maps to a mutant category found during
 * mutation analysis.
 *
 * Covered critical paths:
 *  - calculateProgress: boundary conditions on deadline, funded, canClaim, canRefund
 *  - createCampaign: deadline validation, token normalization, edge amounts
 *  - addPledge: cap exceeded, asset validation, contributor limit, status guards
 *  - refundContributor: pledge state, amount accumulation, canRefund flag
 *  - eventHistory: recordEvent field mapping, getCampaignHistory ordering
 *  - rowToEvent / rowToCampaign: null-coalescing boundaries
 */

import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-mutation-${process.pid}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

// ── Type imports ──────────────────────────────────────────────────────────────
type CampaignStoreModule = typeof import('../campaignStore');
type DbModule = typeof import('../db');
type EventHistoryModule = typeof import('../eventHistory');

// ── Module references (populated in beforeAll) ────────────────────────────────
let createCampaign: CampaignStoreModule['createCampaign'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let addPledge: CampaignStoreModule['addPledge'];
let getCampaign: CampaignStoreModule['getCampaign'];
let getPledges: CampaignStoreModule['getPledges'];
let calculateProgress: CampaignStoreModule['calculateProgress'];
let refundContributor: CampaignStoreModule['refundContributor'];
let claimCampaign: CampaignStoreModule['claimCampaign'];
let reconcileOnChainPledge: CampaignStoreModule['reconcileOnChainPledge'];
let getGlobalStats: CampaignStoreModule['getGlobalStats'];
let getContributorSummary: CampaignStoreModule['getContributorSummary'];
let updateCampaign: CampaignStoreModule['updateCampaign'];
let softDeleteCampaign: CampaignStoreModule['softDeleteCampaign'];
let listCampaigns: CampaignStoreModule['listCampaigns'];
let getDb: DbModule['getDb'];
let recordEvent: EventHistoryModule['recordEvent'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];
let getEventByTxHash: EventHistoryModule['getEventByTxHash'];
let getEventsByLedger: EventHistoryModule['getEventsByLedger'];
let getEventsBySource: EventHistoryModule['getEventsBySource'];

// ── Constants ─────────────────────────────────────────────────────────────────
const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;
const CONTRIBUTOR2 = `G${'C'.repeat(55)}`;
const TX_HASH = 'b'.repeat(64);
const TX_HASH2 = 'c'.repeat(64);

// ── Helper: future deadline (seconds) ────────────────────────────────────────
const future = (offsetSeconds = 86400) =>
  Math.floor(Date.now() / 1000) + offsetSeconds;
const past = (offsetSeconds = 86400) =>
  Math.floor(Date.now() / 1000) - offsetSeconds;

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,
    initCampaignStore,
    addPledge,
    getCampaign,
    getPledges,
    calculateProgress,
    refundContributor,
    claimCampaign,
    reconcileOnChainPledge,
    getGlobalStats,
    getContributorSummary,
    updateCampaign,
    softDeleteCampaign,
    listCampaigns,
  } = await import('../campaignStore'));

  ({ getDb } = await import('../db'));
  ({ recordEvent, getCampaignHistory, getEventByTxHash, getEventsByLedger, getEventsBySource } =
    await import('../eventHistory'));

  initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM campaign_events').run();
  db.prepare('DELETE FROM pledges').run();
  db.prepare('DELETE FROM campaigns').run();
});

// ═════════════════════════════════════════════════════════════════════════════
// calculateProgress — boundary mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('calculateProgress – boundary conditions', () => {
  it('is "open" when deadline is strictly in the future and underfunded', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Open campaign',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    const progress = calculateProgress(campaign);
    expect(progress.status).toBe('open');
    expect(progress.canPledge).toBe(true);
    expect(progress.canClaim).toBe(false);
    expect(progress.canRefund).toBe(false);
  });

  it('is "failed" when deadline == now (at boundary)', () => {
    const now = Math.floor(Date.now() / 1000);
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Boundary failed',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    // Evaluate exactly AT the deadline
    const progress = calculateProgress(campaign, campaign.deadline);
    expect(progress.status).toBe('failed');
    expect(progress.canPledge).toBe(false);
    expect(progress.canRefund).toBe(true);
  });

  it('is "funded" when pledgedAmount exactly equals targetAmount before deadline', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Exactly funded',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 50,
      deadline: future(),
    });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 50 });
    const updated = getCampaign(campaign.id)!;
    const progress = calculateProgress(updated);
    expect(progress.status).toBe('funded');
    expect(progress.canClaim).toBe(false); // deadline not reached
    expect(progress.canRefund).toBe(false);
    // canPledge is false only when deadline passed OR claimed; funded+open still allows pledging
    expect(progress.canPledge).toBe(true);
  });

  it('canClaim is true only when deadline passed AND pledgedAmount >= targetAmount', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Claimable',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 50,
      deadline: future(),
    });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 50 });
    // Manually move deadline to the past so canClaim becomes true
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), campaign.id);
    const updated = getCampaign(campaign.id)!;
    const progress = calculateProgress(updated);
    expect(progress.canClaim).toBe(true);
    expect(progress.canRefund).toBe(false);
    expect(progress.status).toBe('funded');
  });

  it('canRefund is true only when deadline passed AND pledgedAmount < targetAmount', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Refundable',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 30 });
    // Move deadline to the past so canRefund becomes true
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), campaign.id);
    const updated = getCampaign(campaign.id)!;
    const progress = calculateProgress(updated);
    expect(progress.canRefund).toBe(true);
    expect(progress.canClaim).toBe(false);
    expect(progress.status).toBe('failed');
  });

  it('percentFunded is correct at 0%, 50%, 100%', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Percent check',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });

    expect(calculateProgress(campaign).percentFunded).toBe(0);

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100 });
    expect(calculateProgress(getCampaign(campaign.id)!).percentFunded).toBe(50);

    addPledge(campaign.id, { contributor: CONTRIBUTOR2, amount: 100 });
    expect(calculateProgress(getCampaign(campaign.id)!).percentFunded).toBe(100);
  });

  it('remainingAmount never goes below 0 when overfunded protection triggers', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'No negative remaining',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 50,
      deadline: future(),
    });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 50 });
    const updated = getCampaign(campaign.id)!;
    const progress = calculateProgress(updated);
    expect(progress.remainingAmount).toBeGreaterThanOrEqual(0);
  });

  it('hoursLeft is 0 (not negative) when deadline has passed', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Past deadline',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(3600), // 1 hour in the future
    });
    // Evaluate 2 hours AFTER the deadline → hoursLeft should be 0
    const evalAt = campaign.deadline + 7200;
    const progress = calculateProgress(campaign, evalAt);
    expect(progress.hoursLeft).toBe(0);
  });

  it('status is "claimed" when claimedAt is set regardless of pledged amount', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Claimed campaign',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 50,
      deadline: future(),
    });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 50 });
    // Move deadline to past so claimCampaign allows it
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), campaign.id);
    claimCampaign(campaign.id, {
      creator: CREATOR,
      transactionHash: TX_HASH,
    });
    const claimed = getCampaign(campaign.id)!;
    expect(claimed.claimedAt).toBeDefined();
    const progress = calculateProgress(claimed);
    expect(progress.status).toBe('claimed');
    expect(progress.canClaim).toBe(false);
    expect(progress.canRefund).toBe(false);
    expect(progress.canPledge).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createCampaign — validation mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('createCampaign – validation edge cases', () => {
  it('throws MAX_CAMPAIGN_DURATION_EXCEEDED when deadline > 180 days away', () => {
    const tooFar = future(60 * 60 * 24 * 181); // 181 days
    expect(() =>
      createCampaign({
        creator: CREATOR,
        title: 'Too far',
        description: 'desc',
        assetCode: 'USDC',
        targetAmount: 100,
        deadline: tooFar,
      }),
    ).toThrow('Campaign duration exceeds maximum');
  });

  it('does NOT throw when deadline is exactly 180 days away', () => {
    const exactly180 = future(60 * 60 * 24 * 180);
    expect(() =>
      createCampaign({
        creator: CREATOR,
        title: 'Exactly 180d',
        description: 'desc',
        assetCode: 'USDC',
        targetAmount: 100,
        deadline: exactly180,
      }),
    ).not.toThrow();
  });

  it('throws INVALID_INPUT when no tokens provided at all', () => {
    expect(() =>
      createCampaign({
        creator: CREATOR,
        title: 'No token',
        description: 'desc',
        targetAmount: 100,
        deadline: future(),
      } as any),
    ).toThrow('At least one accepted token is required');
  });

  it('normalizes acceptedTokens to uppercase and trims whitespace', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Token norm',
      description: 'desc',
      acceptedTokens: [' usdc ', ' xlm'],
      targetAmount: 100,
      deadline: future(),
    });
    expect(c.acceptedTokens).toEqual(['USDC', 'XLM']);
    expect(c.assetCode).toBe('USDC');
  });

  it('uses assetCode as fallback when acceptedTokens not provided', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'AssetCode fallback',
      description: 'desc',
      assetCode: 'xlm',
      targetAmount: 100,
      deadline: future(),
    });
    expect(c.acceptedTokens).toEqual(['XLM']);
    expect(c.assetCode).toBe('XLM');
  });

  it('rounds targetAmount to 2 decimal places', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Rounding',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 99.999,
      deadline: future(),
    });
    expect(c.targetAmount).toBe(100);
  });

  it('records a "created" event on campaign creation', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Event check',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 50,
      deadline: future(),
    });
    const history = getCampaignHistory(c.id);
    expect(history).toHaveLength(1);
    expect(history[0].eventType).toBe('created');
    expect(history[0].actor).toBe(CREATOR);
    expect(history[0].metadata?.targetAmount).toBe(50);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// addPledge — critical guard mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('addPledge – guard conditions', () => {
  it('throws NOT_FOUND for nonexistent campaign', () => {
    expect(() =>
      addPledge('nonexistent-99999', { contributor: CONTRIBUTOR, amount: 10 }),
    ).toThrow('Campaign not found');
  });

  it('throws INVALID_ASSET when pledging with a non-accepted token', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'USDC only',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    expect(() =>
      addPledge(c.id, {
        contributor: CONTRIBUTOR,
        amount: 10,
        assetCode: 'XLM',
      }),
    ).toThrow('is not accepted by this campaign');
  });

  it('throws INVALID_CAMPAIGN_STATE after deadline', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Expired',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    // Manually set deadline to past
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), c.id);
    expect(() =>
      addPledge(c.id, { contributor: CONTRIBUTOR, amount: 10 }),
    ).toThrow('Campaign is no longer accepting pledges');
  });

  it('throws CAMPAIGN_FUNDING_CAP_EXCEEDED when pledge would exceed target', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Cap exceeded',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    // First pledge fills 90
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 90 });
    // Second pledge of 11 would total 101 > 100
    expect(() =>
      addPledge(c.id, { contributor: CONTRIBUTOR2, amount: 11 }),
    ).toThrow('Pledge exceeds campaign funding cap');
  });

  it('allows pledge exactly at the remaining cap (not over)', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Exact cap',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 90 });
    // Should succeed (90 + 10 == 100)
    expect(() =>
      addPledge(c.id, { contributor: CONTRIBUTOR2, amount: 10 }),
    ).not.toThrow();
    expect(getCampaign(c.id)!.pledgedAmount).toBe(100);
  });

  it('throws MAX_PER_CONTRIBUTOR_EXCEEDED when contributor limit breached', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Contributor capped',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
      maxPerContributor: 50,
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50 });
    expect(() =>
      addPledge(c.id, { contributor: CONTRIBUTOR, amount: 1 }),
    ).toThrow('Pledge exceeds maximum allowed per contributor');
  });

  it('contributor limit is per-contributor, not global', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Per contrib limit',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
      maxPerContributor: 50,
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50 });
    // Different contributor can still pledge
    expect(() =>
      addPledge(c.id, { contributor: CONTRIBUTOR2, amount: 50 }),
    ).not.toThrow();
  });

  it('records a "pledged" event with correct amount and newTotalPledged', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Pledge event',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 75 });
    const history = getCampaignHistory(c.id);
    const pledgeEvent = history.find((e) => e.eventType === 'pledged');
    expect(pledgeEvent).toBeDefined();
    expect(pledgeEvent!.amount).toBe(75);
    expect(pledgeEvent!.actor).toBe(CONTRIBUTOR);
    expect(pledgeEvent!.metadata?.newTotalPledged).toBe(75);
  });

  it('correctly accumulates multiple pledges in pledgedAmount', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Accumulation',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 10.5 });
    addPledge(c.id, { contributor: CONTRIBUTOR2, amount: 20.5 });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 9 });
    expect(getCampaign(c.id)!.pledgedAmount).toBe(40);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// refundContributor — state and amount mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('refundContributor – state and amount conditions', () => {
  function failedCampaign() {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Failed campaign',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 100 });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50 });
    // Move deadline to past so canRefund = true
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), c.id);
    return c;
  }

  it('throws NOT_FOUND for nonexistent campaign', () => {
    expect(() => refundContributor('99999', CONTRIBUTOR)).toThrow('Campaign not found');
  });

  it('throws INVALID_CAMPAIGN_STATE when campaign is still open', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Open refund',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50 });
    expect(() => refundContributor(c.id, CONTRIBUTOR)).toThrow(
      'Refunds are not available for this campaign',
    );
  });

  it('throws NOT_FOUND when contributor has no refundable pledges', () => {
    const c = failedCampaign();
    expect(() => refundContributor(c.id, CONTRIBUTOR2)).toThrow('No refundable pledges found');
  });

  it('refunds the exact SUM of all active pledges', () => {
    const c = failedCampaign();
    const { refundedAmount } = refundContributor(c.id, CONTRIBUTOR);
    expect(refundedAmount).toBe(150); // 100 + 50
  });

  it('decrements pledgedAmount on campaign after refund', () => {
    const c = failedCampaign();
    refundContributor(c.id, CONTRIBUTOR);
    expect(getCampaign(c.id)!.pledgedAmount).toBe(0);
  });

  it('marks pledges as refunded (refundedAt set)', () => {
    const c = failedCampaign();
    refundContributor(c.id, CONTRIBUTOR);
    const pledges = getPledges(c.id);
    expect(pledges.every((p) => p.refundedAt !== undefined)).toBe(true);
  });

  it('records a "refunded" event with correct amount', () => {
    const c = failedCampaign();
    refundContributor(c.id, CONTRIBUTOR);
    const history = getCampaignHistory(c.id);
    const refundEvent = history.find((e) => e.eventType === 'refunded');
    expect(refundEvent).toBeDefined();
    expect(refundEvent!.amount).toBe(150);
    expect(refundEvent!.actor).toBe(CONTRIBUTOR);
  });

  it('prevents double-refund: second call throws NOT_FOUND', () => {
    const c = failedCampaign();
    refundContributor(c.id, CONTRIBUTOR);
    expect(() => refundContributor(c.id, CONTRIBUTOR)).toThrow('No refundable pledges found');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// claimCampaign — guard mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('claimCampaign – guards', () => {
  function fundedExpiredCampaign() {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Claim-ready',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 100 });
    // Set deadline to past
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), c.id);
    return c;
  }

  it('throws NOT_FOUND for nonexistent campaign', () => {
    expect(() =>
      claimCampaign('99999', { creator: CREATOR, transactionHash: TX_HASH }),
    ).toThrow('Campaign not found');
  });

  it('throws FORBIDDEN when non-creator tries to claim', () => {
    const c = fundedExpiredCampaign();
    expect(() =>
      claimCampaign(c.id, {
        creator: CONTRIBUTOR,
        transactionHash: TX_HASH,
      }),
    ).toThrow('Only the campaign creator can claim funds');
  });

  it('throws INVALID_CAMPAIGN_STATE when target not met', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Underfunded claim',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 100 });
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), c.id);
    expect(() =>
      claimCampaign(c.id, { creator: CREATOR, transactionHash: TX_HASH }),
    ).toThrow('Campaign cannot be claimed yet');
  });

  it('sets claimedAt and records "claimed" event', () => {
    const c = fundedExpiredCampaign();
    claimCampaign(c.id, { creator: CREATOR, transactionHash: TX_HASH });
    const claimed = getCampaign(c.id)!;
    expect(claimed.claimedAt).toBeDefined();
    const history = getCampaignHistory(c.id);
    const claimEvent = history.find((e) => e.eventType === 'claimed');
    expect(claimEvent).toBeDefined();
    expect(claimEvent!.blockchainMetadata?.txHash).toBe(TX_HASH);
  });

  it('second claim is idempotent (returns same claimedAt)', () => {
    const c = fundedExpiredCampaign();
    claimCampaign(c.id, { creator: CREATOR, transactionHash: TX_HASH });
    const first = getCampaign(c.id)!.claimedAt;
    claimCampaign(c.id, { creator: CREATOR, transactionHash: TX_HASH2 });
    expect(getCampaign(c.id)!.claimedAt).toBe(first);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// reconcileOnChainPledge — conflict and dedup mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('reconcileOnChainPledge – deduplication and conflict', () => {
  it('throws TRANSACTION_HASH_CONFLICT when same hash used for different campaign', () => {
    const c1 = createCampaign({
      creator: CREATOR,
      title: 'Campaign 1',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    const c2 = createCampaign({
      creator: CREATOR,
      title: 'Campaign 2',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    reconcileOnChainPledge(c1.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
    });
    expect(() =>
      reconcileOnChainPledge(c2.id, {
        contributor: CONTRIBUTOR,
        amount: 10,
        transactionHash: TX_HASH,
      }),
    ).toThrow('transactionHash already belongs to a different campaign');
  });

  it('is idempotent for same campaign and same tx hash', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Idempotent reconcile',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    reconcileOnChainPledge(c.id, {
      contributor: CONTRIBUTOR,
      amount: 20,
      transactionHash: TX_HASH,
    });
    reconcileOnChainPledge(c.id, {
      contributor: CONTRIBUTOR,
      amount: 20,
      transactionHash: TX_HASH,
    });
    expect(getCampaign(c.id)!.pledgedAmount).toBe(20);
    expect(getPledges(c.id)).toHaveLength(1);
  });

  it('marks the pledge with source "soroban" in blockchain metadata', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'On-chain source',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    reconcileOnChainPledge(c.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
    });
    const history = getCampaignHistory(c.id);
    const pledgeEvent = history.find((e) => e.eventType === 'pledged');
    expect(pledgeEvent?.blockchainMetadata?.source).toBe('soroban');
    expect(pledgeEvent?.blockchainMetadata?.txHash).toBe(TX_HASH);
    expect(pledgeEvent?.metadata?.onChain).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// eventHistory module — field mapping mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('eventHistory – field mapping and ordering', () => {
  it('recordEvent stores and retrieves all fields correctly', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Event fields',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    const ts = Math.floor(Date.now() / 1000);
    recordEvent(
      c.id,
      'pledged',
      ts,
      CONTRIBUTOR,
      99.5,
      { custom: 'value', count: 3 },
      { source: 'local', txHash: TX_HASH, ledgerNumber: 42 },
    );

    const history = getCampaignHistory(c.id);
    const evt = history.find((e) => e.eventType === 'pledged');
    expect(evt).toBeDefined();
    expect(evt!.campaignId).toBe(c.id);
    expect(evt!.timestamp).toBe(ts);
    expect(evt!.actor).toBe(CONTRIBUTOR);
    expect(evt!.amount).toBe(99.5);
    expect(evt!.metadata?.custom).toBe('value');
    expect(evt!.metadata?.count).toBe(3);
    expect(evt!.blockchainMetadata?.source).toBe('local');
    expect(evt!.blockchainMetadata?.txHash).toBe(TX_HASH);
    expect(evt!.blockchainMetadata?.ledgerNumber).toBe(42);
  });

  it('getCampaignHistory returns events in ascending timestamp/id order', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Ordered events',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    const now = Math.floor(Date.now() / 1000);
    recordEvent(c.id, 'pledged', now + 10, CONTRIBUTOR, 10, {}, { source: 'local' });
    recordEvent(c.id, 'pledged', now + 5, CONTRIBUTOR2, 20, {}, { source: 'local' });

    const history = getCampaignHistory(c.id);
    // Filter out created event
    const pledges = history.filter((e) => e.eventType === 'pledged');
    expect(pledges[0].timestamp).toBeLessThanOrEqual(pledges[1].timestamp);
  });

  it('records event with undefined actor/amount as undefined in result', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Null fields',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    recordEvent(c.id, 'updated', Math.floor(Date.now() / 1000));
    const history = getCampaignHistory(c.id);
    const updatedEvent = history.find((e) => e.eventType === 'updated');
    expect(updatedEvent!.actor).toBeUndefined();
    expect(updatedEvent!.amount).toBeUndefined();
    expect(updatedEvent!.metadata).toBeUndefined();
    expect(updatedEvent!.blockchainMetadata).toBeUndefined();
  });

  it('getEventByTxHash returns the matching event', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'TxHash lookup',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    reconcileOnChainPledge(c.id, {
      contributor: CONTRIBUTOR,
      amount: 25,
      transactionHash: TX_HASH,
    });
    const found = getEventByTxHash(TX_HASH);
    expect(found).toBeDefined();
    expect(found!.blockchainMetadata?.txHash).toBe(TX_HASH);
  });

  it('getEventByTxHash returns undefined for unknown hash', () => {
    expect(getEventByTxHash('nonexistent'.repeat(5))).toBeUndefined();
  });

  it('getEventsByLedger returns events for a given ledger', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Ledger events',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    const ts = Math.floor(Date.now() / 1000);
    recordEvent(c.id, 'pledged', ts, CONTRIBUTOR, 10, {}, {
      source: 'soroban',
      ledgerNumber: 777,
      eventIndex: 0,
    });
    const results = getEventsByLedger(777);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].blockchainMetadata?.ledgerNumber).toBe(777);
  });

  it('getEventsBySource returns only events from specified source', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Source filter',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: future(),
    });
    const ts = Math.floor(Date.now() / 1000);
    recordEvent(c.id, 'pledged', ts, CONTRIBUTOR, 10, {}, { source: 'soroban' });
    recordEvent(c.id, 'pledged', ts + 1, CONTRIBUTOR2, 5, {}, { source: 'local' });
    const sorobanEvents = getEventsBySource('soroban');
    expect(sorobanEvents.every((e) => e.blockchainMetadata?.source === 'soroban')).toBe(true);
    const localEvents = getEventsBySource('local');
    expect(localEvents.every((e) => e.blockchainMetadata?.source === 'local')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getGlobalStats — status counting mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('getGlobalStats – status bucket counting', () => {
  it('counts open campaign correctly', () => {
    createCampaign({
      creator: CREATOR,
      title: 'Open',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    const stats = getGlobalStats();
    expect(stats.totalCampaigns).toBeGreaterThanOrEqual(1);
    expect(stats.campaignCountByStatus.open).toBeGreaterThanOrEqual(1);
  });

  it('counts failed campaign correctly', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Failed',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 10 });
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), c.id);
    const stats = getGlobalStats();
    expect(stats.campaignCountByStatus.failed).toBeGreaterThanOrEqual(1);
  });

  it('totalPledgedAmount sums all non-refunded pledges', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Stats amount',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 30 });
    addPledge(c.id, { contributor: CONTRIBUTOR2, amount: 20 });
    const stats = getGlobalStats();
    expect(stats.totalPledgedAmount).toBeGreaterThanOrEqual(50);
  });

  it('totalContributors counts distinct contributors', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Unique contributors',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 10 });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 10 }); // same contributor
    addPledge(c.id, { contributor: CONTRIBUTOR2, amount: 10 }); // different
    const stats = getGlobalStats();
    expect(stats.totalContributors).toBeGreaterThanOrEqual(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getContributorSummary — isFullyRefunded flag mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('getContributorSummary – isFullyRefunded flag', () => {
  it('isFullyRefunded is false when contributor has active pledges', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Active pledge',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50 });
    const summary = getContributorSummary(c.id);
    const entry = summary.find((s) => s.contributor === CONTRIBUTOR);
    expect(entry?.isFullyRefunded).toBe(false);
  });

  it('isFullyRefunded is true when all pledges are refunded', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Refunded all',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50 });
    getDb()
      .prepare('UPDATE campaigns SET deadline = ? WHERE id = ?')
      .run(past(), c.id);
    refundContributor(c.id, CONTRIBUTOR);
    const summary = getContributorSummary(c.id);
    const entry = summary.find((s) => s.contributor === CONTRIBUTOR);
    expect(entry?.isFullyRefunded).toBe(true);
    expect(entry?.totalPledged).toBe(0);
    expect(entry?.refundedAmount).toBe(50);
  });

  it('returns empty array for nonexistent campaign', () => {
    expect(getContributorSummary('999999')).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// softDeleteCampaign — deletion guard mutations
// ═════════════════════════════════════════════════════════════════════════════
describe('softDeleteCampaign – guard mutations', () => {
  it('throws NOT_FOUND for nonexistent campaign', () => {
    expect(() => softDeleteCampaign('99999')).toThrow('Campaign not found');
  });

  it('throws ALREADY_DELETED on double delete', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Soft delete double',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    softDeleteCampaign(c.id);
    expect(() => softDeleteCampaign(c.id)).toThrow('Campaign already soft-deleted');
  });

  it('excludes soft-deleted campaigns from listCampaigns by default', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Deleted campaign',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    softDeleteCampaign(c.id);
    const { campaigns } = listCampaigns();
    expect(campaigns.find((x) => x.id === c.id)).toBeUndefined();
  });

  it('includes soft-deleted campaigns when includeDeleted=true', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Deleted visible',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: future(),
    });
    softDeleteCampaign(c.id);
    const { campaigns } = listCampaigns({ includeDeleted: true });
    expect(campaigns.find((x) => x.id === c.id)).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// pledge_limit_reached event — milestone event mutation
// ═════════════════════════════════════════════════════════════════════════════
describe('pledge_limit_reached event emission', () => {
  it('records pledge_limit_reached event when contributor hits maxPerContributor', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Limit event',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
      maxPerContributor: 60,
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 60 });
    const history = getCampaignHistory(c.id);
    const limitEvent = history.find((e) => e.eventType === 'pledge_limit_reached');
    expect(limitEvent).toBeDefined();
    expect(limitEvent!.actor).toBe(CONTRIBUTOR);
    expect(limitEvent!.amount).toBe(60);
    expect(limitEvent!.metadata?.maxPerContributor).toBe(60);
  });

  it('does NOT emit pledge_limit_reached when contributor is below limit', () => {
    const c = createCampaign({
      creator: CREATOR,
      title: 'Below limit',
      description: 'desc',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
      maxPerContributor: 100,
    });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 40 });
    const history = getCampaignHistory(c.id);
    expect(history.find((e) => e.eventType === 'pledge_limit_reached')).toBeUndefined();
  });
});
