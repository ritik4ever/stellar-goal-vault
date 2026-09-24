import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
  it('echoes an incoming X-Request-ID header', async () => {
    const response = await request(app)
      .get('/api/health')
      .set(REQUEST_ID_HEADER, 'client-request-123');

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe('client-request-123');
  });

  it('generates X-Request-ID when the header is missing', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('includes request id in structured request logs', async () => {
    // The backend uses pino which does not route through console.info.
    // Spy on logger.info to capture the structured http_request log line
    // emitted by the requestIdMiddleware finish handler.
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await request(app).get('/api/health').set(REQUEST_ID_HEADER, 'log-context-request-id');

    await vi.waitFor(() => {
      const payload = infoSpy.mock.calls
        .map(([p]) => p as Record<string, unknown>)
        .find(
          (p) => p?.event === 'http_request' && p.requestId === 'log-context-request-id',
        );
      expect(payload, 'no http_request log found for log-context-request-id').toBeDefined();
    });
  });
});
