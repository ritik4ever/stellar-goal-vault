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
      title: 'Test API Campaign',
      description: 'Testing claim lifecycle',
      assetCode: 'USDC',
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
      title: 'Test Refund Campaign',
      description: 'Testing refund lifecycle',
      assetCode: 'XLM',
      targetAmount: 100,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.data.data.id;

    // 2. Pledge partial amount
    const pledgeRes = await post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount: 50,
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
});
