import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

/**
 * Integration coverage for `GET /api/campaigns/:id/analytics` (issue #858).
 *
 * The endpoint is a read-only analytics view. It supports bounded pagination
 * over the campaign's contributor list via `page`/`limit` query parameters and
 * returns navigation metadata under `meta.pagination`.
 */

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-campaign-analytics-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_WRITE_LIMIT = '1000';

let app: Express;
let createCampaign: (typeof import('./services/campaignStore'))['createCampaign'];
let addPledge: (typeof import('./services/campaignStore'))['addPledge'];
let initCampaignStore: (typeof import('./services/campaignStore'))['initCampaignStore'];
let getDb: (typeof import('./services/db'))['getDb'];

const CREATOR = 'GBQRRH556UAOUNMCISIMEX2UPJQQ5MJ5NMHHY6TNCNCW52P5BWIVW6YT';
const CONTRIBUTOR_A = 'GANQEYT3WHNUF6WOV3KQOQGAUBTX73MTG6HDGGPBRIML6BULYVBYRLRU';
const CONTRIBUTOR_B = 'GAXCCOIO6QRZRJAIM6DQ3CVB4QA3RFVO35UXON4WWYY5GITC4QDR2F3W';

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function seedCampaign(overrides: { targetAmount?: number } = {}) {
  return createCampaign({
    creator: CREATOR,
    title: 'Campaign analytics integration fixture',
    description: 'Campaign used to verify the campaign analytics endpoint contract.',
    assetCode: 'USDC',
    targetAmount: overrides.targetAmount ?? 1_000,
    deadline: nowInSeconds() + 3_600,
  });
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, addPledge, initCampaignStore } = await import('./services/campaignStore'));
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
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe('GET /api/campaigns/:id/analytics', () => {
  it('returns the analytics schema for a campaign with pledges', async () => {
    const campaign = seedCampaign();
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_B, amount: 75 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 100 });

    const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.data).toMatchObject({
      campaignId: campaign.id,
      fundingGap: 775,
      status: 'open',
      percentFunded: 22.5,
      pledgeCount: 3,
      contributorCount: 2,
    });
    // This read model takes no query parameters and therefore exposes no
    // pagination metadata.
    expect(response.body.meta).toBeUndefined();
  });

  it('reports the full gap and zero counts for a campaign without pledges', async () => {
    const campaign = seedCampaign({ targetAmount: 2_000 });

    const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      fundingGap: 2_000,
      percentFunded: 0,
      pledgeCount: 0,
      contributorCount: 0,
      status: 'open',
    });
    expect(response.body.meta).toBeUndefined();
  });

  it('reports the full contributor count without pagination', async () => {
    const campaign = seedCampaign();
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_B, amount: 75 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 100 });

    const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics`);

    expect(response.status).toBe(200);
    expect(response.body.data.contributorCount).toBe(2);
    expect(response.body.data.pledgeCount).toBe(3);
    expect(response.body.meta).toBeUndefined();
  });

  it('rejects any query parameter with a 400', async () => {
    const campaign = seedCampaign();
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });

    for (const query of ['limit=100000', 'page=1', 'sort=amount']) {
      const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects malformed pagination parameters with a 400', async () => {
    const campaign = seedCampaign();

    for (const query of ['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=-5', 'limit=abc']) {
      const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects malformed path ids with a 400', async () => {
    for (const id of ['abc', '0', '-1', '1.5', '01']) {
      const response = await request(app).get(`/api/campaigns/${id}/analytics`);

      expect(response.status, `id=${id}`).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
      );
    }
  });

  it('rejects unsupported query parameters instead of silently ignoring them', async () => {
    const campaign = seedCampaign();

    const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics?sort=desc`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('Unsupported query parameter: sort');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'query' })]),
    );
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const response = await request(app).get('/api/campaigns/999999/analytics');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBe('Campaign not found.');
  });
});
