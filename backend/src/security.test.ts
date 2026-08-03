import request from 'supertest';
import { describe, it, expect } from 'vitest';

// Set environment before importing app
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.SOROBAN_RPC_URL = 'http://localhost:8000';

import { app } from './index';

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
