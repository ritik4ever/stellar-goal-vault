import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-campaign-filters-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

type IndexModule = typeof import('./index');
type CampaignStoreModule = typeof import('./services/campaignStore');
type DbModule = typeof import('./services/db');
type ValidationModule = typeof import('./validation/schemas');

let listCampaigns: CampaignStoreModule['listCampaigns'];
let parseCampaignListFilters: IndexModule['parseCampaignListFilters'];
let parseCampaignListQuery: ValidationModule['parseCampaignListQuery'];
let createCampaign: CampaignStoreModule['createCampaign'];
let addPledge: CampaignStoreModule['addPledge'];
let calculateProgress: CampaignStoreModule['calculateProgress'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let getDb: DbModule['getDb'];

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ parseCampaignListFilters } = await import('./index'));
  ({ getDb } = await import('./services/db'));
  ({ parseCampaignListQuery } = await import('./validation/schemas'));
  ({ initCampaignStore, listCampaigns, createCampaign, addPledge, calculateProgress } =
    await import('./services/campaignStore'));
  initCampaignStore();
}, 20000);

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

function createCampaignFixtures() {
  const now = Math.floor(Date.now() / 1000);

  const openUsdc = createCampaign({
    creator: CREATOR,
    title: 'Open USDC Campaign',
    description: 'Open USDC campaign for checking unfiltered and asset-filtered results.',
    assetCode: 'USDC',
    targetAmount: 150,
    deadline: now + 3600,
  });

  const fundedUsdcCampaign = createCampaign({
    creator: CREATOR,
    title: 'Funded USDC Campaign',
    description: 'Funded USDC campaign that should match combined asset and status filters.',
    assetCode: 'usdc',
    targetAmount: 100,
    deadline: now + 7200,
  });
  const fundedUsdc = addPledge(fundedUsdcCampaign.id, { contributor: CONTRIBUTOR, amount: 100 });

  const fundedXlmCampaign = createCampaign({
    creator: CREATOR,
    title: 'Funded XLM Campaign',
    description: 'Funded XLM campaign that should be excluded when asset is filtered to USDC.',
    assetCode: 'XLM',
    targetAmount: 75,
    deadline: now + 7200,
  });
  const fundedXlm = addPledge(fundedXlmCampaign.id, { contributor: CONTRIBUTOR, amount: 75 });

  const failedUsdc = createCampaign({
    creator: CREATOR,
    title: 'Failed USDC Campaign',
    description: 'Failed USDC campaign with a past deadline to exercise status-based filtering.',
    assetCode: 'USDC',
    targetAmount: 200,
    deadline: now - 60,
  });

  const claimedUsdcCampaign = createCampaign({
    creator: CREATOR,
    title: 'Claimed USDC Campaign',
    description: 'Claimed USDC campaign to ensure other statuses are still returned correctly.',
    assetCode: 'USDC',
    targetAmount: 50,
    deadline: now + 7200,
  });
  const claimedUsdcFunded = addPledge(claimedUsdcCampaign.id, {
    contributor: CONTRIBUTOR,
    amount: 50,
  });
  getDb()
    .prepare(`UPDATE campaigns SET claimed_at = ? WHERE id = ?`)
    .run(now, claimedUsdcFunded.id);

  const claimedUsdc = {
    ...claimedUsdcFunded,
    claimedAt: now,
  };

  return { openUsdc, fundedUsdc, fundedXlm, failedUsdc, claimedUsdc };
}

function buildCampaignList() {
  const fixtures = createCampaignFixtures();
  const campaigns = Object.values(fixtures).map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign),
  }));

  return { fixtures, campaigns };
}

