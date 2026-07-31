import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-metrics-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.NODE_ENV = 'test';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

let app: typeof import('./index').app;
let addPledge: typeof import('./services/campaignStore').addPledge;
let createCampaign: typeof import('./services/campaignStore').createCampaign;
let getDb: typeof import('./services/db').getDb;
let resetMetrics: typeof import('./metrics').resetMetrics;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ app } = await import('./index'));
  const campaignStore = await import('./services/campaignStore');
  ({ addPledge, createCampaign } = campaignStore);
  ({ getDb } = await import('./services/db'));
  ({ resetMetrics } = await import('./metrics'));
  campaignStore.initCampaignStore();
});

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.METRICS_USERNAME;
  delete process.env.METRICS_PASSWORD;
  resetMetrics();

  const db = getDb();
  db.prepare('DELETE FROM campaign_events').run();
  db.prepare('DELETE FROM pledges').run();
  db.prepare('DELETE FROM campaigns').run();
});

afterAll(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.METRICS_USERNAME;
  delete process.env.METRICS_PASSWORD;
  fs.rmSync(TEST_DB_PATH, { force: true });
});

describe('GET /metrics', () => {
  it('returns the Prometheus exposition format', async () => {
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(
      /^text\/plain;.*version=0\.0\.4/,
    );
    expect(response.text).toContain('# TYPE request_count counter');
    expect(response.text).toContain('# TYPE request_duration_ms histogram');
    expect(response.text).toContain('# TYPE pledge_count gauge');
    expect(response.text).toContain('# TYPE campaign_count gauge');
    expect(response.text).toContain('# TYPE error_count counter');
  });

  it('tracks requests, durations, errors, campaigns, and pledges', async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Metrics campaign',
      description: 'Campaign used to verify persisted Prometheus gauges.',
      acceptedTokens: ['XLM'],
      targetAmount: 100,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    addPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      assetCode: 'XLM',
    });

    await request(app).get('/api/health').expect(200);
    await request(app).get('/missing/one').expect(404);
    await request(app).get('/missing/two').expect(404);
    const response = await request(app).get('/metrics').expect(200);

    expect(response.text).toMatch(
      /request_count\{method="GET",route="\/api\/health",status_code="200"\} 1/,
    );
    expect(response.text).toContain('request_duration_ms_bucket{');
    expect(response.text).toMatch(
      /error_count\{method="GET",route="unmatched",status_code="404"\} 2/,
    );
    expect(response.text).not.toContain('/missing/one');
    expect(response.text).not.toContain('/missing/two');
    expect(response.text).toContain('campaign_count 1');
    expect(response.text).toContain('pledge_count 1');
  });

  it('requires valid Basic auth in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.METRICS_USERNAME = 'prometheus';
    process.env.METRICS_PASSWORD = 'scrape-secret';

    const unauthenticated = await request(app).get('/metrics');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers['www-authenticate']).toContain('Basic');

    await request(app)
      .get('/metrics')
      .auth('prometheus', 'wrong-secret')
      .expect(401);

    await request(app)
      .get('/metrics')
      .auth('prometheus', 'scrape-secret')
      .expect(200);
  });

  it('fails closed when production credentials are missing', async () => {
    process.env.NODE_ENV = 'production';

    const response = await request(app).get('/metrics');
    expect(response.status).toBe(503);
  });
});
