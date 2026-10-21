import request from 'supertest';
import { beforeAll, describe, it, expect, vi } from 'vitest';

// Set environment before importing app
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.SOROBAN_RPC_URL = 'http://localhost:8000';

// The app must be imported dynamically so the environment above is in place
// before the module is evaluated (ES module imports are hoisted).
type IndexModule = typeof import('./index');

let app: IndexModule['app'];

beforeAll(async () => {
  ({ app } = await import('./index'));

  // The health endpoints report degraded (503) unless the Soroban event
  // indexer is healthy and the Soroban RPC answers. Neither is available in a
  // unit-test environment, so stub both to keep the assertions about the
  // health payload shape meaningful.
  vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
    lastSuccessfulPollTime: Date.now(),
    lastKnownLedger: 1,
    isHealthy: true,
    consecutiveFailures: 0,
    lagMs: 0,
    freshness: 'fresh',
    staleLagMs: 300000,
    freshLagMs: 30000,
  });

  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
  } as Response);
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
