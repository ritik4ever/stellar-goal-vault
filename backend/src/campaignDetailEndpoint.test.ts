import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

/**
 * Integration coverage for `GET /api/campaigns/:id` (issue #852).
 *
 * These tests drive the endpoint over HTTP against an isolated SQLite file so
 * they exercise the real middleware chain: path validation, the campaign
 * detail cache, the 404 branch, and the central error handler. Every test
 * seeds its own campaign and `beforeEach` empties the tables, so no test
 * depends on another test having run first.
 */

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-campaign-detail-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';
// This file performs a handful of writes per test; the default write budget of
// 20/min is shared per client IP and would make unrelated assertions flaky.
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

function seedCampaign(overrides: { title?: string; targetAmount?: number } = {}) {
  return createCampaign({
    creator: CREATOR,
    title: overrides.title ?? 'Campaign detail integration fixture',
    description: 'Campaign used to verify the campaign detail endpoint contract.',
    assetCode: 'USDC',
    targetAmount: overrides.targetAmount ?? 1_000,
    deadline: nowInSeconds() + 3_600,
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
  // Detail responses are cached for 30s in-process; clear so a test never sees
  // a body produced by an earlier test.
  await invalidateCampaignCache();
});

describe('GET /api/campaigns/:id', () => {
  it('returns the campaign with progress and a newest-first pledge preview', async () => {
    const campaign = seedCampaign();

    for (let index = 0; index < 7; index += 1) {
      addPledge(campaign.id, {
        contributor: index % 2 === 0 ? CONTRIBUTOR_A : CONTRIBUTOR_B,
        amount: 10 + index,
      });
    }

    const response = await request(app).get(`/api/campaigns/${campaign.id}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['x-cache']).toBe('MISS');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.requestId).toBe(response.headers['x-request-id']);

    const body = response.body as {
      data: Record<string, unknown> & {
        progress: Record<string, unknown>;
        pledges: Array<{ id: number; amount: number; contributor: string }>;
      };
    };

    // Response schema: every field the frontend reads is present and typed.
    expect(body.data).toMatchObject({
      id: campaign.id,
      creator: CREATOR,
      title: 'Campaign detail integration fixture',
      acceptedTokens: ['USDC'],
      assetCode: 'USDC',
      targetAmount: 1_000,
      pledgedAmount: 91, // 10 + 11 + ... + 16
      deadline: campaign.deadline,
      createdAt: campaign.createdAt,
    });
    expect(typeof body.data.description).toBe('string');
    expect(body.data.progress).toMatchObject({
      status: 'open',
      percentFunded: 9.1,
      remainingAmount: 909,
      pledgeCount: 7,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    });
    expect(typeof body.data.progress.hoursLeft).toBe('number');

    // The detail endpoint intentionally returns a bounded preview, ordered
    // newest-first by (created_at DESC, id DESC).
    expect(body.data.pledges).toHaveLength(5);
    expect(body.data.pledges.map((pledge) => pledge.amount)).toEqual([16, 15, 14, 13, 12]);
    expect(body.data.history).toEqual([]);
  });

  it('rejects malformed ids with a deterministic 400 and a field-level detail', async () => {
    const malformedIds = ['abc', '0', '-1', '1.5', '01', '1e3', '1%2F2'];

    for (const id of malformedIds) {
      const first = await request(app).get(`/api/campaigns/${id}`);
      const second = await request(app).get(`/api/campaigns/${id}`);

      expect(first.status, `id=${id}`).toBe(400);
      expect(first.body.error.code).toBe('VALIDATION_ERROR');
      expect(first.body.error.message).toContain('Campaign ID');
      expect(first.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
      );
      expect(typeof first.body.error.requestId).toBe('string');

      // The error body is deterministic apart from the per-request correlation
      // id, so clients can assert on it.
      expect({ ...second.body.error, requestId: undefined }).toEqual({
        ...first.body.error,
        requestId: undefined,
      });
    }
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const response = await request(app).get('/api/campaigns/999999');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Campaign not found.' },
    });
    expect(typeof response.body.error.requestId).toBe('string');
  });

  it('returns a generic 500 without leaking storage details when the read fails', async () => {
    const campaign = seedCampaign();
    const db = getDb();

    // Simulate a server-side failure inside getCampaignWithProgress (the
    // pledges query) without stubbing the route: the campaign row still reads,
    // then the pledge preview query fails.
    db.exec('ALTER TABLE pledges RENAME TO pledges_unavailable');
    try {
      const response = await request(app).get(`/api/campaigns/${campaign.id}`);

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

  it('keeps each campaign in its own cache entry', async () => {
    const first = seedCampaign({ title: 'Cache isolation one' });
    const second = seedCampaign({ title: 'Cache isolation two' });

    const firstMiss = await request(app).get(`/api/campaigns/${first.id}`);
    const secondMiss = await request(app).get(`/api/campaigns/${second.id}`);
    const firstHit = await request(app)
      .get(`/api/campaigns/${first.id}`)
      .set('X-Request-Id', 'cache-hit-detail-req');

    expect(firstMiss.headers['x-cache']).toBe('MISS');
    expect(secondMiss.headers['x-cache']).toBe('MISS');
    expect(firstHit.headers['x-cache']).toBe('HIT');
    expect(firstHit.headers['x-request-id']).toBe('cache-hit-detail-req');
    expect(firstHit.body.requestId).toBe('cache-hit-detail-req');

    expect(firstMiss.body.data.id).toBe(first.id);
    expect(secondMiss.body.data.id).toBe(second.id);
    expect(firstHit.body.data.title).toBe('Cache isolation one');
    expect(secondMiss.body.data.title).toBe('Cache isolation two');
  });
});
