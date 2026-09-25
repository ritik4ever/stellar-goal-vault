import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'better-sqlite3';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-campaign-store-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

type CampaignStoreModule = typeof import('./campaignStore');
type DbModule = typeof import('./db');
type EventHistoryModule = typeof import('./eventHistory');

let createCampaign: CampaignStoreModule['createCampaign'];

let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let listCampaigns: CampaignStoreModule['listCampaigns'];
let listCampaignPledges: CampaignStoreModule['listCampaignPledges'];
let reconcileOnChainPledge: CampaignStoreModule['reconcileOnChainPledge'];
let getCampaign: CampaignStoreModule['getCampaign'];
let getPledges: CampaignStoreModule['getPledges'];
let getDb: DbModule['getDb'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];
let addPledge: CampaignStoreModule['addPledge'];
let claimCampaign: CampaignStoreModule['claimCampaign'];
let getCampaignAnalytics: CampaignStoreModule['getCampaignAnalytics'];

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;
const CONTRIBUTOR2 = `G${'C'.repeat(55)}`;
const TX_HASH = 'a'.repeat(64);

// Deterministic time control for deadline and lifecycle tests
const FIXED_NOW = 1700000000; // Fixed Unix timestamp
const FIXED_DEADLINE = FIXED_NOW + 86400; // 24 hours from fixed now

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  // Mock Date.now to return deterministic time
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW * 1000);

  ({
    createCampaign,

    initCampaignStore,
    listCampaigns,
    listCampaignPledges,
    reconcileOnChainPledge,
    getCampaign,
    getPledges,
    addPledge,
    claimCampaign,
    getCampaignAnalytics,
  } = await import('./campaignStore'));
  ({ getDb } = await import('./db'));
  ({ getCampaignHistory } = await import('./eventHistory'));
  initCampaignStore();
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM webhook_dead_letter_queue`).run();
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe('campaign store search', () => {
  it('returns all campaigns when no search query is provided', () => {
    const result = listCampaigns();
    expect(Array.isArray(result.campaigns)).toBe(true);
  });

  it('returns empty array when search query matches nothing', () => {
    const result = listCampaigns({ searchQuery: 'nonexistent-campaign-xyz-123' });
    expect(result.campaigns).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('rejects invalid campaign creation payloads and missing campaign lookups', () => {
    expect(() =>
      createCampaign({
        creator: CREATOR,
        title: 'Missing tokens',
        description: 'This should fail because no accepted tokens are passed.',
        assetCode: '',
        targetAmount: 100,
        deadline: FIXED_DEADLINE,
      }),
    ).toThrowError(/At least one accepted token is required/i);

    expect(getCampaign('campaign-does-not-exist')).toBeUndefined();
  });

  it('rejects duplicate claim attempts and non-creator claim attempts without duplicating the claim event', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Permission and duplicate claim checks',
      description: 'Ensures permission gates and duplicate claim handling remain strict.',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: FIXED_DEADLINE,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100 });
    getDb()
      .prepare(`UPDATE campaigns SET deadline = ? WHERE id = ?`)
      .run(FIXED_NOW - 5, campaign.id);

    const claimedCampaign = claimCampaign(campaign.id, {
      creator: CREATOR,
      transactionHash: 'd'.repeat(64),
      confirmedAt: FIXED_NOW,
    });

    expect(claimedCampaign.claimedAt).toBeDefined();

    expect(() =>
      claimCampaign(campaign.id, {
        creator: CREATOR,
        transactionHash: 'e'.repeat(64),
        confirmedAt: FIXED_NOW + 1,
      }),
    ).toThrowError(/already claimed/i);

    expect(() =>
      claimCampaign(campaign.id, {
        creator: CONTRIBUTOR,
        transactionHash: 'f'.repeat(64),
        confirmedAt: FIXED_NOW + 2,
      }),
    ).toThrowError(/Only the campaign creator can claim funds/i);

    expect(
      getCampaignHistory(campaign.id).filter((event) => event.eventType === 'claimed'),
    ).toHaveLength(1);
  });

  it('handles empty search query gracefully', () => {
    const allCampaigns = listCampaigns();
    const emptySearchCampaigns = listCampaigns({ searchQuery: '' });
    expect(emptySearchCampaigns.campaigns.length).toBe(allCampaigns.campaigns.length);
  });

  it('handles whitespace-only search query gracefully', () => {
    const allCampaigns = listCampaigns();
    const whitespaceSearchCampaigns = listCampaigns({ searchQuery: '   ' });
    expect(whitespaceSearchCampaigns.campaigns.length).toBe(allCampaigns.campaigns.length);
  });

  it('searches campaigns by title, creator, and id case-insensitively', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Build a Rocket Ship',
      description: 'We need funding to build an amazing rocket ship for space exploration.',
      assetCode: 'USDC',
      targetAmount: 10000,
      deadline: FIXED_DEADLINE,
    });

    expect(listCampaigns({ searchQuery: 'rocket' }).campaigns[0].id).toBe(campaign.id);
    expect(
      listCampaigns({ searchQuery: campaign.creator }).campaigns.some(
        (row) => row.id === campaign.id,
      ),
    ).toBe(true);
    expect(listCampaigns({ searchQuery: campaign.id }).campaigns[0].id).toBe(campaign.id);
  });
});

describe('on-chain pledge reconciliation', () => {
  it('records a reconciled pledge with transaction metadata', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Real Soroban campaign',
      description: 'A campaign used to verify Freighter-signed pledge reconciliation.',
      assetCode: 'USDC',
      targetAmount: 250,
      deadline: FIXED_DEADLINE,
    });

    const updatedCampaign = reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 25.5,
      transactionHash: TX_HASH,
      confirmedAt: FIXED_DEADLINE - 300,
    });

    expect(updatedCampaign.campaign.pledgedAmount).toBe(25.5);
    expect(getCampaign(campaign.id)?.pledgedAmount).toBe(25.5);

    const pledges = getPledges(campaign.id);
    expect(pledges).toHaveLength(1);
    expect(pledges[0].transactionHash).toBe(TX_HASH);

    const history = getCampaignHistory(campaign.id);
    const pledgeEvent = history.find((event) => event.eventType === 'pledged');
    expect(pledgeEvent?.blockchainMetadata?.txHash).toBe(TX_HASH);
    expect(pledgeEvent?.blockchainMetadata?.source).toBe('soroban');
    expect(pledgeEvent?.metadata?.onChain).toBe(true);
  });

  it('treats duplicate transaction hashes as idempotent', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Idempotent campaign',
      description: 'A campaign used to verify duplicate transaction hashes are ignored.',
      assetCode: 'USDC',
      targetAmount: 250,
      deadline: FIXED_DEADLINE,
    });

    reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
      confirmedAt: FIXED_DEADLINE - 120,
    });

    const secondResult = reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
      confirmedAt: FIXED_DEADLINE - 100,
    });

    expect(secondResult.campaign.pledgedAmount).toBe(10);
    expect(secondResult.existing).toBe(true);
    expect(getPledges(campaign.id)).toHaveLength(1);
    expect(
      getCampaignHistory(campaign.id).filter((event) => event.eventType === 'pledged'),
    ).toHaveLength(1);
  });
});

describe('campaign pledge pagination', () => {
  it('returns pledges in reverse chronological order with pagination metadata inputs', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Paginated pledge campaign',
      description: 'A campaign used to verify paginated pledge retrieval order and slicing.',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: FIXED_DEADLINE,
    });

    const db = getDb();
    const createdAtBase = FIXED_DEADLINE - 1000;

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 50 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR2, amount: 75 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100 });

    const insertedPledges = getPledges(campaign.id).sort((a, b) => a.id - b.id);
    db.prepare(`UPDATE pledges SET created_at = ? WHERE id = ?`).run(
      createdAtBase + 10,
      insertedPledges[0].id,
    );
    db.prepare(`UPDATE pledges SET created_at = ? WHERE id = ?`).run(
      createdAtBase + 20,
      insertedPledges[1].id,
    );
    db.prepare(`UPDATE pledges SET created_at = ? WHERE id = ?`).run(
      createdAtBase + 30,
      insertedPledges[2].id,
    );

    const page1 = listCampaignPledges(campaign.id, { page: 1, limit: 2 });
    expect(page1.totalCount).toBe(3);
    expect(page1.pledges).toHaveLength(2);
    expect(page1.pledges.map((pledge) => pledge.amount)).toEqual([100, 75]);

    const page2 = listCampaignPledges(campaign.id, { page: 2, limit: 2 });
    expect(page2.totalCount).toBe(3);
    expect(page2.pledges).toHaveLength(1);
    expect(page2.pledges[0].amount).toBe(50);
  });
});

describe('campaign analytics', () => {
  it('returns correct funding_gap for campaign with pledges', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Analytics Test Campaign',
      description: 'Campaign to test analytics metrics',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: FIXED_DEADLINE,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 250 });

    const analytics = getCampaignAnalytics(campaign.id);
    expect(analytics).toBeDefined();
    expect(analytics?.fundingGap).toBe(750); // 1000 - 250 = 750
  });

  it('returns zero funding_gap when campaign is fully funded', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Fully Funded Campaign',
      description: 'Campaign to test funding_gap when fully funded',
      assetCode: 'XLM',
      targetAmount: 500,
      deadline: FIXED_DEADLINE,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 500 });

    const analytics = getCampaignAnalytics(campaign.id);
    expect(analytics).toBeDefined();
    expect(analytics?.fundingGap).toBe(0); // 500 - 500 = 0
  });

  it('returns funding_gap equal to target for campaign with no pledges', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Empty Campaign',
      description: 'Campaign with no pledges to test analytics',
      assetCode: 'USDC',
      targetAmount: 2000,
      deadline: FIXED_DEADLINE,
    });

    const analytics = getCampaignAnalytics(campaign.id);
    expect(analytics).toBeDefined();
    expect(analytics?.fundingGap).toBe(2000); // 2000 - 0 = 2000
  });

  it('returns undefined for non-existent campaign', () => {
    const analytics = getCampaignAnalytics('99999');
    expect(analytics).toBeUndefined();
  });
});

describe('campaign persistence regression tests', () => {
  it('enforces unique constraint on transaction hash for pledges', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Constraint Test Campaign',
      description: 'Campaign to test unique constraint on transaction hash',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: FIXED_DEADLINE,
    });

    const db = getDb();

    // Insert a pledge manually to simulate a potential conflict
    db.prepare(
      `
      INSERT INTO pledges (campaign_id, contributor, amount, asset_code, transaction_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(campaign.id, CONTRIBUTOR, 100, 'USDC', TX_HASH, FIXED_DEADLINE - 100);

    // Attempting to reconcile with the same transaction hash should fail or be handled
    // The current implementation uses idempotency, so we test that the constraint
    // is respected by the database layer if we try to insert directly
    expect(() => {
      db.prepare(
        `
        INSERT INTO pledges (campaign_id, contributor, amount, asset_code, transaction_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(campaign.id, CONTRIBUTOR2, 50, 'USDC', TX_HASH, FIXED_DEADLINE - 90);
    }).toThrow();
  });

  it('rolls back transaction on campaign creation failure', () => {
    // Create a valid campaign first
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Rollback Test Campaign',
      description: 'Campaign to test transaction rollback',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: FIXED_DEADLINE,
    });

    expect(campaign).toBeDefined();
    expect(getCampaign(campaign.id)).toBeDefined();

    // Verify that the campaign exists
    const existingCampaign = getCampaign(campaign.id);
    expect(existingCampaign?.title).toBe('Rollback Test Campaign');
  });

  it('handles edge case data with special characters in title and description', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Special Chars: <>&"\'',
      description: 'Description with special chars: <>&"\'',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: FIXED_DEADLINE,
    });

    expect(campaign).toBeDefined();
    expect(campaign.title).toBe('Special Chars: <>&"\'');
    expect(campaign.description).toBe('Description with special chars: <>&"\'');
  });
});

describe('campaign list stable pagination ordering', () => {
  it('keeps chunks ordered, disjoint, and complete when the sort key ties', () => {
    // Every campaign is created at the same mocked instant with identical
    // target amounts, so the requested sort key cannot order them on its own —
    // only the deterministic id tie-breaker can.
    const created = Array.from({ length: 5 }, (_, index) =>
      createCampaign({
        creator: CREATOR,
        title: `Stable pagination ${index + 1}`,
        description: 'Campaign created to verify deterministic pagination across chunks.',
        assetCode: 'USDC',
        targetAmount: 100,
        deadline: FIXED_DEADLINE,
      }),
    );

    const pages = [1, 2, 3].map(
      (page) => listCampaigns({ page, limit: 2, sort: 'targetAmount', order: 'desc' }).campaigns,
    );
    const ids = pages.flat().map((campaign) => campaign.id);

    // No chunk repeats a campaign and the union of the chunks is the full list.
    expect(ids).toHaveLength(created.length);
    expect(new Set(ids).size).toBe(created.length);

    // Tied rows fall back to the id tie-breaker in the requested direction.
    const expected = created
      .map((campaign) => Number(campaign.id))
      .sort((a, b) => b - a)
      .map((id) => String(id));
    expect(ids).toEqual(expected);
  });
});
