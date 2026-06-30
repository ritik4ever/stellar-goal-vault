import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './index';
import { initCampaignStore } from './services/campaignStore';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-openapi-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';

describe('OpenAPI documentation endpoints', () => {
  beforeAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
    initCampaignStore();
  });

  afterAll(() => {
    try {
      fs.rmSync(TEST_DB_PATH, { force: true });
    } catch {
      // Ignore locked-file cleanup errors on Windows
    }
  });

  it('GET /api/docs returns a valid OpenAPI 3.1 JSON spec', async () => {
    const response = await request(app).get('/api/docs').expect(200);
    expect(response.headers['content-type']).toContain('application/json');

    const spec = response.body;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Stellar Goal Vault API');
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(spec.paths['/api/health']).toBeDefined();
    expect(spec.paths['/api/campaigns']).toBeDefined();
  });

  it('GET /api/docs/ui serves Swagger UI HTML', async () => {
    const response = await request(app).get('/api/docs/ui/').expect(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('swagger-ui');
    expect(response.text).toContain('swagger-ui-bundle.js');
  });

  it('OpenAPI spec documents all campaign endpoints', async () => {
    const response = await request(app).get('/api/docs').expect(200);
    const spec = response.body;

    const expectedPaths = [
      '/api/health',
      '/api/health/deep',
      '/api/campaigns',
      '/api/campaigns/{id}',
      '/api/campaigns/{id}/pledges',
      '/api/campaigns/{id}/pledges/reconcile',
      '/api/campaigns/{id}/claim',
      '/api/campaigns/{id}/refund',
      '/api/campaigns/{id}/contributors',
      '/api/campaigns/{id}/history',
      '/api/open-issues',
      '/api/config',
      '/api/stats',
      '/api/leaderboard',
      '/api/docs',
    ];

    for (const pathName of expectedPaths) {
      expect(spec.paths[pathName]).toBeDefined();
    }
  });
});
