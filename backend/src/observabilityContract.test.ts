import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Express } from 'express';

import { REQUEST_ID_HEADER } from './middleware/requestId';
import { logger } from './logger';

/**
 * Observability contract tests (issue #1041).
 *
 * These tests pin the *shape* of the signals operators rely on for debugging:
 * the aggregate metrics in `GET /api/stats`, the health payload, the
 * `http_request` structured log and the `request_error` structured log.
 * Values that vary per run (timestamps, durations, ids) are asserted by type
 * only. If a field is removed or renamed, the failure message names it.
 *
 * Keep docs/OBSERVABILITY.md in sync with the constants below.
 */

/** Keys emitted by GET /api/stats (snake_case and camelCase aliases). */
const STATS_METRIC_FIELDS = {
  total_campaigns: 'number',
  open_campaigns: 'number',
  funded_campaigns: 'number',
  failed_campaigns: 'number',
  total_pledged_usdc: 'number',
  total_pledged_xlm: 'number',
  total_contributors: 'number',
  avg_funding_rate_pct: 'number',
  totalCampaigns: 'number',
  openCampaigns: 'number',
  fundedCampaigns: 'number',
  claimedCampaigns: 'number',
  failedCampaigns: 'number',
  totalPledgeVolume: 'number',
  uniqueContributors: 'number',
} as const;

/** Keys of the GET /api/health payload. */
const HEALTH_FIELDS = {
  service: 'string',
  status: 'string',
  timestamp: 'string',
  uptimeSeconds: 'number',
  database: 'object',
  indexer: 'object',
} as const;

/** Keys of the nested `indexer` object on GET /api/health (issue #1024). */
const INDEXER_HEALTH_FIELDS = {
  lastSuccessfulPollTime: 'number_or_null',
  lastKnownLedger: 'number',
  isHealthy: 'boolean',
  consecutiveFailures: 'number',
  lagMs: 'number_or_null',
  freshness: 'string',
  staleLagMs: 'number',
  freshLagMs: 'number',
} as const;

/** Fields on the `http_request` log line (success and failure alike). */
const HTTP_REQUEST_LOG_FIELDS = {
  event: 'string',
  message: 'string',
  requestId: 'string',
  method: 'string',
  path: 'string',
  status: 'number',
  duration_ms: 'number',
} as const;

/** Fields on the `request_error` log line. */
const REQUEST_ERROR_LOG_FIELDS = {
  event: 'string',
  requestId: 'string',
  method: 'string',
  path: 'string',
  status: 'number',
  code: 'string',
  err: 'object',
  indexer: 'object',
} as const;

/** Fields inside `err` on error logs. */
const ERROR_LOG_ERR_FIELDS = {
  message: 'string',
  name: 'string',
  stack: 'string',
} as const;

/** Fields of the error envelope in failing API responses. */
const ERROR_RESPONSE_FIELDS = {
  code: 'string',
  message: 'string',
  requestId: 'string',
} as const;

type FieldTypes = Record<string, 'string' | 'number' | 'object'>;

