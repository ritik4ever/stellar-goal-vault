import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Express } from 'express';

/** Integration coverage for GET /api/campaigns/:id/analytics (issue #862). */
const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-campaign-analytics-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_READ_LIMIT = '1000';

let app: Express;
let campaignStore: typeof import('./services/campaignStore');
let getDb: (typeof import('./services/db'))['getDb'];

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR_A = `G${'B'.repeat(55)}`;
const CONTRIBUTOR_B = `G${'C'.repeat(55)}`;

function seedCampaign(overrides: { targetAmount?: number } = {}) {
  return campaignStore.createCampaign({
    creator: CREATOR,
    title: 'Campaign analytics integration fixture',
    description: 'Campaign used to verify the campaign analytics endpoint contract.',
    assetCode: 'USDC',
    targetAmount: overrides.targetAmount ?? 1_000,
    deadline: Math.floor(Date.now() / 1000) + 3_600,
  });
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  campaignStore = await import('./services/campaignStore');
  ({ getDb } = await import('./services/db'));
  ({ app } = await import('./index'));
  campaignStore.initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM campaign_events').run();
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM pledges').run();
  db.prepare('DELETE FROM campaigns').run();
});

describe('GET /api/campaigns/:id/analytics', () => {
  it('returns analytics with a stable schema and request correlation metadata', async () => {
    const campaign = seedCampaign();
    campaignStore.addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });
    campaignStore.addPledge(campaign.id, { contributor: CONTRIBUTOR_B, amount: 175 });

    const response = await request(app)
      .get(`/api/campaigns/${campaign.id}/analytics`)
      .set('X-Request-Id', 'analytics-success');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('analytics-success');
    expect(response.body).toMatchObject({
      requestId: 'analytics-success',
      data: {
        campaignId: campaign.id,
        fundingGap: 775,
        status: 'open',
        percentFunded: 22.5,
        pledgeCount: 2,
        contributorCount: 2,
      },
    });
  });

  it('returns zero counts and the full funding gap for a campaign without pledges', async () => {
    const campaign = seedCampaign({ targetAmount: 2_000 });
    const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      campaignId: campaign.id,
      fundingGap: 2_000,
      percentFunded: 0,
      pledgeCount: 0,
      contributorCount: 0,
      status: 'open',
    });
  });

  it('rejects malformed or out-of-range path IDs with deterministic 400 responses', async () => {
    for (const id of ['abc', '0', '-1', '1.5', '01']) {
      const response = await request(app).get(`/api/campaigns/${id}/analytics`);

      expect(response.status, `id=${id}`).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('rejects unsupported query parameters instead of silently ignoring them', async () => {
    const campaign = seedCampaign();
    const response = await request(app).get(
      `/api/campaigns/${campaign.id}/analytics?page=2&limit=10`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('Unsupported query parameter: limit');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'query' })]),
    );
  });

  it('returns 404 for a well-formed campaign ID that does not exist', async () => {
    const response = await request(app).get('/api/campaigns/999999/analytics');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Campaign not found.',
      requestId: response.headers['x-request-id'],
    });
  });

  it('returns a sanitized 500 response when the analytics service fails', async () => {
    const campaign = seedCampaign();
    const serviceFailure = vi
      .spyOn(campaignStore, 'getCampaignAnalytics')
      .mockImplementation(() => {
        throw new Error('database details must not reach the client');
      });

    try {
      const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics`);

      expect(response.status).toBe(500);
      expect(response.body.error).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        requestId: response.headers['x-request-id'],
      });
      expect(JSON.stringify(response.body)).not.toContain('database details');
    } finally {
      serviceFailure.mockRestore();
    }
  });
});
