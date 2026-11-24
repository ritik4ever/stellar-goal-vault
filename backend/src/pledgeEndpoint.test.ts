import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

/**
 * Integration coverage for the pledge endpoints:
 * - `POST /api/campaigns/:id/pledges`
 * - `GET /api/campaigns/:id/pledges`
 *
 * Drives the endpoints over HTTP against an isolated SQLite file to exercise
 * the entire middleware chain: rate limiting, validation, campaign store transactions,
 * cache invalidation, not-found handling, and centralized error handling.
 * Every test uses isolated data and does not depend on execution order.
 */

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-pledge-endpoint-${process.pid}-${Date.now()}.db`,
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

function seedCampaign(
  overrides: {
    title?: string;
    targetAmount?: number;
    deadline?: number;
    maxPerContributor?: number;
    acceptedTokens?: string[];
  } = {},
) {
  return createCampaign({
    creator: CREATOR,
    title: overrides.title ?? 'Pledge endpoint integration campaign',
    description: 'Campaign used to verify pledge endpoint request and error contracts.',
    assetCode: 'USDC',
    targetAmount: overrides.targetAmount ?? 1_000,
    deadline: overrides.deadline ?? nowInSeconds() + 86_400,
    maxPerContributor: overrides.maxPerContributor,
    acceptedTokens: overrides.acceptedTokens,
  });
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

describe('POST /api/campaigns/:id/pledges', () => {
  it('records a pledge and returns updated campaign with progress', async () => {
    const campaign = seedCampaign({ targetAmount: 1_000 });

    const response = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
      contributor: CONTRIBUTOR_A,
      amount: 250,
      assetCode: 'USDC',
    });

    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toContain('application/json');

    const body = response.body;
    expect(body.data).toMatchObject({
      id: campaign.id,
      creator: CREATOR,
      title: 'Pledge endpoint integration campaign',
      assetCode: 'USDC',
      targetAmount: 1_000,
      pledgedAmount: 250,
      deadline: campaign.deadline,
      createdAt: campaign.createdAt,
    });

    expect(body.data.progress).toMatchObject({
      status: 'open',
      percentFunded: 25,
      remainingAmount: 750,
      pledgeCount: 1,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    });
    expect(typeof body.data.progress.hoursLeft).toBe('number');

    // A second pledge from another contributor updates totals and progress
    const secondResponse = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
      contributor: CONTRIBUTOR_B,
      amount: 750,
      assetCode: 'USDC',
    });

    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body.data.pledgedAmount).toBe(1_000);
    expect(secondResponse.body.data.progress).toMatchObject({
      status: 'funded',
      percentFunded: 100,
      remainingAmount: 0,
      pledgeCount: 2,
      canPledge: false,
    });
  });

  it('rejects malformed campaign IDs with 400 and a field-level detail', async () => {
    const malformedIds = ['abc', '0', '-1', '1.5', '01'];

    for (const id of malformedIds) {
      const response = await request(app).post(`/api/campaigns/${id}/pledges`).send({
        contributor: CONTRIBUTOR_A,
        amount: 50,
        assetCode: 'USDC',
      });

      expect(response.status, `id=${id}`).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
      );
      expect(typeof response.body.error.requestId).toBe('string');
    }
  });

  it('rejects invalid request body fields with 400 VALIDATION_ERROR', async () => {
    const campaign = seedCampaign();

    // Missing body
    const missingBody = await request(app)
      .post(`/api/campaigns/${campaign.id}/pledges`)
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(missingBody.status).toBe(400);
    expect(missingBody.body.error.code).toBe('VALIDATION_ERROR');

    // Invalid contributor address (not a valid 56-char Stellar public key)
    const invalidAddress = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
      contributor: 'invalid-stellar-address',
      amount: 50,
    });
    expect(invalidAddress.status).toBe(400);
    expect(invalidAddress.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidAddress.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'contributor' })]),
    );

    // Negative or zero amount
    for (const amount of [-50, 0]) {
      const invalidAmount = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
        contributor: CONTRIBUTOR_A,
        amount,
      });
      expect(invalidAmount.status).toBe(400);
      expect(invalidAmount.body.error.code).toBe('VALIDATION_ERROR');
      expect(invalidAmount.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'amount' })]),
      );
    }
  });

  it('rejects pledge when token is not accepted by the campaign', async () => {
    const campaign = seedCampaign({ acceptedTokens: ['USDC'] });

    const response = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
      contributor: CONTRIBUTOR_A,
      amount: 50,
      assetCode: 'UNKNOWN_TOKEN',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ASSET');
    expect(response.body.error.message).toContain('not accepted');
  });

  it('rejects pledge when contributor limit is exceeded', async () => {
    const campaign = seedCampaign({ targetAmount: 1_000, maxPerContributor: 100 });

    const first = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
      contributor: CONTRIBUTOR_A,
      amount: 80,
    });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
      contributor: CONTRIBUTOR_A,
      amount: 30,
    });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('MAX_PER_CONTRIBUTOR_EXCEEDED');
    expect(second.body.error.message).toContain('maximum allowed per contributor');
  });

  it('rejects pledge that exceeds campaign funding cap', async () => {
    const campaign = seedCampaign({ targetAmount: 100 });

    const response = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
      contributor: CONTRIBUTOR_A,
      amount: 150,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CAMPAIGN_FUNDING_CAP_EXCEEDED');
    expect(response.body.error.message).toContain('exceeds campaign funding cap');
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const response = await request(app).post('/api/campaigns/999999/pledges').send({
      contributor: CONTRIBUTOR_A,
      amount: 50,
      assetCode: 'USDC',
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Campaign not found.' },
    });
    expect(typeof response.body.error.requestId).toBe('string');
  });

  it('returns a generic 500 without leaking storage details on server-side failure', async () => {
    const campaign = seedCampaign();
    const db = getDb();

    db.exec('ALTER TABLE pledges RENAME TO pledges_unavailable');
    try {
      const response = await request(app).post(`/api/campaigns/${campaign.id}/pledges`).send({
        contributor: CONTRIBUTOR_A,
        amount: 50,
        assetCode: 'USDC',
      });

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
      });
      expect(typeof response.body.error.requestId).toBe('string');
      expect(response.body.error.details).toBeUndefined();

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('SQLITE');
      expect(serialized).not.toContain('pledges_unavailable');
      expect(serialized).not.toContain('at ');
    } finally {
      db.exec('ALTER TABLE pledges_unavailable RENAME TO pledges');
    }
  });
});

describe('GET /api/campaigns/:id/pledges', () => {
  it('returns paginated pledges for a campaign with total counts', async () => {
    const campaign = seedCampaign();
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_B, amount: 100 });

    const response = await request(app).get(`/api/campaigns/${campaign.id}/pledges`);

    expect(response.status).toBe(200);
    expect(response.headers['x-total-count']).toBe('2');
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination).toMatchObject({
      total: 2,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect(response.body.data[0]).toMatchObject({
      campaignId: campaign.id,
      amount: 100,
      contributor: CONTRIBUTOR_B,
    });
  });

  it('rejects malformed campaign IDs with 400 VALIDATION_ERROR', async () => {
    const response = await request(app).get('/api/campaigns/invalid-id/pledges');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
    );
  });

  it('returns 404 when listing pledges for a nonexistent campaign', async () => {
    const response = await request(app).get('/api/campaigns/999999/pledges');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBe('Campaign not found.');
  });

  it('returns a generic 500 without leaking storage details on query failure', async () => {
    const campaign = seedCampaign();
    const db = getDb();

    db.exec('ALTER TABLE pledges RENAME TO pledges_unavailable');
    try {
      const response = await request(app).get(`/api/campaigns/${campaign.id}/pledges`);

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
      });
      expect(typeof response.body.error.requestId).toBe('string');
      expect(response.body.error.details).toBeUndefined();

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('SQLITE');
      expect(serialized).not.toContain('pledges_unavailable');
    } finally {
      db.exec('ALTER TABLE pledges_unavailable RENAME TO pledges');
    }
  });
});
