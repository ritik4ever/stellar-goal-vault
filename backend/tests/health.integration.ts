/**
 * Integration tests for the health endpoints (issue #867).
 *
 * These tests exercise the real Express app over HTTP against a real, isolated
 * SQLite database. Only the two signals that cannot exist inside a test process
 * are substituted, and always per test:
 *
 *  - the Soroban RPC probe (`fetch`), so no test touches the network, and
 *  - the event indexer status, because the poller is not started here.
 *
 * Every test installs the exact health state it asserts and `afterEach`
 * restores all spies/globals, so the suite is order-independent. The database
 * is a unique temp file per process and is removed after the suite.
 *
 * Coverage:
 *  - GET /api/health        success (200), degraded (503), server error (500)
 *  - GET /api/health/deep   success (200), degraded (503), server error (500)
 *  - validation failures    400 VALIDATION_ERROR with field details
 *  - not-found              404 for unknown paths under /api/health
 *  - response schemas       validated with strict Zod schemas
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// A unique database per test process keeps this suite isolated from the other
// integration files, which each boot their own app instance.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `stellar-goal-vault-health-integration-${process.pid}-${Date.now()}.db`,
);

// Snapshot the inherited environment so this suite does not leak its overrides
// into later test files sharing the worker process.
const ENV_KEYS = ['NODE_ENV', 'DB_PATH', 'CONTRACT_ID', 'SOROBAN_RPC_URL'] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
  (typeof ENV_KEYS)[number],
  string | undefined
>;

process.env.NODE_ENV = 'test';
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = `C${'A'.repeat(55)}`;
// Never leave the deep check pointed at the public testnet: fetch is stubbed,
// but an unroutable URL guarantees a failure cannot depend on network access.
process.env.SOROBAN_RPC_URL = 'http://soroban.invalid/rpc';

type EventIndexerModule = typeof import('../src/services/eventIndexer');
type IndexerStatus = ReturnType<EventIndexerModule['getIndexerStatus']>;

let app: Express;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ app } = await import('../src/index'));

  const { initCampaignStore } = await import('../src/services/campaignStore');
  initCampaignStore();
}, 20_000);

afterAll(async () => {
  const { resetDbForTests } = await import('../src/services/db');
  resetDbForTests();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    } catch {
      // A lingering SQLite handle is harmless in a temp directory.
    }
  }

  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

beforeEach(() => {
  // Deterministic, offline default: the Soroban RPC probe succeeds.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Response schemas — the public contract callers can rely on.
// ---------------------------------------------------------------------------

const isoTimestamp = z
  .string()
  .refine((value) => new Date(value).toISOString() === value, 'must be an ISO 8601 timestamp');

const memorySchema = z.object({
  rss: z.number().int().nonnegative(),
  heapUsed: z.number().int().nonnegative(),
  heapTotal: z.number().int().nonnegative(),
  external: z.number().int().nonnegative(),
});

const databaseSchema = z.object({
  status: z.enum(['up', 'down']),
  reachable: z.boolean(),
  error: z.string().optional(),
});

const indexerSchema = z.object({
  lastSuccessfulPollTime: z.number().nullable(),
  lastKnownLedger: z.number().nullable(),
  isHealthy: z.boolean(),
  consecutiveFailures: z.number().int().nonnegative(),
  lagMs: z.number().nullable(),
  freshness: z.enum(['fresh', 'idle', 'stale', 'failing', 'never']),
  staleLagMs: z.number().nonnegative(),
  freshLagMs: z.number().nonnegative(),
});

const shallowHealthSchema = z
  .object({
    service: z.literal('stellar-goal-vault-backend'),
    status: z.enum(['ok', 'degraded']),
    timestamp: isoTimestamp,
    uptimeSeconds: z.number().nonnegative(),
    database: databaseSchema,
    indexer: indexerSchema,
    memory: memorySchema,
  })
  .strict();

const componentSchema = z.object({
  status: z.enum(['up', 'down']),
  details: z.unknown(),
});

const deepHealthSchema = z
  .object({
    overall: z.enum(['up', 'down']),
    timestamp: isoTimestamp,
    uptimeSeconds: z.number().nonnegative(),
    memory: memorySchema,
    components: z.record(z.string(), componentSchema),
    pagination: z
      .object({
        total: z.number().int().nonnegative(),
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        totalPages: z.number().int().positive(),
        hasPreviousPage: z.boolean(),
        hasNextPage: z.boolean(),
      })
      .strict(),
  })
  .strict();

const errorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        requestId: z.string(),
        details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
      })
      .strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthyIndexerStatus(overrides: Partial<IndexerStatus> = {}): IndexerStatus {
  return {
    lastSuccessfulPollTime: 1_700_000_000_000,
    lastKnownLedger: 42,
    isHealthy: true,
    consecutiveFailures: 0,
    lagMs: 5_000,
    freshness: 'fresh',
    staleLagMs: 300_000,
    freshLagMs: 30_000,
    ...overrides,
  };
}

/** Replace the indexer signal with a deterministic status for this test only. */
async function stubIndexerStatus(overrides: Partial<IndexerStatus> = {}) {
  const eventIndexer = await import('../src/services/eventIndexer');
  return vi
    .spyOn(eventIndexer, 'getIndexerStatus')
    .mockReturnValue(healthyIndexerStatus(overrides));
}

