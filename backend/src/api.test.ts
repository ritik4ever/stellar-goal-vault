
import fs from 'fs';
import { Server } from 'http';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './index';
import { initCampaignStore } from './services/campaignStore';
import { getDb } from './services/db';

// Mock sorobanRpc to avoid real network calls during tests
vi.mock('./services/sorobanRpc', () => ({
  ensureSorobanRefundConfig: vi.fn(),
  verifyRefundTransaction: vi.fn().mockResolvedValue({
    txHash: 'mock-tx-hash',
    status: 'SUCCESS',
    ledger: 100,
    createdAt: Math.floor(Date.now() / 1000),
    latestLedger: 100,
  }),
}));

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-api-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = 'mock-contract';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  initCampaignStore();

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address() as any;
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

async function post(apiPath: string, body: any) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

describe('Campaign Lifecycle API', () => {
  it('covers create, pledge, claim end-to-end', async () => {
    // 1. Create Campaign
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Test Campaign',
      description: 'This is a test campaign with sufficient description length',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;
    expect(campaignId).toBeDefined();

    // 2. Pledge to reach target
    const pledgeRes = await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 100,
      assetCode: "USDC",
    });
    expect(pledgeRes.status).toBe(201);
    expect(pledgeRes.data.data.progress.status).toBe('funded');
    expect(pledgeRes.data.data.progress.canClaim).toBe(false); // Deadline not reached yet

    // Move deadline to past in DB to allow claim
    getDb()
      .prepare(`UPDATE campaigns SET deadline = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000) - 3600, campaignId);

    // 3. Claim
    const claimRes = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CREATOR,
      transactionHash: 'a'.repeat(64),
      confirmedAt: Math.floor(Date.now() / 1000),
    });
    expect(claimRes.status).toBe(200);
    expect(claimRes.data.data.progress.status).toBe('claimed');

    // Duplicate Claim is idempotent (returns 200 with the same status)
    const duplicateClaimRes = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CREATOR,
      transactionHash: 'a'.repeat(64),
      confirmedAt: Math.floor(Date.now() / 1000),
    });
    expect(duplicateClaimRes.status).toBe(200);
  });

  it('covers create, pledge, failed, refund end-to-end', async () => {
    // 1. Create Campaign
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Test Campaign 2',
      description: 'This is another test campaign with enough characters',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // 2. Pledge partial amount
    const pledgeRes = await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 50,
      assetCode: "XLM",
    });
    expect(pledgeRes.status).toBe(201);

    const mockSorobanData = {
      txHash: 'a'.repeat(64),
      contractId: 'C' + 'A'.repeat(55),
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'http://localhost:8000/soroban/rpc',
      walletAddress: CONTRIBUTOR,
    };

    // Attempt early refund (should fail)
    const earlyRefundRes = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSorobanData,
    });
    expect(earlyRefundRes.status).toBe(400);
    expect(earlyRefundRes.data.error.code).toBe('INVALID_CAMPAIGN_STATE');

    // Move deadline to past in DB to fail the campaign
    getDb()
      .prepare(`UPDATE campaigns SET deadline = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000) - 3600, campaignId);

    // 3. Refund
    const refundRes = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSorobanData,
    });
    expect(refundRes.status).toBe(200);
    expect(refundRes.data.data.refundedAmount).toBe(50);
    expect(refundRes.data.data.pledgedAmount).toBe(0); // Pledged amount reduces to 0
  });

  it("sanitizes HTML tags in title and description during campaign creation", async () => {
    const createRes = await post("/api/campaigns", {
      creator: CREATOR,
      title: "<h1>Test</h1>",
      description: "<h1>Test</h1> with at least 20 characters",
      acceptedTokens: ["USDC"],
      targetAmount: 100,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.data.data.title).toBe("&lt;h1&gt;Test&lt;&sol;h1&gt;");
    expect(createRes.data.data.description).toBe("&lt;h1&gt;Test&lt;&sol;h1&gt; with at least 20 characters");
  });
});

