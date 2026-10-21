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

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR_A = `G${'B'.repeat(55)}`;
const CONTRIBUTOR_B = `G${'C'.repeat(55)}`;

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
  fs.rmpSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, addPledge, initCampaignStore } = await import('./services/campaignStore'));
  ({ getDb } = await import('./services/db'));
  ({ app } = await import('./index'));

  initCampaignStore();
});

afterAll(() => {
  fs.rmpSync(TEST_DB_PATH, { force: true });
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
    addPledge(campaign.id, { contributor: CONTRIBUTOR_P, amount: 75 });
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
    expect(response.body.meta.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
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
    expect(response.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('paginates the contributor list deterministically', async () => {
    const campaign = seedCampaign();
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_P, amount: 75 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 100 });

    const first = await request(app).get(
      `/api/campaigns/${campaign.id}/analytics?page=1&limit=`,
    );
    expect(first.status).toBe(200);
    expect(first.body.data.contributors).toHaveLength(1);
    expect(first.body.meta.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const second = await request(app).get(
      `/api/campaigns/${campaign.id}/analytics?page=2&limit=`,
    );
    expect(second.status).toBe(200);
    expect(second.body.data.contributors).toHaveLength(1);
    expect(second.body.meta.pagination).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });

    // Deterministic ordering: page 1 + page 2 cover the full set with no overlap.
    const ids = [
      ...first.body.data.contributors.map((c: { contributor: string }) => c.contributor),
      ...second.body.data.contributors.map((c: { contributor: string }) => c.contributor),
    ];
    expect(new Set(ids).size).toBe(2);
  });

  it('clamps oversized limits to the maximum page size', async () => {
    const campaign = seedCampaign();
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });

    const response = await request(app).get(
      `/api/campaigns/${campaign.id}/analytics?limit=100000`,
    );

    expect(response.status).toBe(200);
    expect(response.body.meta.pagination.limit).toBe(100);
  });

  it('rejects malformed pagination parameters with a 400', async () => {
    const campaign = seedCampaign();

    for (const query of ['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=-5', 'limit=abc']) {
      const response = await request(app).get(
        `/api/campaigns/${campaign.id}/analytics?${query}`,
      );
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

    const response = await request(app).get(
      `/api/campaigns/${campaign.id}/analytics?sort=desc`,
    );

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