/** Replace the database health signal for this test only. */
async function stubDatabaseHealth(
  value: Awaited<ReturnType<typeof import('../src/services/db').checkDbHealth>>,
) {
  const db = await import('../src/services/db');
  return vi.spyOn(db, 'checkDbHealth').mockReturnValue(value);
}

// ---------------------------------------------------------------------------
// GET /api/health — shallow health
// ---------------------------------------------------------------------------

describe('GET /api/health (integration)', () => {
  it('returns 200 with a schema-valid payload when the database and indexer are healthy', async () => {
    await stubIndexerStatus();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    const body = shallowHealthSchema.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.database).toEqual({ status: 'up', reachable: true });
    expect(body.indexer.isHealthy).toBe(true);
    expect(body.indexer.freshness).toBe('fresh');
  });

  it('returns 503 with status "degraded" when the indexer has never polled', async () => {
    // No indexer stub: use the real signal from a process where the poller has
    // not started. The database is still genuinely reachable.
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    const body = shallowHealthSchema.parse(response.body);
    expect(body.status).toBe('degraded');
    expect(body.database.reachable).toBe(true);
    expect(body.indexer.isHealthy).toBe(false);
    expect(body.indexer.freshness).toBe('never');
  });

  it('returns 503 and surfaces the database error when the database is unreachable', async () => {
    await stubDatabaseHealth({
      status: 'down',
      reachable: false,
      error: 'SQLITE_CANTOPEN',
    });
    await stubIndexerStatus();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    const body = shallowHealthSchema.parse(response.body);
    expect(body.status).toBe('degraded');
    expect(body.database).toMatchObject({
      status: 'down',
      reachable: false,
      error: 'SQLITE_CANTOPEN',
    });
  });

  it('returns a generic 500 envelope without leaking internals when the health check throws', async () => {
    const db = await import('../src/services/db');
    vi.spyOn(db, 'checkDbHealth').mockImplementation(() => {
      throw new Error(
        'internal storage failure at /var/lib/sqlite/campaigns.db (secret SAAAAAAAAAAAAAAAAAAAAAAAAAAAA)',
      );
    });

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(500);
    const body = errorEnvelopeSchema.parse(response.body);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
    expect(body.error.requestId.length).toBeGreaterThan(0);

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('internal storage failure');
    expect(raw).not.toContain('/var/lib/sqlite/campaigns.db');
    expect(raw).not.toContain('SAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(raw).not.toContain('stack');
  });
});

// ---------------------------------------------------------------------------
// GET /api/health/deep — deep health
// ---------------------------------------------------------------------------

