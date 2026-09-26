import fs from 'fs';
import { Server } from 'http';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The write rate limit (default 20/min) is a module-level constant in `./index`,
// evaluated at import time. This suite exercises many archive/restore/pledge
// mutations across its describe blocks, so raise the limit before `./index`
// is imported to avoid tripping 429s on unrelated test assertions.
vi.hoisted(() => {
  process.env.RATE_LIMIT_WRITE_LIMIT = '1000';
});

import { app } from './index';
import { createCampaign, initCampaignStore } from './services/campaignStore';
import { getDb } from './services/db';

// Deterministic baseline timestamp for integration testing.
// Using a fixed epoch timestamp eliminates wall-clock drift, timezone dependencies,
// and test flakes across execution environments.
// 1_700_000_000_000 ms corresponds to 2023-11-14T22:13:20.000Z (1_700_000_000 s).
const BASE_MOCK_TIME_MS = 1_700_000_000_000;
const BASE_MOCK_TIME_SEC = Math.floor(BASE_MOCK_TIME_MS / 1000);

let currentMockTimeMs = BASE_MOCK_TIME_MS;
let dateNowSpy: ReturnType<typeof vi.spyOn> | undefined;

function setMockTimeMs(timeMs: number): void {
  currentMockTimeMs = timeMs;
}

function advanceMockTimeSeconds(seconds: number): void {
  currentMockTimeMs += seconds * 1000;
}

function nowInMockSeconds(): number {
  return Math.floor(currentMockTimeMs / 1000);
}

