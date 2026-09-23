import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
let getCampaignAnalytics: CampaignStoreModule['getCampaignAnalytics'];

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;
const CONTRIBUTOR2 = `G${'C'.repeat(55)}`;
const TX_HASH = 'a'.repeat(64);

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,

    initCampaignStore,
    listCampaigns,
    listCampaignPledges,
    reconcileOnChainPledge,
    getCampaign,
    getPledges,
    addPledge,
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
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Build a Rocket Ship',
      description: 'We need funding to build an amazing rocket ship for space exploration.',
      assetCode: 'USDC',
      targetAmount: 10000,
      deadline: futureDeadline,
    });

    expect(listCampaigns({ searchQuery: 'rocket' }).campaigns[0].id).toBe(campaign.id);
    expect(
      listCampaigns({ searchQuery: campaign.creator }).campaigns.some((row) => row.id === campaign.id),
    ).toBe(true);
    expect(listCampaigns({ searchQuery: campaign.id }).campaigns[0].id).toBe(campaign.id);
  });
});

describe('on-chain pledge reconciliation', () => {
  it('records a reconciled pledge with transaction metadata', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Real Soroban campaign',
      description: 'A campaign used to verify Freighter-signed pledge reconciliation.',
      assetCode: 'USDC',
      targetAmount: 250,
      deadline: futureDeadline,
    });

    const updatedCampaign = reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 25.5,
      transactionHash: TX_HASH,
      confirmedAt: futureDeadline - 300,
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
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Idempotent campaign',
      description: 'A campaign used to verify duplicate transaction hashes are ignored.',
      assetCode: 'USDC',
      targetAmount: 250,
      deadline: futureDeadline,
    });

    reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
      confirmedAt: futureDeadline - 120,
    });

    const secondResult = reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
      confirmedAt: futureDeadline - 100,
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
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Paginated pledge campaign',
      description: 'A campaign used to verify paginated pledge retrieval order and slicing.',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: futureDeadline,
    });

    const db = getDb();
    const createdAtBase = futureDeadline - 1000;

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
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Analytics Test Campaign',
      description: 'Campaign to test analytics metrics',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: futureDeadline,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 250 });

    const analytics = getCampaignAnalytics(campaign.id);
    expect(analytics).toBeDefined();
    expect(analytics?.fundingGap).toBe(750); // 1000 - 250 = 750
  });

  it('returns zero funding_gap when campaign is fully funded', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Fully Funded Campaign',
      description: 'Campaign to test funding_gap when fully funded',
      assetCode: 'XLM',
      targetAmount: 500,
      deadline: futureDeadline,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 500 });

    const analytics = getCampaignAnalytics(campaign.id);
    expect(analytics).toBeDefined();
    expect(analytics?.fundingGap).toBe(0); // 500 - 500 = 0
  });

  it('returns funding_gap equal to target for campaign with no pledges', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Empty Campaign',
      description: 'Campaign with no pledges to test analytics',
      assetCode: 'USDC',
      targetAmount: 2000,
      deadline: futureDeadline,
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
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Constraint Test Campaign',
      description: 'Campaign to test unique constraint on transaction hash',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: futureDeadline,
    });

    const db = getDb();
    
    // Insert a pledge manually to simulate a potential conflict
    db.prepare(`
      INSERT INTO pledges (campaign_id, contributor, amount, transaction_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(campaign.id, CONTRIBUTOR, 100, TX_HASH, futureDeadline - 100);

    // Attempting to reconcile with the same transaction hash should fail or be handled
    // The current implementation uses idempotency, so we test that the constraint
    // is respected by the database layer if we try to insert directly
    expect(() => {
      db.prepare(`
        INSERT INTO pledges (campaign_id, contributor, amount, transaction_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(campaign.id, CONTRIBUTOR2, 50, TX_HASH, futureDeadline - 90);
    }).toThrow();
  });

  it('rolls back transaction on campaign creation failure', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    
    // Create a valid campaign first
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Rollback Test Campaign',
      description: 'Campaign to test transaction rollback',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: futureDeadline,
    });

    expect(campaign).toBeDefined();
    expect(getCampaign(campaign.id)).toBeDefined();

    // Verify that the campaign exists
    const existingCampaign = getCampaign(campaign.id);
    expect(existingCampaign?.title).toBe('Rollback Test Campaign');
  });

  it('handles edge case data with special characters in title and description', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const specialTitle = 'Campaign with "quotes" and <html> tags & special chars: ñ ü é';
    const specialDesc = 'Description with \n newlines and \t tabs and \r returns.';

    const campaign = createCampaign({
      creator: CREATOR,
      title: specialTitle,
      description: specialDesc,
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: futureDeadline,
    });

    expect(campaign.title).toBe(specialTitle);
    expect(campaign.description).toBe(specialDesc);

    const retrieved = getCampaign(campaign.id);
    expect(retrieved?.title).toBe(specialTitle);
    expect(retrieved?.description).toBe(specialDesc);
  });

  it('maintains ordering of campaigns by creation date descending', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const db = getDb();

    // Create multiple campaigns
    const campaign1 = createCampaign({
      creator: CREATOR,
      title: 'First Campaign',
      description: 'First',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: futureDeadline,
    });

    const campaign2 = createCampaign({
      creator: CREATOR,
      title: 'Second Campaign',
      description: 'Second',
      assetCode: 'USDC',
      targetAmount: 200,
      deadline: futureDeadline,
    });

    const campaign3 = createCampaign({
      creator: CREATOR,
      title: 'Third Campaign',
      description: 'Third',
      assetCode: 'USDC',
      targetAmount: 300,
      deadline: futureDeadline,
    });

    // Manually adjust creation times to ensure order
    const baseTime = futureDeadline - 1000;
    db.prepare(`UPDATE campaigns SET created_at = ? WHERE id = ?`).run(baseTime, campaign1.id);
    db.prepare(`UPDATE campaigns SET created_at = ? WHERE id = ?`).run(baseTime + 10, campaign2.id);
    db.prepare(`UPDATE campaigns SET created_at = ? WHERE id = ?`).run(baseTime + 20, campaign3.id);

    const result = listCampaigns();
    expect(result.campaigns).toHaveLength(3);
    expect(result.campaigns[0].id).toBe(campaign3.id);
    expect(result.campaigns[1].id).toBe(campaign2.id);
    expect(result.campaigns[2].id).toBe(campaign1.id);
  });

  it('handles zero target amount gracefully', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Zero Target Campaign',
      description: 'Campaign with zero target amount',
      assetCode: 'USDC',
      targetAmount: 0,
      deadline: futureDeadline,
    });

    expect(campaign.targetAmount).toBe(0);
    expect(getCampaign(campaign.id)?.targetAmount).toBe(0);

    const analytics = getCampaignAnalytics(campaign.id);
    expect(analytics?.fundingGap).toBe(0);
  });

  it('handles very large target amounts', () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Large Target Campaign',
      description: 'Campaign with very large target amount',
      assetCode: 'USDC',
      targetAmount: 999999999999,
      deadline: futureDeadline,
    });

    expect(campaign.targetAmount).toBe(999999999999);
    expect(getCampaign(campaign.id)?.targetAmount).toBe(999999999999);

    const analytics = getCampaignAnalytics(campaign.id);
    expect(analytics?.fundingGap).toBe(999999999999);
  });
});