describe('GET /api/health/deep (integration)', () => {
  it('returns 200 with every component up when all dependencies are healthy', async () => {
    await stubIndexerStatus();

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(200);
    const body = deepHealthSchema.parse(response.body);
    expect(body.overall).toBe('up');
    expect(Object.keys(body.components).sort()).toEqual(['contract', 'db', 'indexer', 'soroban']);
    for (const [name, component] of Object.entries(body.components)) {
      expect(component.status, `components.${name}.status`).toBe('up');
    }
    expect(body.pagination).toEqual({
      total: 4,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    });

    // The route probes the configured Soroban endpoint exactly once.
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(process.env.SOROBAN_RPC_URL);
  });

  it('paginates components deterministically without overlap, each page schema-valid', async () => {
    await stubIndexerStatus();

    const firstPage = await request(app).get('/api/health/deep?page=1&limit=2');
    expect(firstPage.status).toBe(200);
    const first = deepHealthSchema.parse(firstPage.body);
    expect(Object.keys(first.components)).toEqual(['db', 'soroban']);
    expect(first.pagination).toMatchObject({
      total: 4,
      page: 1,
      limit: 2,
      totalPages: 2,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    const lastPage = await request(app).get('/api/health/deep?page=2&limit=2');
    expect(lastPage.status).toBe(200);
    const last = deepHealthSchema.parse(lastPage.body);
    expect(Object.keys(last.components)).toEqual(['contract', 'indexer']);
    expect(last.pagination).toMatchObject({
      total: 4,
      page: 2,
      limit: 2,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    });

    const combined = [...Object.keys(first.components), ...Object.keys(last.components)];
    expect(new Set(combined).size).toBe(4);
  });

  it('returns 503 when the Soroban RPC probe fails', async () => {
    await stubIndexerStatus();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    );

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(503);
    const body = deepHealthSchema.parse(response.body);
    expect(body.overall).toBe('down');
    expect(body.components.soroban.status).toBe('down');
    expect(body.components.db.status).toBe('up');
  });

  it('returns 503 when the database is unreachable', async () => {
    await stubDatabaseHealth({ status: 'down', reachable: false, error: 'disk I/O error' });
    await stubIndexerStatus();

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(503);
    const body = deepHealthSchema.parse(response.body);
    expect(body.overall).toBe('down');
    expect(body.components.db).toMatchObject({ status: 'down', details: 'disk I/O error' });
    expect(body.components.indexer.status).toBe('up');
  });

  it('returns a generic 500 envelope without leaking internals when the deep check throws', async () => {
    const db = await import('../src/services/db');
    vi.spyOn(db, 'checkDbHealth').mockImplementation(() => {
      throw new Error('connection pool crashed while reading /srv/private/health-probe.db');
    });

    const response = await request(app).get('/api/health/deep');

    expect(response.status).toBe(500);
    const body = errorEnvelopeSchema.parse(response.body);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');
    expect(body.error.requestId.length).toBeGreaterThan(0);
    expect(body.error.details).toBeUndefined();

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('connection pool crashed');
    expect(raw).not.toContain('/srv/private/health-probe.db');
    expect(raw).not.toContain('stack');
  });
});

// ---------------------------------------------------------------------------
// Validation failures
// ---------------------------------------------------------------------------

describe('GET /api/health/deep validation (integration)', () => {
  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1.5', 'page'],
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=abc', 'limit'],
  ])('rejects %s with 400 VALIDATION_ERROR for %s', async (query, field) => {
    const response = await request(app).get(`/api/health/deep?${query}`);

    expect(response.status).toBe(400);
    const body = errorEnvelopeSchema.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
    expect(body.error.details?.map((detail) => detail.field)).toContain(field);
    expect(body.error.details?.every((detail) => detail.message.length > 0)).toBe(true);
  });

  it('does not touch the database when validation fails', async () => {
    const db = await import('../src/services/db');
    const checkDbHealth = vi.spyOn(db, 'checkDbHealth');

    const response = await request(app).get('/api/health/deep?limit=999');

    expect(response.status).toBe(400);
    expect(checkDbHealth).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Not-found
// ---------------------------------------------------------------------------

describe('health endpoint not-found handling (integration)', () => {
  it.each(['/api/health/unknown', '/api/health/deep/unknown', '/api/healthz'])(
    'returns 404 for %s instead of a health payload',
    async (route) => {
      const response = await request(app).get(route);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).not.toContain('application/json');
      // The default Express 404 is used for unmatched routes; it must never be
      // mistaken for a successful health response.
      expect(response.text.length).toBeGreaterThan(0);
    },
  );
});
