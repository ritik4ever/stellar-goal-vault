import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-history-endpoint-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';

let app: Express;
let createCampaign: (typeof import('./services/campaignStore'))['createCampaign'];
let initCampaignStore: (typeof import('./services/campaignStore'))['initCampaignStore'];
let recordEvent: (typeof import('./services/eventHistory'))['recordEvent'];
let getDb: (typeof import('./services/db'))['getDb'];

const CREATOR = `G${'A'.repeat(55)}`;

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, initCampaignStore } = await import('./services/campaignStore'));
  ({ recordEvent } = await import('./services/eventHistory'));
  ({ getDb } = await import('./services/db'));
  ({ app } = await import('./index'));

  initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

function seedHistory(campaignId: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    recordEvent(campaignId, 'updated', nowInSeconds() + index, CREATOR, undefined, {
      index,
    });
  }
}

describe('GET /api/campaigns/:id/history pagination', () => {
  it('returns default page 1 with pageSize 20 ordered newest first', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'History pagination campaign',
      description: 'Campaign used to verify paginated history responses.',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: nowInSeconds() + 3600,
    });

    seedHistory(campaign.id, 25);

    const response = await request(app).get(`/api/campaigns/${campaign.id}/history`);

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(1);
    expect(response.body.pageSize).toBe(20);
    expect(response.body.total).toBe(26);
    expect(response.body.data).toHaveLength(20);
    expect(response.body.hasMore).toBe(true);
    expect(response.body.data[0].timestamp).toBeGreaterThan(response.body.data[1].timestamp);
  });

  it('honors page and pageSize boundaries', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'History page two campaign',
      description: 'Campaign used to verify second-page history boundaries.',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: nowInSeconds() + 3600,
    });

    seedHistory(campaign.id, 25);

    const response = await request(app).get(
      `/api/campaigns/${campaign.id}/history?page=2&pageSize=10`,
    );

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(2);
    expect(response.body.pageSize).toBe(10);
    expect(response.body.total).toBe(26);
    expect(response.body.data).toHaveLength(10);
    expect(response.body.hasMore).toBe(true);
  });

  it('returns hasMore false on the final page', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'History final page campaign',
      description: 'Campaign used to verify final-page history metadata.',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: nowInSeconds() + 3600,
    });

    seedHistory(campaign.id, 4);

    const response = await request(app).get(
      `/api/campaigns/${campaign.id}/history?page=1&pageSize=20`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.hasMore).toBe(false);
  });

  it('rejects pageSize above 100', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'History validation campaign',
      description: 'Campaign used to verify invalid history pagination input.',
      assetCode: 'USDC',
      targetAmount: 100,
      deadline: nowInSeconds() + 3600,
    });

    const response = await request(app).get(
      `/api/campaigns/${campaign.id}/history?pageSize=101`,
    );

    expect(response.status).toBe(400);
  });
});