describe('campaign list filters and pagination', () => {
  it('filters campaigns by asset code case-insensitively via SQL', () => {
    const { fixtures } = buildCampaignList();

    const filters = parseCampaignListFilters({ asset: 'usdc' });
    const { campaigns: filtered } = listCampaigns({
      ...filters,
      assetCode: filters.asset,
      page: 1,
      limit: 10,
    });

    expect(filtered).toHaveLength(4);
    expect(filtered.map((campaign) => campaign.id).sort()).toEqual(
      [
        fixtures.openUsdc.id,
        fixtures.fundedUsdc.id,
        fixtures.failedUsdc.id,
        fixtures.claimedUsdc.id,
      ].sort(),
    );
    expect(filtered.every((campaign) => campaign.assetCode === 'USDC')).toBe(true);
  });

  it('handles pagination correctly', () => {
    buildCampaignList(); // creates 5 campaigns

    const page1 = listCampaigns({ page: 1, limit: 2 });
    expect(page1.campaigns).toHaveLength(2);
    expect(page1.totalCount).toBe(5);

    const page2 = listCampaigns({ page: 2, limit: 2 });
    expect(page2.campaigns).toHaveLength(2);
    expect(page2.totalCount).toBe(5);

    const page3 = listCampaigns({ page: 3, limit: 2 });
    expect(page3.campaigns).toHaveLength(1);
    expect(page3.totalCount).toBe(5);

    // Verify disjoint sets
    const ids1 = page1.campaigns.map((c) => c.id);
    const ids2 = page2.campaigns.map((c) => c.id);
    const ids3 = page3.campaigns.map((c) => c.id);

    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    expect(ids2.some((id) => ids3.includes(id))).toBe(false);
  });

  it('combines status and asset filtering correctly via SQL', () => {
    const { fixtures } = buildCampaignList();

    const filters = parseCampaignListFilters({ asset: 'UsDc', status: 'FuNdEd' });
    const { campaigns: filtered } = listCampaigns({
      ...filters,
      assetCode: filters.asset,
      page: 1,
      limit: 10,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(fixtures.fundedUsdc.id);
    expect(filtered[0].assetCode).toBe('USDC');
  });

  it('filters campaigns by multiple asset codes (createdAfter/createdBefore)', () => {
    const now = Math.floor(Date.now() / 1000);

    const campaign1 = createCampaign({
      creator: CREATOR,
      title: 'Campaign 1',
      description: 'Created earlier',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: now + 3600,
    });

    // Simulate campaign created at earlier time by directly updating DB
    getDb()
      .prepare(`UPDATE campaigns SET created_at = ? WHERE id = ?`)
      .run(now - 86400, campaign1.id);

    const campaign2 = createCampaign({
      creator: CREATOR,
      title: 'Campaign 2',
      description: 'Created now',
      acceptedTokens: ['USDC', 'XLM'],
      targetAmount: 100,
      deadline: now + 3600,
    });

    // Test createdAfter filter
    const afterFilter = listCampaigns({
      createdAfter: now - 3600,
      page: 1,
      limit: 10,
    });
    expect(afterFilter.campaigns.map(c => c.id)).toContain(campaign2.id);
    expect(afterFilter.campaigns.map(c => c.id)).not.toContain(campaign1.id);

    // Test createdBefore filter
    const beforeFilter = listCampaigns({
      createdBefore: now - 43200,
      page: 1,
      limit: 10,
    });
    expect(beforeFilter.campaigns.map(c => c.id)).toContain(campaign1.id);
    expect(beforeFilter.campaigns.map(c => c.id)).not.toContain(campaign2.id);
  });

  it('filters campaigns by multiple asset codes', () => {
    const now = Math.floor(Date.now() / 1000);

    const xlmCampaign = createCampaign({
      creator: CREATOR,
      title: 'XLM Campaign',
      description: 'Test',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline: now + 3600,
    });

    const usdcCampaign = createCampaign({
      creator: CREATOR,
      title: 'USDC Campaign',
      description: 'Test',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: now + 3600,
    });

    const multiCampaign = createCampaign({
      creator: CREATOR,
      title: 'Multi Token Campaign',
      description: 'Test',
      acceptedTokens: ['USDC', 'XLM'],
      targetAmount: 100,
      deadline: now + 3600,
    });

    // Filter by multiple asset codes (XLM OR USDC)
    const filtered = listCampaigns({
      assetCodes: ['XLM', 'USDC'],
      page: 1,
      limit: 10,
    });

    const ids = filtered.campaigns.map(c => c.id);
    expect(ids).toContain(xlmCampaign.id);
    expect(ids).toContain(usdcCampaign.id);
    expect(ids).toContain(multiCampaign.id);
    expect(filtered.campaigns).toHaveLength(3);
  });
});

describe('Query parameter validation', () => {
  it('validates invalid page parameter', () => {
    const result = parseCampaignListQuery({ page: 'invalid', limit: '10' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(issue => issue.path.includes('page'))).toBe(true);
    }
  });

  it('validates invalid limit parameter', () => {
    const result = parseCampaignListQuery({ page: '1', limit: '999' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(issue => issue.path.includes('limit'))).toBe(true);
    }
  });

  it('validates invalid asset parameter', () => {
    const result = parseCampaignListQuery({ asset: 'INVALID' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(issue => issue.path.includes('asset'))).toBe(true);
    }
  });

  it('validates invalid status parameter', () => {
    const result = parseCampaignListQuery({ status: 'invalid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(issue => issue.path.includes('status'))).toBe(true);
    }
  });

  it('validates invalid createdAfter parameter', () => {
    const result = parseCampaignListQuery({ createdAfter: 'not-a-date' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some(issue => issue.path.includes('createdAfter'))).toBe(true);
    }
  });

  it('accepts valid ISO 8601 timestamps for createdAfter/createdBefore', () => {
    const result = parseCampaignListQuery({
      createdAfter: '2024-01-01T00:00:00Z',
      createdBefore: '2024-12-31T23:59:59Z',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.createdAfter).toBeDefined();
      expect(result.data.createdBefore).toBeDefined();
    }
  });

  it('accepts multi-value asset parameter', () => {
    const result = parseCampaignListQuery({ asset: 'XLM,USDC' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.asset).toEqual(['XLM', 'USDC']);
    }
  });

  it('requires both page and limit for pagination', () => {
    const resultPageOnly = parseCampaignListQuery({ page: '1' });
    expect(resultPageOnly.ok).toBe(false);

    const resultLimitOnly = parseCampaignListQuery({ limit: '10' });
    expect(resultLimitOnly.ok).toBe(false);
  });
});

describe('maxPerContributor in response', () => {
  it('includes maxPerContributor field in campaign records', () => {
    const now = Math.floor(Date.now() / 1000);

    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Campaign with maxPerContributor',
      description: 'Test campaign with max per contributor limit',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: now + 3600,
      maxPerContributor: 50,
    });

    const { campaigns } = listCampaigns({ page: 1, limit: 10 });
    const found = campaigns.find(c => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found?.maxPerContributor).toBe(50);
  });

  it('includes maxPerContributor in response even when not set', () => {
    const now = Math.floor(Date.now() / 1000);

    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Campaign without maxPerContributor',
      description: 'Test campaign without max per contributor limit',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: now + 3600,
    });

    const { campaigns } = listCampaigns({ page: 1, limit: 10 });
    const found = campaigns.find(c => c.id === campaign.id);

    expect(found).toBeDefined();
    // maxPerContributor should be undefined but the field should be present in the type
    expect(found?.maxPerContributor).toBeUndefined();
  });
});
