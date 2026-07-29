import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Express } from 'express';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-receipt-endpoint-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';

let app: Express;
let createCampaign: (typeof import('./services/campaignStore'))['createCampaign'];
let initCampaignStore: (typeof import('./services/campaignStore'))['initCampaignStore'];
let addPledge: (typeof import('./services/campaignStore'))['addPledge'];
let getPledges: (typeof import('./services/campaignStore'))['getPledges'];
let getDb: (typeof import('./services/db'))['getDb'];

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ createCampaign, initCampaignStore, addPledge, getPledges } = await import('./services/campaignStore'));
  ({ getDb } = await import('./services/db'));
  ({ app } = await import('./index'));

  initCampaignStore();
}, 60000);

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe('GET /api/campaigns/:id/pledges/:pledgeId/receipt', () => {
  it('returns a PDF receipt for a valid pledge', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Receipt Test Campaign',
      description: 'Testing receipt generation.',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: nowInSeconds() + 86400,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100 });
    const pledges = getPledges(campaign.id);
    const pledgeId = pledges[0].id;

    const res = await request(app).get(`/api/campaigns/${campaign.id}/pledges/${pledgeId}/receipt`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`attachment; filename=receipt-${pledgeId}.pdf`);
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown pledge ID', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Receipt Test Campaign',
      description: 'Testing receipt generation.',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: nowInSeconds() + 86400,
    });

    const res = await request(app).get(`/api/campaigns/${campaign.id}/pledges/999/receipt`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown campaign ID', async () => {
    const res = await request(app).get(`/api/campaigns/999/pledges/1/receipt`);

    expect(res.status).toBe(404);
  });
});