describe('Campaign List Query Parameter Validation', () => {
  async function get(apiPath: string) {
    const response = await fetch(`${baseUrl}${apiPath}`);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  it('returns 400 for invalid page parameter', async () => {
    const res = await get('/api/campaigns?page=invalid&limit=10');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid limit parameter', async () => {
    const res = await get('/api/campaigns?page=1&limit=999');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when page is provided without limit', async () => {
    const res = await get('/api/campaigns?page=1');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when limit is provided without page', async () => {
    const res = await get('/api/campaigns?limit=10');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid asset parameter', async () => {
    const res = await get('/api/campaigns?asset=INVALID');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid status parameter', async () => {
    const res = await get('/api/campaigns?status=invalid');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid sort parameter', async () => {
    const res = await get('/api/campaigns?sort=invalid');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid order parameter', async () => {
    const res = await get('/api/campaigns?order=invalid');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid createdAfter parameter', async () => {
    const res = await get('/api/campaigns?createdAfter=not-a-date');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid createdBefore parameter', async () => {
    const res = await get('/api/campaigns?createdBefore=invalid-date');
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts valid ISO 8601 timestamps', async () => {
    const res = await get('/api/campaigns?createdAfter=2024-01-01T00:00:00Z&createdBefore=2024-12-31T23:59:59Z');
    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();
  });

  it('accepts multi-value asset filter', async () => {
    const res = await get('/api/campaigns?asset=XLM,USDC');
    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();
  });

  it('accepts single asset value', async () => {
    const res = await get('/api/campaigns?asset=XLM');
    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();
  });
});

describe('Campaign Filters - createdAfter/createdBefore', () => {
  async function get(apiPath: string) {
    const response = await fetch(`${baseUrl}${apiPath}`);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  it('filters campaigns by createdAfter date', async () => {
    const now = Math.floor(Date.now() / 1000);

    // Create a campaign
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Recent Campaign',
      description: 'Created just now with sufficient description',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: now + 3600,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // Query with createdAfter (should include this campaign)
    const futureTimestamp = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
    const res = await get(`/api/campaigns?createdAfter=${encodeURIComponent(futureTimestamp)}`);
    expect(res.status).toBe(200);
    expect(res.data.data.some((c: any) => c.id === campaignId)).toBe(true);
  });

  it('filters campaigns by createdBefore date', async () => {
    const now = Math.floor(Date.now() / 1000);

    // Create a campaign
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Old Campaign',
      description: 'Created earlier with sufficient description text',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline: now + 3600,
    });
    expect(createRes.status).toBe(201);

    // Query with createdBefore in the future (should include this campaign)
    const futureTimestamp = new Date(Date.now() + 60000).toISOString(); // 1 minute in future
    const res = await get(`/api/campaigns?createdBefore=${encodeURIComponent(futureTimestamp)}`);
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThan(0);
  });
});

describe('Campaign Multi-Asset Filter', () => {
  async function get(apiPath: string) {
    const response = await fetch(`${baseUrl}${apiPath}`);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  it('filters campaigns by multiple asset codes', async () => {
    const now = Math.floor(Date.now() / 1000);

    // Create campaigns with different assets
    const xlmRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'XLM Campaign',
      description: 'Campaign accepting XLM tokens only here',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline: now + 3600,
    });
    expect(xlmRes.status).toBe(201);

    const usdcRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'USDC Campaign',
      description: 'Campaign accepting USDC tokens here now',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: now + 3600,
    });
    expect(usdcRes.status).toBe(201);

    // Query with multiple assets
    const res = await get('/api/campaigns?asset=XLM,USDC');
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThanOrEqual(2);
  });

  it('supports case-insensitive multi-asset filter', async () => {
    const res = await get('/api/campaigns?asset=xlm,usdc');
    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();
  });
});

describe('Campaign maxPerContributor Field', () => {
  async function get(apiPath: string) {
    const response = await fetch(`${baseUrl}${apiPath}`);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  async function post(apiPath: string, body: any) {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  it('includes maxPerContributor in GET /api/campaigns list response', async () => {
    const now = Math.floor(Date.now() / 1000);

    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Campaign with maxPerContributor',
      description: 'Campaign with per-contributor limit',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: now + 3600,
      maxPerContributor: 50,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    const listRes = await get('/api/campaigns?page=1&limit=10');
    expect(listRes.status).toBe(200);

    const campaign = listRes.data.data.find((c: any) => c.id === campaignId);
    expect(campaign).toBeDefined();
    expect(campaign.maxPerContributor).toBe(50);
  });

  it('includes maxPerContributor in GET /api/campaigns/:id detail response', async () => {
    const now = Math.floor(Date.now() / 1000);

    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Campaign with maxPerContributor',
      description: 'Campaign with per-contributor limit',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: now + 3600,
      maxPerContributor: 75,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    const detailRes = await get(`/api/campaigns/${campaignId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.data.data.maxPerContributor).toBe(75);
  });
});

describe('GET /api/stats', () => {
  it('returns aggregate metrics in the correct format', async () => {
    const res = await get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.data.data).toMatchObject({
      totalCampaigns: expect.any(Number),
      openCampaigns: expect.any(Number),
      fundedCampaigns: expect.any(Number),
      claimedCampaigns: expect.any(Number),
      failedCampaigns: expect.any(Number),
      totalPledgeVolume: expect.any(Number),
      uniqueContributors: expect.any(Number),
    });
  });
});
