import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-export-test-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

type CampaignStoreModule = typeof import('./services/campaignStore');
type DbModule = typeof import('./services/db');

let app: any;
let createCampaign: CampaignStoreModule['createCampaign'];
let addPledge: CampaignStoreModule['addPledge'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let getDb: DbModule['getDb'];

const CREATOR = `G${'A'.repeat(55)}`;
const OTHER_USER = `G${'B'.repeat(55)}`;
const CONTRIBUTOR_1 = `G${'C'.repeat(55)}`;
const CONTRIBUTOR_2 = `G${'D'.repeat(55)}`;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  const indexModule = await import('./index');
  app = indexModule.app;
  ({ createCampaign, addPledge, initCampaignStore } = await import('./services/campaignStore'));
  ({ getDb } = await import('./services/db'));
  initCampaignStore();
}, 30000);

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe('GET /api/campaigns/:id/pledges/export.csv', () => {
  it('returns 400 for invalid campaign ID format', async () => {
    const res = await request(app)
      .get('/api/campaigns/invalid-id/pledges/export.csv')
      .set('x-user-address', CREATOR);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for non-existent campaign', async () => {
    const res = await request(app)
      .get('/api/campaigns/999999/pledges/export.csv')
      .set('x-user-address', CREATOR);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when no creator header/query is provided', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Export Access Test',
      description: 'Testing unauthorized CSV export attempt.',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await request(app).get(`/api/campaigns/${campaign.id}/pledges/export.csv`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when a non-creator requests export', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Forbidden Export Test',
      description: 'Testing non-creator access restriction.',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    const res = await request(app)
      .get(`/api/campaigns/${campaign.id}/pledges/export.csv`)
      .set('x-user-address', OTHER_USER);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('exports pledges as CSV when requested by campaign creator via header', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Successful Export Test',
      description: 'Testing authorized creator CSV export.',
      assetCode: 'USDC',
      targetAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    const txHash1 = '1'.repeat(64);
    const txHash2 = '2'.repeat(64);

    addPledge(campaign.id, { contributor: CONTRIBUTOR_1, amount: 100, transactionHash: txHash1 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_2, amount: 250, transactionHash: txHash2 });

    const res = await request(app)
      .get(`/api/campaigns/${campaign.id}/pledges/export.csv`)
      .set('x-user-address', CREATOR);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`attachment; filename="campaign-${campaign.id}-pledges.export.csv"`);

    const lines = res.text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // Header + 2 data rows
    expect(lines[0]).toBe('contributor,amount,pledged_at,tx_hash,refunded_at,refund_tx_hash');

    expect(lines[1]).toContain(CONTRIBUTOR_1);
    expect(lines[1]).toContain('100');
    expect(lines[1]).toContain(txHash1);

    expect(lines[2]).toContain(CONTRIBUTOR_2);
    expect(lines[2]).toContain('250');
    expect(lines[2]).toContain(txHash2);
  });

  it('supports creator parameter via query string', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Query Param Export Test',
      description: 'Testing creator passed in query param.',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR_1, amount: 50 });

    const res = await request(app).get(`/api/campaigns/${campaign.id}/pledges/export.csv?creator=${CREATOR}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('streams large dataset of 10,000 pledges efficiently', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Large Dataset Streaming Export Test',
      description: 'Testing 10k pledge streaming performance.',
      assetCode: 'USDC',
      targetAmount: 1000000,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at, transaction_hash)
      VALUES (?, ?, ?, 'USDC', ?, ?)
    `);

    const now = Math.floor(Date.now() / 1000);
    const pledgeCount = 10000;

    const insertMany = db.transaction(() => {
      for (let i = 0; i < pledgeCount; i++) {
        insertStmt.run(campaign.id, `GUSER${String(i).padStart(52, '0')}`, 10 + (i % 100), now + i, `txhash${i}`);
      }
    });
    insertMany();

    const res = await request(app)
      .get(`/api/campaigns/${campaign.id}/pledges/export.csv`)
      .set('x-user-address', CREATOR);

    expect(res.status).toBe(200);
    const lines = res.text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(pledgeCount + 1); // Header + 10,000 rows
    expect(lines[0]).toBe('contributor,amount,pledged_at,tx_hash,refunded_at,refund_tx_hash');
    expect(lines[1]).toContain('GUSER0000000000000000000000000000000000000000000000000000');
    expect(lines[10000]).toContain('GUSER0000000000000000000000000000000000000000000000009999');
  }, 30000);
});
