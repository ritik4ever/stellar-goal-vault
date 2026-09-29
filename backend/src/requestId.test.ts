import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./services/sorobanRpc', () => ({
  ensureSorobanRefundConfig: vi.fn(),
}));
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

import type { Express } from 'express';

import { REQUEST_ID_HEADER } from './middleware/requestId';
import { logger } from './logger';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-request-id-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';

let app: Express;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  const { initCampaignStore } = await import('./services/campaignStore');
  ({ app } = await import('./index'));
  initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request id middleware', () => {
  it('echoes an incoming X-Request-Id header', async () => {
    const response = await request(app)
      .get('/api/openapi.json')
      .set(REQUEST_ID_HEADER, 'client-request-123');

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe('client-request-123');
  });

  it('generates a unique X-Request-Id for each request without an incoming ID', async () => {
    const [first, second] = await Promise.all([
      request(app).get('/api/openapi.json'),
      request(app).get('/api/openapi.json'),
    ]);
    const firstId = first.headers[REQUEST_ID_HEADER.toLowerCase()];
    const secondId = second.headers[REQUEST_ID_HEADER.toLowerCase()];

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(secondId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(firstId).not.toBe(secondId);
  });

  it('adds IDs before request parsing and on public documentation endpoints', async () => {
    const malformedJson = await request(app)
      .post('/api/campaigns')
      .set('Content-Type', 'application/json')
      .send('{"invalid":');
    const openApi = await request(app).get('/api/openapi.json');

    expect(malformedJson.status).toBe(400);
    expect(malformedJson.headers[REQUEST_ID_HEADER.toLowerCase()]).toBeTruthy();
    expect(malformedJson.body.error.requestId).toBe(
      malformedJson.headers[REQUEST_ID_HEADER.toLowerCase()],
    );
    expect(openApi.status).toBe(200);
    expect(openApi.headers[REQUEST_ID_HEADER.toLowerCase()]).toBeTruthy();
  });

  it('exposes the request ID response header to cross-origin clients', async () => {
    const response = await request(app)
      .get('/api/openapi.json')
      .set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  it('includes request id in structured request logs', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await request(app).get('/api/openapi.json').set(REQUEST_ID_HEADER, 'log-context-request-id');

    await vi.waitFor(() => {
      const payload = infoSpy.mock.calls
        .map(([p]) => p as Record<string, unknown>)
        .find(
          (p) => p?.event === 'http_request' && p.requestId === 'log-context-request-id',
        );
      expect(payload, 'no http_request log found for log-context-request-id').toBeDefined();
    });

    infoSpy.mockRestore();
  });

  it('correlates campaign-list success and validation responses', async () => {
    const success = await request(app)
      .get('/api/campaigns')
      .set(REQUEST_ID_HEADER, 'campaign-list-success');

    expect(success.status).toBe(200);
    expect(success.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe('campaign-list-success');
    expect(success.body.requestId).toBe('campaign-list-success');

    const invalid = await request(app)
      .get('/api/campaigns?page=1')
      .set(REQUEST_ID_HEADER, 'campaign-list-invalid');

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          requestId: 'campaign-list-invalid',
        }),
      }),
    );
  });

  it('replaces unsafe incoming IDs with a generated correlation ID', async () => {
    const response = await request(app)
      .get('/api/campaigns')
      .set(REQUEST_ID_HEADER, 'bad id');

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(response.body.requestId).toBe(response.headers[REQUEST_ID_HEADER.toLowerCase()]);
  });

  it('correlates campaign-list success and validation responses', async () => {
    const success = await request(app)
      .get('/api/campaigns')
      .set(REQUEST_ID_HEADER, 'campaign-list-success');

    expect(success.status).toBe(200);
    expect(success.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe('campaign-list-success');
    expect(success.body.requestId).toBe('campaign-list-success');

    const invalid = await request(app)
      .get('/api/campaigns?page=1')
      .set(REQUEST_ID_HEADER, 'campaign-list-invalid');

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          requestId: 'campaign-list-invalid',
        }),
      }),
    );
  });

  it('replaces unsafe incoming IDs with a generated correlation ID', async () => {
    const response = await request(app)
      .get('/api/campaigns')
      .set(REQUEST_ID_HEADER, 'bad id');

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(response.body.requestId).toBe(response.headers[REQUEST_ID_HEADER.toLowerCase()]);
  });

});
