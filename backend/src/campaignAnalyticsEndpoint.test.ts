import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

/**
 * Integration coverage for `GET /api/campaigns/:id/analytics` (issue #858, #859).
 *
 * The endpoint is a read-only analytics view, so its boundary is the path id
 * and the query string. These tests pin the deterministic standard error envelope
 * for 4xx validation/not-found responses alongside 500 unexpected failure sanitization.
 */

const TEST_DB_PATH = path.join(
  process.env.TEMP || '/tmp',
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
let resetDbForTests: (typeof import('./services/db'))['resetDbForTests'];

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
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, addPledge, initCampaignStore } = await import('./services/campaignStore'));
  ({ getDb, resetDbForTests } = await import('./services/db'));
  ({ app } = await import('./index'));

  initCampaignStore();
});

afterAll(() => {
  if (resetDbForTests) resetDbForTests();
  try { fs.rmSync(TEST_DB_PATH, { force: true }); } catch {}
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
    expect(response.body).toEqual({
      data: {
        campaignId: campaign.id,
        fundingGap: 775,
        status: 'open',
        percentFunded: 22.5,
        pledgeCount: 3,
        contributorCount: 2,
      },
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
  });

  it('rejects malformed path ids with standard 400 validation error envelope', async () => {
    for (const id of ['abc', '0', '-1', '1.5', '01']) {
      const response = await request(app).get(`/api/campaigns/${id}/analytics`);

      expect(response.status, `id=${id}`).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
      expect(typeof response.body.error.requestId).toBe('string');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
      );
    }
  });

  it('rejects unsupported query parameters instead of silently ignoring them', async () => {
    const campaign = seedCampaign();

    const single = await request(app).get(`/api/campaigns/${campaign.id}/analytics?page=2`);

    expect(single.status).toBe(400);
    expect(single.body).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
    expect(single.body.error.message).toContain('Unsupported query parameter: page');
    expect(typeof single.body.error.requestId).toBe('string');
    expect(single.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'query' })]),
    );

    const multiple = await request(app).get(
      `/api/campaigns/${campaign.id}/analytics?page=2&limit=10`,
    );

    expect(multiple.status).toBe(400);
    expect(multiple.body.error.message).toContain('limit');
    expect(multiple.body.error.message).toContain('page');
  });

  it('returns standard 404 envelope for a well-formed id that does not exist', async () => {
    const response = await request(app).get('/api/campaigns/999999/analytics');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Campaign not found.',
      },
    });
    expect(typeof response.body.error.requestId).toBe('string');
  });

  it('returns standard 500 error envelope without leaking storage details or stack when an unexpected error occurs', async () => {
    const campaign = seedCampaign();
    const db = getDb();

    // Force an unexpected storage failure inside getCampaignAnalytics by temporarily renaming the pledges table
    db.exec('ALTER TABLE pledges RENAME TO pledges_unavailable');
    try {
      const response = await request(app).get(`/api/campaigns/${campaign.id}/analytics`);

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      });
      expect(typeof response.body.error.requestId).toBe('string');
      expect(response.body.error.details).toBeUndefined();

      // Ensure no raw storage internals or stacks are leaked
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('SQLITE');
      expect(serialized).not.toContain('pledges_unavailable');
      expect(serialized).not.toContain('at ');
    } finally {
      db.exec('ALTER TABLE pledges_unavailable RENAME TO pledges');
    }
  });
});
