import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Express } from 'express';

import {
  buildCampaignInput,
  buildPledgeInput,
  FIXTURE_EPOCH_SECONDS,
  freezeClock,
  ONE_DAY_SECONDS,
  ONE_HOUR_SECONDS,
  type Clock,
  WALLETS,
} from './fixtures';

/**
 * API integration suite (fixture-driven, frozen clock).
 *
 * Every test builds isolated state from `tests/fixtures.ts` builders and runs
 * against a frozen `Date.now()`, so campaign status transitions never depend on
 * the wall clock (issue #978). No external/mutable data is used.
 */

vi.mock('../src/services/sorobanRpc', () => ({
  ensureSorobanRefundConfig: vi.fn(),
  verifyRefundTransaction: vi.fn().mockResolvedValue({
    txHash: 'mock-tx-hash',
    status: 'SUCCESS',
    ledger: 100,
    createdAt: 1_700_000_000,
    latestLedger: 100,
  }),
}));

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `stellar-goal-vault-integration-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = 'mock-contract';
process.env.NODE_ENV = 'test';

let app: Express;
let initCampaignStore: (typeof import('../src/services/campaignStore'))['initCampaignStore'];
let getCampaignWithProgress: (typeof import('../src/services/campaignStore'))['getCampaignWithProgress'];
let getDb: (typeof import('../src/services/db'))['getDb'];
let resetDbForTests: (typeof import('../src/services/db'))['resetDbForTests'];
let clock: Clock;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ app } = await import('../src/index'));
  ({ initCampaignStore, getCampaignWithProgress } = await import('../src/services/campaignStore'));
  ({ getDb, resetDbForTests } = await import('../src/services/db'));
  initCampaignStore();
});

afterAll(() => {
  resetDbForTests();
  try {
    fs.rmSync(TEST_DB_PATH, { force: true });
  } catch {
    // Windows can briefly hold the SQLite file handle; leaving a temp file is harmless.
  }
});

beforeEach(() => {
  clock = freezeClock();
  const db = getDb();
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

afterEach(() => {
  clock.restore();
});

async function createCampaign(overrides: Partial<Parameters<typeof buildCampaignInput>[0]> = {}) {
  const response = await request(app).post('/api/campaigns').send(buildCampaignInput(overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('Campaign lifecycle with deterministic fixtures', () => {
  it('create → pledge → funded → claim', async () => {
    const campaignId = await createCampaign({ targetAmount: 100 });

    const pledge = await request(app)
      .post(`/api/campaigns/${campaignId}/pledges`)
      .send(buildPledgeInput({ amount: 100 }));

    expect(pledge.status).toBe(201);
    expect(pledge.body.data.progress.status).toBe('funded');
    expect(pledge.body.data.progress.canClaim).toBe(false);

    // Cross the deadline using the frozen clock (no wall-clock dependency).
    clock.advance(ONE_DAY_SECONDS + ONE_HOUR_SECONDS);

    const claim = await request(app)
      .post(`/api/campaigns/${campaignId}/claim`)
      .send({
        creator: WALLETS.creator,
        transactionHash: 'a'.repeat(64),
        confirmedAt: FIXTURE_EPOCH_SECONDS + ONE_DAY_SECONDS + ONE_HOUR_SECONDS,
      });

    expect(claim.status).toBe(200);
    expect(claim.body.data.progress.status).toBe('claimed');
  });

  it('create → partial pledge → failed → refund', async () => {
    const campaignId = await createCampaign({
      targetAmount: 500,
      acceptedTokens: ['XLM'],
    });

    const pledge = await request(app)
      .post(`/api/campaigns/${campaignId}/pledges`)
      .send(buildPledgeInput({ amount: 50, assetCode: 'XLM' }));
    expect(pledge.status).toBe(201);

    const refundBody = {
      contributor: WALLETS.alice,
      soroban: {
        txHash: 'b'.repeat(64),
        contractId: `C${'A'.repeat(55)}`,
        networkPassphrase: 'Test SDF Network ; September 2015',
        rpcUrl: 'http://localhost:8000/soroban/rpc',
        walletAddress: WALLETS.alice,
      },
    };

    // Refund before the deadline is rejected.
    const early = await request(app).post(`/api/campaigns/${campaignId}/refund`).send(refundBody);
    expect(early.status).toBe(400);

    clock.advance(ONE_DAY_SECONDS + ONE_HOUR_SECONDS);

    const refund = await request(app).post(`/api/campaigns/${campaignId}/refund`).send(refundBody);
    expect(refund.status).toBe(200);
    expect(refund.body.data.refundedAmount).toBe(50);
    expect(refund.body.data.pledgedAmount).toBe(0);
  });
});

describe('Time-dependent campaign states', () => {
  it('derives open → failed purely from the frozen clock', async () => {
    const campaignId = await createCampaign({
      targetAmount: 1_000,
      deadline: FIXTURE_EPOCH_SECONDS + ONE_HOUR_SECONDS,
    });

    // Use the store directly so the assertion is not affected by the API's
    // short-lived response cache.
    expect(getCampaignWithProgress(campaignId)?.progress.status).toBe('open');

    clock.advance(ONE_HOUR_SECONDS + 1);

    expect(getCampaignWithProgress(campaignId)?.progress.status).toBe('failed');
  });
});

describe('Fixture isolation', () => {
  it('keeps independently-fixtured campaigns isolated', async () => {
    const usdcCampaign = await createCampaign({
      title: 'USDC campaign',
      acceptedTokens: ['USDC'],
      targetAmount: 100,
    });
    const xlmCampaign = await createCampaign({
      title: 'XLM campaign',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
    });

    await request(app)
      .post(`/api/campaigns/${usdcCampaign}/pledges`)
      .send(buildPledgeInput({ amount: 40, assetCode: 'USDC' }));

    const usdcDetail = await request(app).get(`/api/campaigns/${usdcCampaign}`);
    const xlmDetail = await request(app).get(`/api/campaigns/${xlmCampaign}`);

    expect(usdcDetail.body.data.pledgedAmount).toBe(40);
    expect(xlmDetail.body.data.pledgedAmount).toBe(0);
  });
});
