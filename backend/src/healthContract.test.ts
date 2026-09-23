/**
 * Observability contract tests for the health endpoints (#1036).
 *
 * Operators and uptime monitors rely on specific structured fields from
 * `/api/health` and `/api/health/deep`, on the `X-Request-ID` header, and on
 * the structured request log. These tests pin those fields for both success
 * and failure paths, so a refactor that drops or renames one fails here
 * instead of silently breaking dashboards and alerts.
 *
 * Every response is also validated against the published OpenAPI schema, so
 * the spec in `docs/openapi.yaml` can't drift from what the endpoints return.
 */
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so it runs before the app (and its config) is imported.
vi.hoisted(() => {
  process.env.DB_PATH = ':memory:';
  process.env.NODE_ENV = 'test';
});

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SOROBAN_RPC_URL = 'http://soroban.test';

type DbHealth = { status: 'up' | 'down'; reachable: boolean; error?: string };

// Lets each test choose the database probe result without touching SQLite.
const dbHealth = vi.hoisted(() => ({
  impl: null as null | (() => DbHealth),
}));

vi.mock('./services/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/db')>();
  return {
    ...actual,
    checkDbHealth: () => (dbHealth.impl ? dbHealth.impl() : actual.checkDbHealth()),
  };
});

import { app } from './index';
import { config } from './config';
import { initCampaignStore } from './services/campaignStore';
import { logger } from './logger';
import { REQUEST_ID_HEADER } from './middleware/requestId';
import {
  deepHealthErrorResponseSchema,
  deepHealthResponseSchema,
  healthResponseSchema,
} from './openapi';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DB_DOWN: DbHealth = { status: 'down', reachable: false, error: 'SQLITE_CANTOPEN: unable to open database file' };

const originalContractId = config.contractId;
const originalSorobanRpcUrl = config.sorobanRpcUrl;

beforeAll(() => {
  // The healthy paths exercise the real SQLite probe.
  initCampaignStore();
});

beforeEach(() => {
  dbHealth.impl = null;
  config.contractId = CONTRACT_ID;
  config.sorobanRpcUrl = SOROBAN_RPC_URL;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  config.contractId = originalContractId;
  config.sorobanRpcUrl = originalSorobanRpcUrl;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Fields every health response must keep: they are what monitors key on. */
function expectCommonHealthFields(body: Record<string, unknown>) {
  expect(body.timestamp).toMatch(ISO_TIMESTAMP);
  expect(typeof body.uptimeSeconds).toBe('number');
  expect(body.uptimeSeconds as number).toBeGreaterThanOrEqual(0);
}

/** Send a request and return the response plus the structured request log it produced. */
async function withRequestLog(send: () => PromiseLike<request.Response>) {
  const infoSpy = vi.spyOn(logger, 'info');
  const response = await send();
  await new Promise((resolve) => setImmediate(resolve));
  const log = infoSpy.mock.calls
    .map(([entry]) => entry as unknown as Record<string, unknown>)
    .find((entry) => entry && typeof entry === 'object' && entry.event === 'http_request');
  infoSpy.mockRestore();
  return { response, log };
}

describe('GET /api/health contract', () => {
  it('reports ok with the database probe fields when healthy', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: 'stellar-goal-vault-backend',
      status: 'ok',
      database: { status: 'up', reachable: true },
    });
    expect(response.body.database).not.toHaveProperty('error');
    expectCommonHealthFields(response.body);
    expect(() => healthResponseSchema.parse(response.body)).not.toThrow();
  });

  it('reports degraded with the database error when the probe fails', async () => {
    dbHealth.impl = () => DB_DOWN;

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      service: 'stellar-goal-vault-backend',
      status: 'degraded',
      database: { status: 'down', reachable: false, error: DB_DOWN.error },
    });
    expectCommonHealthFields(response.body);
    expect(() => healthResponseSchema.parse(response.body)).not.toThrow();
  });
});

describe('GET /api/health/deep contract', () => {
  const COMPONENTS = ['db', 'soroban', 'contract'] as const;

  function expectComponentFields(body: Record<string, unknown>) {
    const components = body.components as Record<string, { status: string; details: string }>;
    expect(Object.keys(components)).toEqual(expect.arrayContaining([...COMPONENTS]));
    for (const name of COMPONENTS) {
      expect(['up', 'down']).toContain(components[name].status);
      expect(typeof components[name].details).toBe('string');
      expect(components[name].details.length).toBeGreaterThan(0);
    }
  }

  it('reports up with every component when all checks pass', async () => {
    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(200);
    expect(response.body.overall).toBe('up');
    expectCommonHealthFields(response.body);
    expectComponentFields(response.body);
    expect(response.body.components).toMatchObject({
      db: { status: 'up' },
      soroban: { status: 'up' },
      contract: { status: 'up' },
    });
    expect(() => deepHealthResponseSchema.parse(response.body)).not.toThrow();
  });

  it('marks the database down with its error as details', async () => {
    dbHealth.impl = () => DB_DOWN;

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(503);
    expect(response.body.overall).toBe('down');
    expectComponentFields(response.body);
    expect(response.body.components.db).toEqual({ status: 'down', details: DB_DOWN.error });
    expect(() => deepHealthResponseSchema.parse(response.body)).not.toThrow();
  });

  it('marks Soroban down when the RPC is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(503);
    expect(response.body.overall).toBe('down');
    expectComponentFields(response.body);
    expect(response.body.components.soroban.status).toBe('down');
    expect(response.body.components.db.status).toBe('up');
    expect(() => deepHealthResponseSchema.parse(response.body)).not.toThrow();
  });

  it('marks the contract down when CONTRACT_ID is not configured', async () => {
    config.contractId = '';

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(503);
    expect(response.body.overall).toBe('down');
    expectComponentFields(response.body);
    expect(response.body.components.contract).toEqual({ status: 'down', details: 'CONTRACT_ID not set' });
    expect(() => deepHealthResponseSchema.parse(response.body)).not.toThrow();
  });

  it('returns the error shape when the check itself throws', async () => {
    dbHealth.impl = () => {
      throw new Error('probe exploded');
    };

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      overall: 'down',
      error: 'Deep health check failed',
      message: 'probe exploded',
    });
    expect(response.body.timestamp).toMatch(ISO_TIMESTAMP);
    expect(() => deepHealthErrorResponseSchema.parse(response.body)).not.toThrow();
  });
});

describe('health check correlation and request-log contract', () => {
  it.each([
    ['/api/health', 200, () => null],
    ['/api/health', 503, () => DB_DOWN],
    ['/api/health/deep', 200, () => null],
    ['/api/health/deep', 503, () => DB_DOWN],
  ] as const)('%s (%i) echoes X-Request-ID and logs the structured request fields', async (path, status, db) => {
    const probe = db();
    dbHealth.impl = probe ? () => probe : null;

    const { response, log } = await withRequestLog(() =>
      request(app).get(path).set(REQUEST_ID_HEADER, `health-contract-${status}`),
    );

    expect(response.status).toBe(status);
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(`health-contract-${status}`);
    expect(log).toBeDefined();
    expect(log).toMatchObject({
      event: 'http_request',
      requestId: `health-contract-${status}`,
      method: 'GET',
      path,
      status,
    });
    expect(typeof log!.duration_ms).toBe('number');
  });
});
