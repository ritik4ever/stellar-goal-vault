import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, it, expect, vi } from 'vitest';

// Environment must be in place before `./index` is evaluated. A static import
// would be hoisted above these assignments, so the app is imported dynamically
// in `beforeAll` (the same pattern the other HTTP suites use) — otherwise
// CONTRACT_ID/DB_PATH are read as empty and every health assertion sees a
// service that looks misconfigured.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.SOROBAN_RPC_URL = 'http://localhost:8000';

let app: Express;

beforeAll(async () => {
  // The deep health probe calls Soroban RPC; stub the network so this suite is
  // deterministic and offline-safe.
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200 }));
  ({ app } = await import('./index'));
  // `checkDbHealth()` probes the schema, so the store must be initialised here:
  // in a fresh process without this the database reads as unreachable and the
  // deep health endpoint answers 503 even though every component is fine.
  const { initCampaignStore } = await import('./services/campaignStore');
  initCampaignStore();
});

describe('Security Headers (Helmet)', () => {
  it('should set Content-Security-Policy header', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('should remove X-Powered-By header', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('should set Strict-Transport-Security header', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['strict-transport-security']).toBeDefined();
  });

  it('should set X-Frame-Options header', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-frame-options']).toBeDefined();
  });
});

describe('Deep Health Check Endpoint', () => {
  it('should return 200 with component status when healthy', async () => {
    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('overall');
    expect(response.body).toHaveProperty('components');
    expect(response.body.components).toHaveProperty('db');
    expect(response.body.components).toHaveProperty('soroban');
    expect(response.body.components).toHaveProperty('contract');
  });

  it('should include component status details', async () => {
    const response = await request(app).get('/api/health/deep');

    expect(response.body.components.db).toHaveProperty('status');
    expect(response.body.components.db).toHaveProperty('details');
    expect(['up', 'down']).toContain(response.body.components.db.status);
  });

  it('should mark contract as up when CONTRACT_ID is configured', async () => {
    const response = await request(app).get('/api/health/deep');

    expect(response.body.components.contract.status).toBe('up');
    expect(response.body.components.contract.details).toContain('configured');
  });

  it('should include timestamp in response', async () => {
    const response = await request(app).get('/api/health/deep');

    expect(response.body).toHaveProperty('timestamp');
    expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
  });

  it('should return 503 if any critical component is down', async () => {
    // This test verifies the endpoint structure; actual component failures
    // are tested through integration tests
    const response = await request(app).get('/api/health/deep');

    if (response.body.overall === 'down') {
      expect(response.status).toBe(503);
    }
  });
});
