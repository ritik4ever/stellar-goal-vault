import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Express } from 'express';

import {
  FIXTURE_EPOCH_SECONDS,
  WALLETS,
  buildCampaignInput,
  freezeClock,
  type Clock,
} from './fixtures';

vi.mock('../src/services/sorobanRpc', () => ({
  ensureSorobanRefundConfig: vi.fn(),
  verifyRefundTransaction: vi.fn().mockResolvedValue({
    txHash: 'mock-tx-hash',
    status: 'SUCCESS',
    ledger: 100,
    createdAt: FIXTURE_EPOCH_SECONDS,
    latestLedger: 100,
  }),
}));

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `stellar-goal-vault-list-scale-${process.pid}-${Date.now()}.db`,
);
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = 'mock-contract';
process.env.NODE_ENV = 'test';

const CAMPAIGN_COUNT = 750;
const PAGE_SIZE = 20;
const GENEROUS_BUDGET_MS = 30_000;

let app: Express;
let initCampaignStore: (typeof import('../src/services/campaignStore'))['initCampaignStore'];
let listCampaigns: (typeof import('../src/services/campaignStore'))['listCampaigns'];
let clock: Clock;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ app } = await import('../src/index'));
  ({ initCampaignStore, listCampaigns } = await import('../src/services/campaignStore'));
  initCampaignStore();
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DB_PATH, { force: true });
  } catch {}
});

beforeEach(() => {
  clock = freezeClock();
  const { getDb } = require('../src/services/db');
  const db = getDb();
  db.prepare('DELETE FROM campaign_events').run();
  db.prepare('DELETE FROM pledges').run();
  db.prepare('DELETE FROM campaigns').run();
});

afterEach(() => {
  clock.restore();
});

describe('campaign list large-dataset regression', () => {
  it('keeps pagination correct and records stable signal for 750 campaigns', async () => {
    const assets: string[] = ['USDC', 'XLM', 'EURC'];
    const startedInsert = Date.now();
    for (let i = 0; i < CAMPAIGN_COUNT; i += 1) {
      const asset = assets[i % assets.length];
      // Use deterministic title for search
      const title = `Scale campaign ${i} — ${asset}`;
      const input = buildCampaignInput({
        title,
        creator: WALLETS.creator,
        acceptedTokens: [asset],
        targetAmount: 1000 + (i % 50) * 100,
        deadline: FIXTURE_EPOCH_SECONDS + 86_400 + i,
        description: `Deterministic scale campaign ${i} with sufficiently long description for validation.`,
      });
      // Direct store insert avoids HTTP but still exercises list path
      const { createCampaign } = await import('../src/services/campaignStore');
      createCampaign(input);
    }
    const insertMs = Date.now() - startedInsert;
    console.info(`[campaign-list-scale] inserted ${CAMPAIGN_COUNT} campaigns in ${insertMs}ms`);

    // Correctness via store helper
    const direct = listCampaigns({ page: 1, limit: PAGE_SIZE, sort: 'createdAt', order: 'desc' });
    expect(direct.totalCount).toBe(CAMPAIGN_COUNT);

    // Pagination via HTTP: walk all pages, verify total/totalPages and uniqueness
    const allIds: string[] = [];
    const startedPaginate = Date.now();
    const totalPages = Math.ceil(CAMPAIGN_COUNT / PAGE_SIZE);
    for (let page = 1; page <= totalPages; page += 1) {
      const res = await request(app)
        .get(`/api/campaigns?page=${page}&limit=${PAGE_SIZE}`)
        .expect(200);
      expect(res.body.pagination.total).toBe(CAMPAIGN_COUNT);
      expect(res.body.pagination.totalPages).toBe(totalPages);
      expect(res.body.pagination.page).toBe(page);
      const data = res.body.data as Array<{ id: string }>;
      if (page < totalPages) expect(data).toHaveLength(PAGE_SIZE);
      else expect(data.length).toBeGreaterThan(0);
      allIds.push(...data.map((c) => c.id));
    }
    const paginateMs = Date.now() - startedPaginate;
    expect(new Set(allIds).size).toBe(CAMPAIGN_COUNT);

    // Search/filter at scale
    const searchRes = await request(app)
      .get(`/api/campaigns?search=${encodeURIComponent('Scale campaign 42')}&page=1&limit=20`)
      .expect(200);
    expect(searchRes.body.data.length).toBeGreaterThan(0);

    const filterRes = await request(app)
      .get(`/api/campaigns?asset=USDC&status=open&page=1&limit=20&sort=createdAt&order=desc`)
      .expect(200);
    // All returned should be USDC and open
    for (const c of filterRes.body.data as Array<any>) {
      expect(c.assetCode === 'USDC' || c.acceptedTokens?.includes('USDC')).toBeTruthy();
    }

    const elapsed = Date.now() - startedInsert;
    const perCampaign = elapsed / CAMPAIGN_COUNT;
    console.info(
      `[campaign-list-scale] ${CAMPAIGN_COUNT} campaigns paginated ${paginateMs}ms total ${elapsed}ms (${perCampaign.toFixed(3)}ms/campaign)`,
    );
    expect(elapsed).toBeLessThan(GENEROUS_BUDGET_MS);
  });
});
