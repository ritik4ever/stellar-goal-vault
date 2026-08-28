import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-reports-endpoint-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';
process.env.CAMPAIGN_REPORT_AUTO_FLAG_THRESHOLD = '3';
process.env.ADMIN_API_KEYS = 'test-admin-key';
// The write rate limit is read from env when `./index` is first imported.
// These suites fire many report/moderation mutations, so raise it to avoid 429s.
process.env.RATE_LIMIT_WRITE_LIMIT = '1000';

const ADMIN_HEADER = { Authorization: 'Bearer test-admin-key' };

let app: Express;
let createCampaign: (typeof import('./services/campaignStore'))['createCampaign'];
let initCampaignStore: (typeof import('./services/campaignStore'))['initCampaignStore'];
let getDb: (typeof import('./services/db'))['getDb'];

const CREATOR = `G${'A'.repeat(55)}`;
const REPORTER_A = `G${'B'.repeat(55)}`;
const REPORTER_B = `G${'C'.repeat(55)}`;
const REPORTER_C = `G${'D'.repeat(55)}`;
const REPORTER_D = `G${'E'.repeat(55)}`;

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function createFixtureCampaign(title = 'Reportable campaign') {
  return createCampaign({
    creator: CREATOR,
    title,
    description: 'A campaign used to verify the abuse reporting endpoints.',
    assetCode: 'USDC',
    targetAmount: 1000,
    deadline: nowInSeconds() + 86400,
  });
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, initCampaignStore } = await import('./services/campaignStore'));
  ({ getDb } = await import('./services/db'));
  ({ app } = await import('./index'));

  initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_reports`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe('POST /api/campaigns/:id/report', () => {
  it('stores a report with reporter, reason, and timestamp', async () => {
    const campaign = createFixtureCampaign();
    const before = nowInSeconds();

    const response = await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: REPORTER_A, reason: 'fraud', details: 'Looks like a scam.' });

    expect(response.status).toBe(201);
    expect(response.body.data.report).toMatchObject({
      campaignId: campaign.id,
      reporter: REPORTER_A,
      reason: 'fraud',
      details: 'Looks like a scam.',
      status: 'pending',
    });
    expect(response.body.data.report.createdAt).toBeGreaterThanOrEqual(before);
    expect(response.body.data.reportCount).toBe(1);
    expect(response.body.data.autoFlagged).toBe(false);

    const row = getDb()
      .prepare(`SELECT * FROM campaign_reports WHERE id = ?`)
      .get(response.body.data.report.id) as Record<string, unknown>;
    expect(row.reporter).toBe(REPORTER_A);
    expect(row.reason).toBe('fraud');
    expect(row.created_at).toBeGreaterThanOrEqual(before);
  });

  it('rejects an unknown reason', async () => {
    const campaign = createFixtureCampaign();
    const response = await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: REPORTER_A, reason: 'not-a-reason' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid reporter address', async () => {
    const campaign = createFixtureCampaign();
    const response = await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: 'not-a-key', reason: 'spam' });
    expect(response.status).toBe(400);
  });

  it('returns 404 for a campaign that does not exist', async () => {
    const response = await request(app)
      .post('/api/campaigns/999999/report')
      .send({ reporter: REPORTER_A, reason: 'spam' });
    expect(response.status).toBe(404);
  });

  it('rejects a second report from the same reporter on the same campaign', async () => {
    const campaign = createFixtureCampaign();
    await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: REPORTER_A, reason: 'spam' })
      .expect(201);

    const duplicate = await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: REPORTER_A, reason: 'fraud' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_REPORT');
  });

  it('auto-flags the campaign once the configurable threshold is reached', async () => {
    const campaign = createFixtureCampaign();

    for (const reporter of [REPORTER_A, REPORTER_B]) {
      const res = await request(app)
        .post(`/api/campaigns/${campaign.id}/report`)
        .send({ reporter, reason: 'duplicate' });
      expect(res.status).toBe(201);
      expect(res.body.data.autoFlagged).toBe(false);
    }

    const thirdReport = await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: REPORTER_C, reason: 'duplicate' });

    expect(thirdReport.status).toBe(201);
    expect(thirdReport.body.data.reportCount).toBe(3);
    expect(thirdReport.body.data.autoFlagThreshold).toBe(3);
    expect(thirdReport.body.data.autoFlagged).toBe(true);
    expect(thirdReport.body.data.flaggedForReview).toBe(true);

    const campaignRow = getDb()
      .prepare(`SELECT flagged_for_review, flagged_at FROM campaigns WHERE id = ?`)
      .get(campaign.id) as { flagged_for_review: number; flagged_at: number | null };
    expect(campaignRow.flagged_for_review).toBe(1);
    expect(campaignRow.flagged_at).toBeGreaterThan(0);

    // A later report should not re-flag (autoFlagged only true on the transition).
    const fourthReport = await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: REPORTER_D, reason: 'fraud' });
    expect(fourthReport.status).toBe(201);
    expect(fourthReport.body.data.autoFlagged).toBe(false);
    expect(fourthReport.body.data.flaggedForReview).toBe(true);
  });
});

describe('GET /api/admin/reports', () => {
  it('requires a valid admin key when ADMIN_API_KEYS is configured', async () => {
    await request(app).get('/api/admin/reports').expect(401);
    await request(app)
      .get('/api/admin/reports')
      .set('Authorization', 'Bearer wrong-key')
      .expect(401);
  });

  it('lists pending reports newest first with pagination metadata', async () => {
    const campaign = createFixtureCampaign();
    for (const reporter of [REPORTER_A, REPORTER_B, REPORTER_C]) {
      await request(app)
        .post(`/api/campaigns/${campaign.id}/report`)
        .send({ reporter, reason: 'spam' })
        .expect(201);
    }

    const response = await request(app).get('/api/admin/reports?page=1&limit=2').set(ADMIN_HEADER);

    expect(response.status).toBe(200);
    expect(response.headers['x-total-count']).toBe('3');
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2 });
    // Newest first: the two most recent report ids.
    expect(response.body.data[0].id).toBeGreaterThan(response.body.data[1].id);
    expect(response.body.data.every((r: { status: string }) => r.status === 'pending')).toBe(true);
  });

  it('filters by status and campaignId', async () => {
    const campaignOne = createFixtureCampaign('Campaign one');
    const campaignTwo = createFixtureCampaign('Campaign two');

    const first = await request(app)
      .post(`/api/campaigns/${campaignOne.id}/report`)
      .send({ reporter: REPORTER_A, reason: 'fraud' })
      .expect(201);
    await request(app)
      .post(`/api/campaigns/${campaignTwo.id}/report`)
      .send({ reporter: REPORTER_B, reason: 'fraud' })
      .expect(201);

    await request(app)
      .patch(`/api/admin/reports/${first.body.data.report.id}`)
      .set(ADMIN_HEADER)
      .send({ action: 'dismiss' })
      .expect(200);

    const pending = await request(app).get('/api/admin/reports').set(ADMIN_HEADER);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0].campaignId).toBe(campaignTwo.id);

    const dismissed = await request(app)
      .get('/api/admin/reports?status=dismissed')
      .set(ADMIN_HEADER);
    expect(dismissed.body.data).toHaveLength(1);
    expect(dismissed.body.data[0].campaignId).toBe(campaignOne.id);

    const all = await request(app).get('/api/admin/reports?status=all').set(ADMIN_HEADER);
    expect(all.body.data).toHaveLength(2);

    const byCampaign = await request(app)
      .get(`/api/admin/reports?status=all&campaignId=${campaignOne.id}`)
      .set(ADMIN_HEADER);
    expect(byCampaign.body.data).toHaveLength(1);
    expect(byCampaign.body.data[0].campaignId).toBe(campaignOne.id);
  });

  it('rejects an invalid status filter', async () => {
    await request(app).get('/api/admin/reports?status=bogus').set(ADMIN_HEADER).expect(400);
  });
});

describe('PATCH /api/admin/reports/:reportId', () => {
  async function fileReport(campaignId: string, reporter: string) {
    const res = await request(app)
      .post(`/api/campaigns/${campaignId}/report`)
      .send({ reporter, reason: 'fraud' })
      .expect(201);
    return res.body.data.report.id as number;
  }

  it('dismisses a report and records the resolver', async () => {
    const campaign = createFixtureCampaign();
    const reportId = await fileReport(campaign.id, REPORTER_A);

    const response = await request(app)
      .patch(`/api/admin/reports/${reportId}`)
      .set(ADMIN_HEADER)
      .send({ action: 'dismiss', admin: CREATOR });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: reportId,
      status: 'dismissed',
      resolvedBy: CREATOR,
    });
    expect(response.body.data.resolvedAt).toBeGreaterThan(0);
  });

  it('marks a report as actioned', async () => {
    const campaign = createFixtureCampaign();
    const reportId = await fileReport(campaign.id, REPORTER_A);

    const response = await request(app)
      .patch(`/api/admin/reports/${reportId}`)
      .set(ADMIN_HEADER)
      .send({ action: 'act' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('actioned');
  });

  it('returns 404 for an unknown report', async () => {
    await request(app)
      .patch('/api/admin/reports/424242')
      .set(ADMIN_HEADER)
      .send({ action: 'dismiss' })
      .expect(404);
  });

  it('returns 409 when the report was already resolved', async () => {
    const campaign = createFixtureCampaign();
    const reportId = await fileReport(campaign.id, REPORTER_A);

    await request(app)
      .patch(`/api/admin/reports/${reportId}`)
      .set(ADMIN_HEADER)
      .send({ action: 'dismiss' })
      .expect(200);

    const second = await request(app)
      .patch(`/api/admin/reports/${reportId}`)
      .set(ADMIN_HEADER)
      .send({ action: 'act' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPORT_ALREADY_RESOLVED');
  });

  it('rejects an invalid action', async () => {
    const campaign = createFixtureCampaign();
    const reportId = await fileReport(campaign.id, REPORTER_A);
    await request(app)
      .patch(`/api/admin/reports/${reportId}`)
      .set(ADMIN_HEADER)
      .send({ action: 'delete-everything' })
      .expect(400);
  });

  it('does not count dismissed reports toward the auto-flag threshold', async () => {
    const campaign = createFixtureCampaign();

    const idA = await fileReport(campaign.id, REPORTER_A);
    await fileReport(campaign.id, REPORTER_B);

    // Dismiss one; only one active report remains.
    await request(app)
      .patch(`/api/admin/reports/${idA}`)
      .set(ADMIN_HEADER)
      .send({ action: 'dismiss' })
      .expect(200);

    const third = await request(app)
      .post(`/api/campaigns/${campaign.id}/report`)
      .send({ reporter: REPORTER_C, reason: 'fraud' })
      .expect(201);

    // Active reports = REPORTER_B + REPORTER_C = 2, below the threshold of 3.
    expect(third.body.data.reportCount).toBe(2);
    expect(third.body.data.autoFlagged).toBe(false);

    const campaignRow = getDb()
      .prepare(`SELECT flagged_for_review FROM campaigns WHERE id = ?`)
      .get(campaign.id) as { flagged_for_review: number };
    expect(campaignRow.flagged_for_review).toBe(0);
  });
});
