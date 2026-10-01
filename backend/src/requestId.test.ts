import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Express } from 'express';

import { logger } from './logger';
import { describeRoute, REQUEST_ID_HEADER } from './middleware/requestId';

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
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(secondId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
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
    // The backend uses pino which does not route through console.info.
    // Spy on logger.info to capture the structured http_request log line
    // emitted by the requestIdMiddleware finish handler.
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await request(app).get('/api/openapi.json').set(REQUEST_ID_HEADER, 'log-context-request-id');

    await vi.waitFor(() => {
      const payload = infoSpy.mock.calls
        .map(([p]) => p as Record<string, unknown>)
        .find((p) => p?.event === 'http_request' && p.requestId === 'log-context-request-id');
      expect(payload, 'no http_request log found for log-context-request-id').toBeDefined();
    });
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
    const response = await request(app).get('/api/campaigns').set(REQUEST_ID_HEADER, 'bad id');

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(response.body.requestId).toBe(response.headers[REQUEST_ID_HEADER.toLowerCase()]);
  });

  it('includes request id in structured request logs', async () => {
    const entries = await captureRequestLogs(() =>
      request(app).get('/api/openapi.json').set(REQUEST_ID_HEADER, 'log-context-request-id'),
    );

    expect(entries[0]).toMatchObject({
      event: 'http_request',
      requestId: 'log-context-request-id',
      operation: 'GET /api/openapi.json',
      route: '/api/openapi.json',
      outcome: 'success',
      status: 200,
    });
  });

  it('logs campaign id, operation, outcome, and error code for campaign routes', async () => {
    const entries = await captureRequestLogs(() =>
      request(app)
        .post('/api/campaigns/999999/pledges')
        .set(REQUEST_ID_HEADER, 'pledge-req-1')
        .send({}),
    );

    expect(entries[0]).toMatchObject({
      requestId: 'pledge-req-1',
      operation: 'POST /api/campaigns/:id/pledges',
      route: '/api/campaigns/:id/pledges',
      campaignId: '999999',
      path: '/api/campaigns/999999/pledges',
      outcome: 'client_error',
    });
    expect(entries[0].status).toBeGreaterThanOrEqual(400);
    expect(typeof entries[0].errorCode).toBe('string');
    expect(typeof entries[0].duration_ms).toBe('number');
  });

  it('drops the query string from the logged path', async () => {
    const entries = await captureRequestLogs(() =>
      request(app).get('/api/campaigns?creator=GSECRETLOOKINGVALUE&status=open'),
    );

    expect(entries[0].path).toBe('/api/campaigns');
    expect(JSON.stringify(entries[0])).not.toContain('GSECRETLOOKINGVALUE');
  });

  it('logs requests that match no route as unmatched', async () => {
    const entries = await captureRequestLogs(() => request(app).get('/api/does-not-exist'));

    expect(entries[0]).toMatchObject({ operation: 'unmatched', outcome: 'client_error', status: 404 });
    expect(entries[0].route).toBeUndefined();
    expect(entries[0].campaignId).toBeUndefined();
  });
});

describe('describeRoute', () => {
  it('derives a low-cardinality operation from the matched route', () => {
    expect(describeRoute('GET', '/api/stats', '/api/stats')).toEqual({
      route: '/api/stats',
      operation: 'GET /api/stats',
      campaignId: undefined,
    });
  });

  it('extracts the campaign id only from /api/campaigns/:id routes', () => {
    expect(describeRoute('GET', '/api/campaigns/:id', '/api/campaigns/7').campaignId).toBe('7');
    expect(describeRoute('POST', '/api/campaigns/:id/refund', '/api/campaigns/7/refund').campaignId).toBe('7');
    expect(describeRoute('GET', '/api/campaigns/trending', '/api/campaigns/trending').campaignId).toBeUndefined();
    expect(
      describeRoute('POST', '/api/webhooks/dead-letter/:id/retry', '/api/webhooks/dead-letter/3/retry').campaignId,
    ).toBeUndefined();
  });

  it('tolerates malformed percent-encoding in the campaign id', () => {
    expect(describeRoute('GET', '/api/campaigns/:id', '/api/campaigns/%E0').campaignId).toBe('%E0');
  });

  it('reports unmatched requests without a route', () => {
    expect(describeRoute('GET', undefined, '/nope')).toEqual({ operation: 'unmatched' });
  });
});

/** Run a request and return the structured `http_request` log entries it produced. */
async function captureRequestLogs(send: () => PromiseLike<unknown>): Promise<Record<string, unknown>[]> {
  const infoSpy = vi.spyOn(logger, 'info');
  try {
    await send();
    // The log is written on the response 'finish' event; let it flush.
    await new Promise((resolve) => setImmediate(resolve));
    return infoSpy.mock.calls
      .map(([entry]) => entry as unknown as Record<string, unknown>)
      .filter((entry) => entry && typeof entry === 'object' && entry.event === 'http_request');
  } finally {
    infoSpy.mockRestore();
  }
}