function assertContract(label: string, actual: unknown, contract: FieldTypes): void {
  expect(actual, `${label} must be an object`).toEqual(expect.any(Object));
  const record = actual as Record<string, unknown>;
  for (const [field, type] of Object.entries(contract)) {
    expect(field in record, `${label} is missing contract field "${field}"`).toBe(true);
    const value = record[field];
    expect(
      typeof value,
      `${label} field "${field}" must be of type ${type} (got ${typeof value})`,
    ).toBe(type);
    if (type === 'object') {
      expect(value, `${label} field "${field}" must not be null`).not.toBeNull();
    }
    if (type === 'number') {
      expect(Number.isFinite(value), `${label} field "${field}" must be finite`).toBe(true);
    }
  }
}

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-observability-${process.pid}-${Date.now()}.db`,
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

/** Waits for the `finish`-driven http_request log for the given request id. */
async function findHttpRequestLog(
  infoSpy: ReturnType<typeof vi.spyOn>,
  requestId: string,
): Promise<Record<string, unknown>> {
  let found: Record<string, unknown> | undefined;
  await vi.waitFor(() => {
    found = infoSpy.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find((payload) => payload?.event === 'http_request' && payload.requestId === requestId);
    expect(found, `no http_request log emitted for request ${requestId}`).toBeDefined();
  });
  return found as Record<string, unknown>;
}

describe('observability contract: success path', () => {
  it('GET /api/stats exposes every aggregate metric with the documented type', async () => {
    const response = await request(app).get('/api/stats');

    expect(response.status).toBe(200);
    assertContract('GET /api/stats data', response.body.data, STATS_METRIC_FIELDS);
  });

  it('GET /api/health exposes status, uptime and database state', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    assertContract('GET /api/health body', response.body, HEALTH_FIELDS);
    expect(response.body.status).toBe('ok');
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(response.body.database).toMatchObject({
      status: 'up',
      reachable: true,
    });
  });

  it('emits an http_request log with request id, route, status and duration', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const requestId = 'obs-contract-success';

    const response = await request(app).get('/api/health').set(REQUEST_ID_HEADER, requestId);
    expect(response.status).toBe(200);

    const payload = await findHttpRequestLog(infoSpy, requestId);
    assertContract('http_request log (success)', payload, HTTP_REQUEST_LOG_FIELDS);
    expect(payload).toMatchObject({
      event: 'http_request',
      requestId,
      method: 'GET',
      path: '/api/health',
      status: 200,
      duration_ms: expect.any(Number),
    });
    expect(payload.duration_ms as number).toBeGreaterThanOrEqual(0);
    expect(payload.message).toContain('GET /api/health 200');
  });
});

describe('observability contract: failure path', () => {
  it('logs request_error with code, status, request id and error details for a 404', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const requestId = 'obs-contract-not-found';

    const response = await request(app)
      .get('/api/campaigns/999999')
      .set(REQUEST_ID_HEADER, requestId);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    assertContract('error response envelope', response.body.error, ERROR_RESPONSE_FIELDS);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND', requestId });

    const errorPayload = errorSpy.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find((payload) => payload?.event === 'request_error' && payload.requestId === requestId);
    expect(errorPayload, 'no request_error log emitted for failing request').toBeDefined();
    assertContract('request_error log', errorPayload, REQUEST_ERROR_LOG_FIELDS);
    assertContract('request_error log err', (errorPayload as any).err, ERROR_LOG_ERR_FIELDS);
    expect(errorPayload).toMatchObject({
      event: 'request_error',
      requestId,
      method: 'GET',
      path: '/api/campaigns/999999',
      status: 404,
      code: 'NOT_FOUND',
    });

    const httpPayload = await findHttpRequestLog(infoSpy, requestId);
    assertContract('http_request log (failure)', httpPayload, HTTP_REQUEST_LOG_FIELDS);
    expect(httpPayload.status).toBe(404);
  });

  it('logs validation failures with a 400 status and error code', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const requestId = 'obs-contract-validation';

    const response = await request(app)
      .post('/api/campaigns')
      .set(REQUEST_ID_HEADER, requestId)
      .send({});

    expect(response.status).toBe(400);
    assertContract('error response envelope', response.body.error, ERROR_RESPONSE_FIELDS);
    expect(Array.isArray(response.body.error.details)).toBe(true);

    const errorPayload = errorSpy.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find((payload) => payload?.event === 'request_error' && payload.requestId === requestId);
    expect(errorPayload, 'no request_error log emitted for validation failure').toBeDefined();
    assertContract('request_error log', errorPayload, REQUEST_ERROR_LOG_FIELDS);
    expect(errorPayload).toMatchObject({ status: 400, code: expect.any(String) });
  });
});