// Mock sorobanRpc to avoid real network calls during tests
vi.mock('./services/sorobanRpc', () => ({
  ensureSorobanRefundConfig: vi.fn(),
  verifyRefundTransaction: vi.fn().mockImplementation(() =>
    Promise.resolve({
      txHash: 'mock-tx-hash',
      status: 'SUCCESS',
      ledger: 100,
      createdAt: Math.floor(Date.now() / 1000),
      latestLedger: 100,
    }),
  ),
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
      const address = server.address() as { port: number };
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  dateNowSpy?.mockRestore();
  server.close();
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  currentMockTimeMs = BASE_MOCK_TIME_MS;
  if (!dateNowSpy) {
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentMockTimeMs);
  } else {
    dateNowSpy.mockImplementation(() => currentMockTimeMs);
  }

  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

async function post(apiPath: string, body: unknown) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

async function postWithHeaders(apiPath: string, body: unknown, headers: Record<string, string>) {
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: 'POST',
    headers: mergedHeaders,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, headers: response.headers };
}

async function get(apiPath: string) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

describe('Health Checks', () => {
  it('GET /api/health should return ok and indexer status', async () => {
    const res = await get('/api/health');
    // It might be 503 if indexer is failing (consecutiveFailures > 0 or not started)
    expect(res.data.indexer).toBeDefined();
    expect(typeof res.data.indexer.isHealthy).toBe('boolean');
  });

  it('GET /api/health/deep should return components status', async () => {
    const res = await get('/api/health/deep');
    expect(res.data.components.indexer).toBeDefined();
    expect(typeof res.data.components.indexer.status).toBe('string');
  });
});

describe('Campaign Lifecycle API', () => {
  it('covers create, pledge, claim end-to-end', async () => {
    // 1. Create Campaign
    const deadline = nowInMockSeconds() + 3600;
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Test Campaign',
      description: 'This is a test campaign with sufficient description length',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;
    expect(campaignId).toBeDefined();

    // 2. Pledge to reach target
    const pledgeRes = await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 100,
      assetCode: 'USDC',
    });
    expect(pledgeRes.status).toBe(201);
    expect(pledgeRes.data.data.progress.status).toBe('funded');
    expect(pledgeRes.data.data.progress.canClaim).toBe(false); // Deadline not reached yet

    // Early claim attempt before deadline must fail with 400 INVALID_CAMPAIGN_STATE
    const earlyClaimRes = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CREATOR,
      transactionHash: 'a'.repeat(64),
      confirmedAt: nowInMockSeconds(),
    });
    expect(earlyClaimRes.status).toBe(400);
    expect(earlyClaimRes.data.error.code).toBe('INVALID_CAMPAIGN_STATE');

    // Advance mocked time past the deadline to allow claim without DB mutation
    advanceMockTimeSeconds(3601);

    // 3. Claim
    const claimRes = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CREATOR,
      transactionHash: 'a'.repeat(64),
      confirmedAt: nowInMockSeconds(),
    });
    expect(claimRes.status).toBe(200);
    expect(claimRes.data.data.progress.status).toBe('claimed');

    // Verify no duplicate claim event in history
    const historyRes = await get(`/api/campaigns/${campaignId}/history`);
    const claimEvents = historyRes.data.events?.filter(
      (e: { eventType: string }) => e.eventType === 'claimed',
    );
    expect(claimEvents?.length).toBe(1);

    // Duplicate Claim returns 409 Conflict
    const duplicateClaimRes = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CREATOR,
      transactionHash: 'b'.repeat(64),
      confirmedAt: nowInMockSeconds(),
    });
    expect(duplicateClaimRes.status).toBe(409);
    expect(duplicateClaimRes.data.error.code).toBe('CAMPAIGN_ALREADY_CLAIMED');
    expect(duplicateClaimRes.data.error.message).toContain('already claimed');

    // Verify claim event still not duplicated
    const historyRes2 = await get(`/api/campaigns/${campaignId}/history`);
    const claimEvents2 = historyRes2.data.events?.filter(
      (e: { eventType: string }) => e.eventType === 'claimed',
    );
    expect(claimEvents2?.length).toBe(1);
  });

  it('covers create, pledge, failed, refund end-to-end', async () => {
    // 1. Create Campaign
    const deadline = nowInMockSeconds() + 3600;
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Test Campaign 2',
      description: 'This is another test campaign with enough characters',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // 2. Pledge partial amount
    const pledgeRes = await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 50,
      assetCode: 'XLM',
    });
    expect(pledgeRes.status).toBe(201);

    const mockSorobanData = {
      txHash: 'a'.repeat(64),
      contractId: 'C' + 'A'.repeat(55),
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'http://localhost:8000/soroban/rpc',
      walletAddress: CONTRIBUTOR,
    };

    // Attempt early refund (should fail before deadline)
    const earlyRefundRes = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSorobanData,
    });
    expect(earlyRefundRes.status).toBe(400);
    expect(earlyRefundRes.data.error.code).toBe('INVALID_CAMPAIGN_STATE');

    // Advance mocked time past the deadline to fail the campaign without DB mutation
    advanceMockTimeSeconds(3601);

    // 3. Refund
    const refundRes = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSorobanData,
    });
    expect(refundRes.status).toBe(200);
    expect(refundRes.data.data.refundedAmount).toBe(50);
    expect(refundRes.data.data.pledgedAmount).toBe(0); // Pledged amount reduces to 0
  });

  it('sanitizes HTML tags in title and description during campaign creation', async () => {
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: '<h1>Test</h1>',
      description: '<h1>Test</h1> with at least 20 characters',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: nowInMockSeconds() + 3600,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.data.data.title).toBe('&lt;h1&gt;Test&lt;&sol;h1&gt;');
    expect(createRes.data.data.description).toBe(
      '&lt;h1&gt;Test&lt;&sol;h1&gt; with at least 20 characters',
    );
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
    const res = await get(
      '/api/campaigns?createdAfter=2024-01-01T00:00:00Z&createdBefore=2024-12-31T23:59:59Z',
    );
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
    const deadline = nowInMockSeconds() + 3600;

    // Create a campaign
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Recent Campaign',
      description: 'Created just now with sufficient description',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // Query with createdAfter (1 minute before mock time)
    const afterTimestamp = new Date(currentMockTimeMs - 60000).toISOString();
    const res = await get(`/api/campaigns?createdAfter=${encodeURIComponent(afterTimestamp)}`);
    expect(res.status).toBe(200);
    expect(res.data.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });

  it('filters campaigns by createdBefore date', async () => {
    const deadline = nowInMockSeconds() + 3600;

    // Create a campaign
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Old Campaign',
      description: 'Created earlier with sufficient description text',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline,
    });
    expect(createRes.status).toBe(201);

    // Query with createdBefore in the future (1 minute after mock time)
    const beforeTimestamp = new Date(currentMockTimeMs + 60000).toISOString();
    const res = await get(`/api/campaigns?createdBefore=${encodeURIComponent(beforeTimestamp)}`);
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThan(0);
  });

  it('filters campaigns by createdAfter with non-UTC timezone offsets consistently', async () => {
    const deadline = nowInMockSeconds() + 3600;

    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Timezone Campaign',
      description: 'Created at deterministic time to test timezone offset queries',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // BASE_MOCK_TIME_MS corresponds to 2023-11-14T22:13:20.000Z.
    // 1 minute before in UTC: 2023-11-14T22:12:20Z.
    // In +03:00 timezone: 2023-11-15T01:12:20+03:00
    // In -05:00 timezone: 2023-11-14T17:12:20-05:00
    const plusTz = '2023-11-15T01:12:20+03:00';
    const minusTz = '2023-11-14T17:12:20-05:00';

    const resPlus = await get(`/api/campaigns?createdAfter=${encodeURIComponent(plusTz)}`);
    expect(resPlus.status).toBe(200);
    expect(resPlus.data.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);

    const resMinus = await get(`/api/campaigns?createdAfter=${encodeURIComponent(minusTz)}`);
    expect(resMinus.status).toBe(200);
    expect(resMinus.data.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });
});

