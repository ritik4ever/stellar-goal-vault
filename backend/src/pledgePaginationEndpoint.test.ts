import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

/**
 * Integration coverage for pledge pagination metadata (issue #855).
 *
 * `GET /api/campaigns/:id/pledges` and `GET /api/contributors/:address/pledges`
 * already accepted `page`/`limit`; these tests pin the navigation contract
 * (total, totalPages, hasPreviousPage, hasNextPage), the documented defaults,
 * deterministic ordering, and the 400s for invalid bounds.
 */

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-pledge-pagination-${process.pid}-${Date.now()}.db`,
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
let invalidateCampaignCache: (typeof import('./services/campaignCache'))['invalidateCampaignCache'];

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR_A = `G${'B'.repeat(55)}`;
const CONTRIBUTOR_B = `G${'C'.repeat(55)}`;

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function seedCampaign() {
  return createCampaign({
    creator: CREATOR,
    title: 'Campaign with paginated pledges',
    description: 'Campaign used to verify pledge pagination navigation metadata.',
    assetCode: 'USDC',
    targetAmount: 1_000,
    deadline: nowInSeconds() + 86_400,
  });
}

function seedThreePledges(campaignId: string): void {
  addPledge(campaignId, { contributor: CONTRIBUTOR_A, amount: 50 });
  addPledge(campaignId, { contributor: CONTRIBUTOR_B, amount: 75 });
  addPledge(campaignId, { contributor: CONTRIBUTOR_A, amount: 100 });
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, addPledge, initCampaignStore } = await import('./services/campaignStore'));
  ({ getDb } = await import('./services/db'));
  ({ invalidateCampaignCache } = await import('./services/campaignCache'));
  ({ app } = await import('./index'));

  initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(async () => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
  await invalidateCampaignCache();
});

describe('GET /api/campaigns/:id/pledges pagination metadata', () => {
  it('reports navigation metadata for the first and last page', async () => {
    const campaign = seedCampaign();
    seedThreePledges(campaign.id);

    const firstPage = await request(app).get(
      `/api/campaigns/${campaign.id}/pledges?page=1&limit=2`,
    );

    expect(firstPage.status).toBe(200);
    expect(firstPage.headers['x-total-count']).toBe('3');
    expect(firstPage.body.pagination).toEqual({
      total: 3,
      page: 1,
      limit: 2,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    });
    expect(firstPage.body.data).toHaveLength(2);
    // Deterministic ordering: newest first, ties broken by descending id.
    expect(firstPage.body.data.map((pledge: { amount: number }) => pledge.amount)).toEqual([
      100, 75,
    ]);

    const lastPage = await request(app).get(`/api/campaigns/${campaign.id}/pledges?page=2&limit=2`);

    expect(lastPage.status).toBe(200);
    expect(lastPage.body.pagination).toEqual({
      total: 3,
      page: 2,
      limit: 2,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    });
    expect(lastPage.body.data.map((pledge: { amount: number }) => pledge.amount)).toEqual([50]);
  });

  it('defaults to page 1 and limit 10 when pagination params are omitted', async () => {
    const campaign = seedCampaign();
    seedThreePledges(campaign.id);

    const response = await request(app).get(`/api/campaigns/${campaign.id}/pledges`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.pagination).toEqual({
      total: 3,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    });
  });

  it('keeps a page beyond the end empty but deterministic', async () => {
    const campaign = seedCampaign();
    seedThreePledges(campaign.id);

    const response = await request(app).get(`/api/campaigns/${campaign.id}/pledges?page=5&limit=2`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toMatchObject({
      total: 3,
      page: 5,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=1.5', 'limit'],
    ['page=1&limit=999', 'limit'],
  ])('rejects out-of-range pagination (%s) with a 400', async (query, field) => {
    const campaign = seedCampaign();
    seedThreePledges(campaign.id);

    const response = await request(app).get(`/api/campaigns/${campaign.id}/pledges?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });

  it('returns 404 before pagination metadata for a missing campaign', async () => {
    const response = await request(app).get('/api/campaigns/999999/pledges?page=1&limit=2');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.pagination).toBeUndefined();
  });
});

describe('GET /api/contributors/:address/pledges pagination metadata', () => {
  it('reports navigation metadata across campaigns for one contributor', async () => {
    const firstCampaign = seedCampaign();
    const secondCampaign = seedCampaign();
    addPledge(firstCampaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });
    addPledge(secondCampaign.id, { contributor: CONTRIBUTOR_A, amount: 100 });
    addPledge(secondCampaign.id, { contributor: CONTRIBUTOR_B, amount: 25 });

    const firstPage = await request(app).get(
      `/api/contributors/${CONTRIBUTOR_A}/pledges?page=1&limit=1`,
    );

    expect(firstPage.status).toBe(200);
    expect(firstPage.headers['x-total-count']).toBe('2');
    expect(firstPage.body.pagination).toEqual({
      total: 2,
      page: 1,
      limit: 1,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    const lastPage = await request(app).get(
      `/api/contributors/${CONTRIBUTOR_A}/pledges?page=2&limit=1`,
    );

    expect(lastPage.status).toBe(200);
    expect(lastPage.body.pagination).toEqual({
      total: 2,
      page: 2,
      limit: 1,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    });
    expect(lastPage.body.data).toHaveLength(1);
  });

  it('applies the same defaults and rejects the same invalid bounds', async () => {
    const defaults = await request(app).get(`/api/contributors/${CONTRIBUTOR_A}/pledges`);
    expect(defaults.status).toBe(200);
    expect(defaults.body.pagination).toMatchObject({ page: 1, limit: 10 });

    const invalid = await request(app).get(
      `/api/contributors/${CONTRIBUTOR_A}/pledges?page=1&limit=101`,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed contributor address', async () => {
    const response = await request(app).get('/api/contributors/not-a-stellar-address/pledges');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'address' })]),
    );
  });
});
