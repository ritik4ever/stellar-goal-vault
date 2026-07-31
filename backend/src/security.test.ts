import request from 'supertest';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

// Set environment before importing app (vi.hoisted runs before module loading)
vi.hoisted(() => {
  process.env.DB_PATH = ':memory:';
  process.env.NODE_ENV = 'test';
  process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
});

import { app } from './index';
import { initCampaignStore } from './services/campaignStore';

describe('Deep Health Check Endpoint', () => {
  beforeAll(() => {
    initCampaignStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 200 with component status when healthy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('overall');
    expect(response.body).toHaveProperty('components');
    expect(response.body.components).toHaveProperty('db');
    expect(response.body.components).toHaveProperty('soroban');
    expect(response.body.components).toHaveProperty('contract');
  });

  it('should include component status details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    const response = await request(app).get('/api/health/deep');

    expect(response.body.components.db).toHaveProperty('status');
    expect(response.body.components.db).toHaveProperty('details');
    expect(['up', 'down']).toContain(response.body.components.db.status);
  });

  it('should mark contract as up when CONTRACT_ID is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    const response = await request(app).get('/api/health/deep');

    expect(response.body.components.contract.status).toBe('up');
    expect(response.body.components.contract.details).toContain('configured');
  });

  it('should include timestamp in response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    const response = await request(app).get('/api/health/deep');

    expect(response.body).toHaveProperty('timestamp');
    expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
  });

  it('should return 503 if soroban RPC is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(503);
    expect(response.body.overall).toBe('down');
  });
});