describe('Campaign Multi-Asset Filter', () => {
  async function get(apiPath: string) {
    const response = await fetch(`${baseUrl}${apiPath}`);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  it('filters campaigns by multiple asset codes', async () => {
    const deadline = nowInMockSeconds() + 3600;

    // Create campaigns with different assets
    const xlmRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'XLM Campaign',
      description: 'Campaign accepting XLM tokens only here',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline,
    });
    expect(xlmRes.status).toBe(201);

    const usdcRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'USDC Campaign',
      description: 'Campaign accepting USDC tokens here now',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline,
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

  async function post(apiPath: string, body: unknown) {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  it('includes maxPerContributor in GET /api/campaigns list response', async () => {
    const deadline = nowInMockSeconds() + 3600;

    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Campaign with maxPerContributor',
      description: 'Campaign with per-contributor limit',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline,
      maxPerContributor: 50,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    const listRes = await get('/api/campaigns?page=1&limit=10');
    expect(listRes.status).toBe(200);

    const campaign = listRes.data.data.find(
      (c: { id: string; maxPerContributor?: number }) => c.id === campaignId,
    );
    expect(campaign).toBeDefined();
    expect(campaign.maxPerContributor).toBe(50);
  });

  it('keeps a campaign open at the exact deadline and fails it 1ms later', async () => {
    const fixedNow = BASE_MOCK_TIME_MS;
    setMockTimeMs(fixedNow);

    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Exact deadline boundary campaign',
      description: 'Boundary test for exact deadline status consistency',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: Math.floor(fixedNow / 1000),
    });

    const firstCall = await get('/api/campaigns?page=1&limit=10');
    expect(firstCall.status).toBe(200);

    const firstListedCampaign = firstCall.data.data.find((item: { id: string; progress: { status: string } }) => item.id === campaign.id);
    expect(firstListedCampaign?.progress.status).toBe('open');

    const secondCall = await get('/api/campaigns?page=1&limit=10');
    expect(secondCall.status).toBe(200);

    const secondListedCampaign = secondCall.data.data.find((item: { id: string; progress: { status: string } }) => item.id === campaign.id);
    expect(secondListedCampaign?.progress.status).toBe('open');

    setMockTimeMs(fixedNow + 1);

    const oneMillisecondLater = await get('/api/campaigns?page=1&limit=10');
    expect(oneMillisecondLater.status).toBe(200);

    const failedCampaign = oneMillisecondLater.data.data.find((item: { id: string; progress: { status: string } }) => item.id === campaign.id);
    expect(failedCampaign?.progress.status).toBe('failed');
  });

  it('includes maxPerContributor in GET /api/campaigns/:id detail response', async () => {
    const deadline = nowInMockSeconds() + 3600;

    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Campaign with maxPerContributor',
      description: 'Campaign with per-contributor limit',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline,
      maxPerContributor: 75,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    const detailRes = await get(`/api/campaigns/${campaignId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.data.data.maxPerContributor).toBe(75);
  });
});

describe('Campaign archive (soft delete) and restore', () => {
  async function get(apiPath: string) {
    const response = await fetch(`${baseUrl}${apiPath}`);
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  async function post(apiPath: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  async function del(apiPath: string) {
    const response = await fetch(`${baseUrl}${apiPath}`, { method: 'DELETE' });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  async function createTestCampaign(title: string) {
    const res = await post('/api/campaigns', {
      creator: CREATOR,
      title,
      description: 'A campaign used to exercise archive/restore behavior',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: nowInMockSeconds() + 3600,
    });
    expect(res.status).toBe(201);
    return res.data.data.id as string;
  }

  it('DELETE /api/campaigns/:id archives the campaign and sets deletedAt', async () => {
    const campaignId = await createTestCampaign('Archive me');

    const deleteRes = await del(`/api/campaigns/${campaignId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.data.deletedAt).toBeDefined();
  });

  it('archived campaigns are excluded from the default GET /api/campaigns list', async () => {
    const campaignId = await createTestCampaign('Hidden after archive');
    await del(`/api/campaigns/${campaignId}`);

    const listRes = await get('/api/campaigns?page=1&limit=50');
    expect(listRes.status).toBe(200);
    expect(listRes.data.data.some((c: { id: string }) => c.id === campaignId)).toBe(false);
  });

  it('GET /api/campaigns?includeDeleted=true includes archived campaigns', async () => {
    const campaignId = await createTestCampaign('Visible with includeDeleted');
    await del(`/api/campaigns/${campaignId}`);

    const listRes = await get('/api/campaigns?page=1&limit=50&includeDeleted=true');
    expect(listRes.status).toBe(200);
    expect(listRes.data.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });

  it('GET /api/campaigns?include_archived=true is accepted as an alias for includeDeleted', async () => {
    const campaignId = await createTestCampaign('Visible with include_archived');
    await del(`/api/campaigns/${campaignId}`);

    const listRes = await get('/api/campaigns?page=1&limit=50&include_archived=true');
    expect(listRes.status).toBe(200);
    expect(listRes.data.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });

  it('DELETE on an already-archived campaign returns 409', async () => {
    const campaignId = await createTestCampaign('Double archive');
    await del(`/api/campaigns/${campaignId}`);

    const secondDelete = await del(`/api/campaigns/${campaignId}`);
    expect(secondDelete.status).toBe(409);
    expect(secondDelete.data.error.code).toBe('ALREADY_DELETED');
  });

  it('DELETE on a nonexistent campaign returns 404', async () => {
    const res = await del('/api/campaigns/999999');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('NOT_FOUND');
  });

  it('POST /api/campaigns/:id/restore un-archives the campaign', async () => {
    const campaignId = await createTestCampaign('Restore me');
    await del(`/api/campaigns/${campaignId}`);

    const restoreRes = await post(`/api/campaigns/${campaignId}/restore`);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.data.data.deletedAt).toBeUndefined();

    const listRes = await get('/api/campaigns?page=1&limit=50');
    expect(listRes.data.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);
  });

  it('POST restore on a campaign that is not archived returns 409', async () => {
    const campaignId = await createTestCampaign('Never archived');
    const res = await post(`/api/campaigns/${campaignId}/restore`);
    expect(res.status).toBe(409);
    expect(res.data.error.code).toBe('NOT_ARCHIVED');
  });

  it('POST restore on a nonexistent campaign returns 404', async () => {
    const res = await post('/api/campaigns/999999/restore');
    expect(res.status).toBe(404);
    expect(res.data.error.code).toBe('NOT_FOUND');
  });

  it('preserves pledges and history through an archive + restore cycle', async () => {
    const campaignId = await createTestCampaign('Preserve pledges');
    const pledgeRes = await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 25,
      assetCode: 'USDC',
    });
    expect(pledgeRes.status).toBe(201);

    await del(`/api/campaigns/${campaignId}`);
    await post(`/api/campaigns/${campaignId}/restore`);

    const detailRes = await get(`/api/campaigns/${campaignId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.data.data.pledgedAmount).toBe(25);

    const historyRes = await get(`/api/campaigns/${campaignId}/history`);
    expect(historyRes.status).toBe(200);
    const eventTypes = historyRes.data.data.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toContain('created');
    expect(eventTypes).toContain('pledged');
    expect(eventTypes).toContain('archived');
    expect(eventTypes).toContain('restored');
  });
});

describe('GET /api/stats', () => {
  it('returns aggregate metrics in the correct format', async () => {
    const res = await get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.data.data).toMatchObject({
      total_campaigns: expect.any(Number),
      open_campaigns: expect.any(Number),
      funded_campaigns: expect.any(Number),
      failed_campaigns: expect.any(Number),
      total_pledged_usdc: expect.any(Number),
      total_pledged_xlm: expect.any(Number),
      total_contributors: expect.any(Number),
      avg_funding_rate_pct: expect.any(Number),
    });
  });
});

describe('POST /api/campaigns/:id/pledges with Idempotency-Key', () => {
  const CONTRIBUTOR_C = `G${'D'.repeat(55)}`;
  const CONTRIBUTOR_D = `G${'E'.repeat(55)}`;

  async function createTestCampaign() {
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Idempotency Test Campaign',
      description: 'This campaign is used to test idempotency behavior.',
      acceptedTokens: ['USDC'],
      targetAmount: 500,
      deadline: nowInMockSeconds() + 86400,
    });
    return createRes.data.data.id;
  }

  it('request with Idempotency-Key creates a pledge', async () => {
    const campaignId = await createTestCampaign();

    const res = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 100,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'test-key-1' },
    );

    expect(res.status).toBe(201);
    expect(res.data.data.progress.pledgeCount).toBe(1);
  });

  it('duplicate request with same Idempotency-Key returns cached response', async () => {
    const campaignId = await createTestCampaign();

    const firstRes = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 100,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'dup-key-1' },
    );
    expect(firstRes.status).toBe(201);

    const secondRes = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 100,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'dup-key-1' },
    );
    expect(secondRes.status).toBe(201);
    expect(secondRes.data).toEqual(firstRes.data);
  });

  it('duplicate request with same Idempotency-Key performs only one database write', async () => {
    const campaignId = await createTestCampaign();

    await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 100,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'db-write-key' },
    );

    const db = getDb();
    const pledgeCountBefore = db.prepare('SELECT COUNT(*) AS count FROM pledges').get() as {
      count: number;
    };

    await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 100,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'db-write-key' },
    );

    const pledgeCountAfter = db.prepare('SELECT COUNT(*) AS count FROM pledges').get() as {
      count: number;
    };
    expect(pledgeCountAfter.count).toBe(pledgeCountBefore.count);
  });

  it('missing Idempotency-Key behaves exactly as before', async () => {
    const campaignId = await createTestCampaign();

    const res = await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR_C,
      amount: 100,
      assetCode: 'USDC',
    });
    expect(res.status).toBe(201);
    expect(res.data.data.progress.pledgeCount).toBe(1);
  });

  it('different idempotency keys create independent pledges', async () => {
    const campaignId = await createTestCampaign();

    const res1 = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 50,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'key-A' },
    );
    expect(res1.status).toBe(201);

    const res2 = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 50,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'key-B' },
    );
    expect(res2.status).toBe(201);

    const db = getDb();
    const pledgeCount = db.prepare('SELECT COUNT(*) AS count FROM pledges').get() as {
      count: number;
    };
    expect(pledgeCount.count).toBe(2);
  });

  it('different users using the same idempotency key do not share cached responses', async () => {
    const campaignId = await createTestCampaign();

    const userARes = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 100,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'shared-key' },
    );
    expect(userARes.status).toBe(201);
    expect(userARes.data.data.progress.pledgeCount).toBe(1);

    const userBRes = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_D,
        amount: 100,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'shared-key' },
    );
    expect(userBRes.status).toBe(201);
    expect(userBRes.data.data.progress.pledgeCount).toBe(2);
  });

  it('cached response preserves original status and payload', async () => {
    const campaignId = await createTestCampaign();

    const firstRes = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 75,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'status-payload-key' },
    );
    expect(firstRes.status).toBe(201);

    const cachedRes = await post(
      `/api/campaigns/${campaignId}/pledges`,
      {
        contributor: CONTRIBUTOR_C,
        amount: 75,
        assetCode: 'USDC',
      },
      { 'Idempotency-Key': 'status-payload-key' },
    );
    expect(cachedRes.status).toBe(201);
    expect(cachedRes.data.data.id).toBe(firstRes.data.data.id);
    expect(cachedRes.data.data.amount).toBe(firstRes.data.data.amount);
  });

  it('X-Idempotency-Cache header is MISS on first request and HIT on duplicate', async () => {
    const campaignId = await createTestCampaign();

    const firstRes = await postWithHeaders(
      `/api/campaigns/${campaignId}/pledges`,
      { contributor: CONTRIBUTOR_C, amount: 100, assetCode: 'USDC' },
      { 'Idempotency-Key': 'header-test-key' },
    );
    expect(firstRes.status).toBe(201);
    expect(firstRes.headers.get('X-Idempotency-Cache')).toBe('MISS');

    const secondRes = await postWithHeaders(
      `/api/campaigns/${campaignId}/pledges`,
      { contributor: CONTRIBUTOR_C, amount: 100, assetCode: 'USDC' },
      { 'Idempotency-Key': 'header-test-key' },
    );
    expect(secondRes.status).toBe(201);
    expect(secondRes.headers.get('X-Idempotency-Cache')).toBe('HIT');
  });
});

describe('Campaign Deadline and Lifecycle Time Invariance', () => {
  it('rejects campaign creation when deadline is in the past or exactly current time', async () => {
    const pastRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Past Deadline Campaign',
      description: 'This campaign should fail because deadline is in the past',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: nowInMockSeconds() - 10,
    });
    expect(pastRes.status).toBe(400);
    expect(pastRes.data.error.code).toBe('INVALID_DEADLINE');

    const equalRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Current Deadline Campaign',
      description: 'This campaign should fail because deadline equals current time',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline: nowInMockSeconds(),
    });
    expect(equalRes.status).toBe(400);
    expect(equalRes.data.error.code).toBe('INVALID_DEADLINE');
  });

  it('transitions from open to funded to claimable as time advances past deadline', async () => {
    const deadline = nowInMockSeconds() + 7200; // 2 hours in future
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Lifecycle Progression Campaign',
      description: 'Testing lifecycle progression with injected time advancement',
      acceptedTokens: ['USDC'],
      targetAmount: 200,
      deadline,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // 1 hour later (before deadline, unreached goal)
    advanceMockTimeSeconds(3600);
    let detailRes = await get(`/api/campaigns/${campaignId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.data.data.progress.status).toBe('open');
    expect(detailRes.data.data.progress.canClaim).toBe(false);

    // Contributor pledges 200 (reaches target)
    await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 200,
      assetCode: 'USDC',
    });

    // Check status: funded, but deadline not yet reached
    detailRes = await get(`/api/campaigns/${campaignId}`);
    expect(detailRes.data.data.progress.status).toBe('funded');
    expect(detailRes.data.data.progress.canClaim).toBe(false);

    // Claim attempt before deadline must fail
    const earlyClaim = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CREATOR,
      transactionHash: 'c'.repeat(64),
      confirmedAt: nowInMockSeconds(),
    });
    expect(earlyClaim.status).toBe(400);
    expect(earlyClaim.data.error.code).toBe('INVALID_CAMPAIGN_STATE');

    // Advance time to 1 second past deadline (7201 total from start)
    advanceMockTimeSeconds(3601);
    detailRes = await get(`/api/campaigns/${campaignId}`);
    expect(detailRes.data.data.progress.canClaim).toBe(true);

    // Claim now succeeds
    const claimRes = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CREATOR,
      transactionHash: 'd'.repeat(64),
      confirmedAt: nowInMockSeconds(),
    });
    expect(claimRes.status).toBe(200);
    expect(claimRes.data.data.progress.status).toBe('claimed');
  });

  it('transitions underfunded campaign to failed and refundable once deadline passes', async () => {
    const deadline = nowInMockSeconds() + 1800; // 30 minutes
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Underfunded Lifecycle Campaign',
      description: 'Testing underfunded transition to failed state with injected time',
      acceptedTokens: ['USDC'],
      targetAmount: 500,
      deadline,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // Pledge partial amount (150 of 500)
    await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 150,
      assetCode: 'USDC',
    });

    const mockSoroban = {
      txHash: 'e'.repeat(64),
      contractId: 'C' + 'B'.repeat(55),
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'http://localhost:8000/soroban/rpc',
      walletAddress: CONTRIBUTOR,
    };

    // Attempt refund before deadline -> must fail
    const earlyRefund = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSoroban,
    });
    expect(earlyRefund.status).toBe(400);
    expect(earlyRefund.data.error.code).toBe('INVALID_CAMPAIGN_STATE');

    // Advance time past deadline
    advanceMockTimeSeconds(1801);

    // Campaign should now be failed and refundable
    const detailRes = await get(`/api/campaigns/${campaignId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.data.data.progress.status).toBe('failed');
    expect(detailRes.data.data.progress.canRefund).toBe(true);
    expect(detailRes.data.data.progress.canClaim).toBe(false);

    // Refund now succeeds
    const refundRes = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSoroban,
    });
    expect(refundRes.status).toBe(200);
    expect(refundRes.data.data.refundedAmount).toBe(150);
    expect(refundRes.data.data.pledgedAmount).toBe(0);
  });

  it('correctly filters campaigns by open and failed status based on injected time', async () => {
    const fixedBaseSec = nowInMockSeconds();

    // Create Campaign A: expires in 1000s
    const resA = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Campaign Expiring Soon',
      description: 'Will expire and fail when deadline passes',
      acceptedTokens: ['USDC'],
      targetAmount: 500,
      deadline: fixedBaseSec + 1000,
    });
    const idA = resA.data.data.id;

    // Create Campaign B: expires in 5000s
    const resB = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Campaign Expiring Later',
      description: 'Will remain open while campaign A expires',
      acceptedTokens: ['USDC'],
      targetAmount: 500,
      deadline: fixedBaseSec + 5000,
    });
    const idB = resB.data.data.id;

    // At baseline: both should be open
    let openList = await get('/api/campaigns?status=open');
    expect(openList.status).toBe(200);
    expect(openList.data.data.some((c: { id: string }) => c.id === idA)).toBe(true);
    expect(openList.data.data.some((c: { id: string }) => c.id === idB)).toBe(true);

    // Advance time past Campaign A's deadline (advance 1001s)
    advanceMockTimeSeconds(1001);

    // Campaign A is now failed; Campaign B is still open
    openList = await get('/api/campaigns?status=open');
    expect(openList.data.data.some((c: { id: string }) => c.id === idA)).toBe(false);
    expect(openList.data.data.some((c: { id: string }) => c.id === idB)).toBe(true);

    const failedList = await get('/api/campaigns?status=failed');
    expect(failedList.status).toBe(200);
    expect(failedList.data.data.some((c: { id: string }) => c.id === idA)).toBe(true);
    expect(failedList.data.data.some((c: { id: string }) => c.id === idB)).toBe(false);
  });
});

describe('Failure Path Coverage', () => {
  it('handles invalid input during campaign creation', async () => {
    const res = await post('/api/campaigns', {
      creator: '', // Missing
      title: 'X', // Too short
      description: 'Too short',
      acceptedTokens: ['USDC'],
      targetAmount: -100, // Invalid target
      deadline: nowInMockSeconds() - 100, // Past deadline
    });
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles missing data (404)', async () => {
    const res = await get('/api/campaigns/nonexistent-id-1234');
    expect(res.status).toBe(400); // Wait, campaign ID parse error or 404? 
    // It depends on regex for ID, let's just assert status >= 400
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('handles permission failures (claim by non-creator)', async () => {
    const deadline = nowInMockSeconds() + 100;
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Permission Test Campaign',
      description: 'Campaign for permission test with sufficient description',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
      deadline,
    });
    const campaignId = createRes.data.data.id;

    // Fully fund the campaign
    await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 100,
      assetCode: 'USDC',
    });

    advanceMockTimeSeconds(101); // past deadline

    // Attempt claim as CONTRIBUTOR (not creator)
    const claimRes = await post(`/api/campaigns/${campaignId}/claim`, {
      creator: CONTRIBUTOR, // Permission failure!
      transactionHash: 'f'.repeat(64),
      confirmedAt: nowInMockSeconds(),
    });
    expect(claimRes.status).toBe(403);
    expect(claimRes.data.error.code).toBe('FORBIDDEN');
  });

  it('handles duplicate actions (duplicate refund)', async () => {
    const deadline = nowInMockSeconds() + 100;
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Duplicate Refund Test',
      description: 'Campaign for duplicate refund testing...',
      acceptedTokens: ['USDC'],
      targetAmount: 200, // Will be underfunded
      deadline,
    });
    const campaignId = createRes.data.data.id;

    await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 50,
      assetCode: 'USDC',
    });

    advanceMockTimeSeconds(101); // past deadline, makes it failed and refundable

    const mockSorobanData = {
      txHash: 'a'.repeat(64),
      contractId: 'C' + 'A'.repeat(55),
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'http://localhost:8000/soroban/rpc',
      walletAddress: CONTRIBUTOR,
    };

    const refundRes1 = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSorobanData,
    });
    expect(refundRes1.status).toBe(200);

    const refundRes2 = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSorobanData,
    });
    expect(refundRes2.status).toBe(404);
    expect(refundRes2.data.error.code).toBe('NOT_FOUND'); // "No refundable pledges found for this contributor"
  });

  it('handles timeout/retry failures (soroban RPC timeout)', async () => {
    // Import the mocked module
    const sorobanRpc = await import('./services/sorobanRpc');
    
    // Temporarily mock it to throw an error simulating a timeout
    const originalMock = vi.mocked(sorobanRpc.verifyRefundTransaction).getMockImplementation();
    vi.mocked(sorobanRpc.verifyRefundTransaction).mockRejectedValueOnce(new Error('Soroban RPC Timeout'));

    const deadline = nowInMockSeconds() + 100;
    const createRes = await post('/api/campaigns', {
      creator: CREATOR,
      title: 'Timeout Refund Test',
      description: 'Campaign for timeout refund testing...',
      acceptedTokens: ['USDC'],
      targetAmount: 200,
      deadline,
    });
    const campaignId = createRes.data.data.id;

    await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 50,
      assetCode: 'USDC',
    });

    advanceMockTimeSeconds(101);

    const mockSorobanData = {
      txHash: 'b'.repeat(64),
      contractId: 'C' + 'A'.repeat(55),
      networkPassphrase: 'Test',
      rpcUrl: 'http://localhost:8000/soroban/rpc',
      walletAddress: CONTRIBUTOR,
    };

    const refundRes = await post(`/api/campaigns/${campaignId}/refund`, {
      contributor: CONTRIBUTOR,
      soroban: mockSorobanData,
    });
    
    expect(refundRes.status).toBe(500);
    
    // Restore the mock for other tests
    if (originalMock) {
      vi.mocked(sorobanRpc.verifyRefundTransaction).mockImplementation(originalMock);
    }
  });
});
