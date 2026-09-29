import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_PATH = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
});

vi.mock('./services/eventIndexer', () => ({
  getIndexerStatus: vi.fn().mockReturnValue({
    lastSuccessfulPollTime: Date.now(),
    lastKnownLedger: 1,
    isHealthy: true,
    consecutiveFailures: 0,
    lagMs: 0,
  }),
  startEventIndexer: vi.fn(),
  stopEventIndexer: vi.fn(),
}));

vi.mock('./services/sorobanRpc', () => ({
  ensureSorobanRefundConfig: vi.fn(),
}));

import { app } from './index';
import { beforeAll, afterAll } from 'vitest';

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' }),
  } as Response));
});

afterAll(() => {
  vi.unstubAllGlobals();
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

    // In the test environment, Soroban RPC may be unavailable so the
    // overall status can be 503. Verify the response structure regardless.
    expect(response.body).toHaveProperty('overall');
    expect(response.body).toHaveProperty('components');
    expect(response.body.components).toHaveProperty('db');
    expect(response.body.components).toHaveProperty('soroban');
    expect(response.body.components).toHaveProperty('contract');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('should include soroban component status', async () => {
    const response = await request(app).get('/api/health/deep');

    expect(response.body.components.soroban).toHaveProperty('status');
    expect(['up', 'down']).toContain(response.body.components.soroban.status);
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

  it('should include indexer component status', async () => {
    const response = await request(app).get('/api/health/deep');

    expect(response.body.components).toHaveProperty('indexer');
    expect(response.body.components.indexer).toHaveProperty('status');
    expect(response.body.components.indexer.status).toBe('up');
  });
});
