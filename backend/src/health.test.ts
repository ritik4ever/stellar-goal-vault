/**
 * Focused tests for the health check endpoints.
 *
 * Coverage:
 *  - GET /api/health — shallow check (DB + indexer + memory)
 *  - GET /api/health/deep — deep check (DB + Soroban RPC + CONTRACT_ID + indexer + memory)
 *
 * Each test group exercises a specific documented signal so that regressions
 * in observability are caught before they reach production.
 */

import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DB_PATH = path.join('/tmp', `health-test-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

// Import order matters: app must be imported after env vars are set.
type IndexModule = typeof import('./index');
type EventIndexerModule = typeof import('./services/eventIndexer');
type DbModule = typeof import('./services/db');

let app: IndexModule['app'];
let getIndexerStatus: EventIndexerModule['getIndexerStatus'];
let checkDbHealth: DbModule['checkDbHealth'];

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ app } = await import('./index'));
  ({ getIndexerStatus } = await import('./services/eventIndexer'));
  ({ checkDbHealth } = await import('./services/db'));

  // Initialise the store so that checkDbHealth() can find an open connection
  const { initCampaignStore } = await import('./services/campaignStore');
  initCampaignStore();
}, 20_000);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/health — shallow health
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  describe('response shape', () => {
    it('returns all documented top-level keys', async () => {
      const res = await request(app).get('/api/health');

      expect([200, 503]).toContain(res.status);
      expect(res.body).toMatchObject({
        service: 'stellar-goal-vault-backend',
        status: expect.stringMatching(/^(ok|degraded)$/),
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
      });
      expect(res.body).toHaveProperty('database');
      expect(res.body).toHaveProperty('indexer');
      expect(res.body).toHaveProperty('memory');
    });

    it('timestamp is a valid ISO 8601 string', async () => {
      const res = await request(app).get('/api/health');
      const ts = res.body.timestamp as string;
      expect(new Date(ts).toISOString()).toBe(ts);
    });

    it('uptimeSeconds is a non-negative number', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('database signal', () => {
    it('includes database.status and database.reachable', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.database).toMatchObject({
        status: expect.stringMatching(/^(up|down)$/),
        reachable: expect.any(Boolean),
      });
    });

    it('returns HTTP 503 and status "degraded" when database is unreachable', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'down',
        reachable: false,
        error: 'Connection failed',
      });

      // Also stub indexer as healthy so we isolate the DB failure
      vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
        lastSuccessfulPollTime: Date.now(),
        lastKnownLedger: 1,
        isHealthy: true,
        consecutiveFailures: 0,
        lagMs: 5000,
        freshness: 'fresh',
        staleLagMs: 300000,
        freshLagMs: 30000,
      });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.database.reachable).toBe(false);
    });

    it('includes database.error string when database is down', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'down',
        reachable: false,
        error: 'SQLITE_CANTOPEN',
      });

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

      const res = await request(app).get('/api/health');
      expect(res.body.database.error).toBe('SQLITE_CANTOPEN');
    });
  });

  describe('indexer signal', () => {
    it('includes all documented indexer fields', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.indexer).toMatchObject({
        isHealthy: expect.any(Boolean),
        consecutiveFailures: expect.any(Number),
        freshness: expect.stringMatching(/^(fresh|idle|stale|failing|never)$/),
      });
      // lagMs may be null when no poll has succeeded yet
      expect(res.body.indexer).toHaveProperty('lastSuccessfulPollTime');
      expect(res.body.indexer).toHaveProperty('lastKnownLedger');
      expect(res.body.indexer).toHaveProperty('lagMs');
      expect(res.body.indexer).toHaveProperty('staleLagMs');
      expect(res.body.indexer).toHaveProperty('freshLagMs');
    });

    it('returns HTTP 503 when indexer is unhealthy', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'up',
        reachable: true,
      });

      vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
        lastSuccessfulPollTime: null,
        lastKnownLedger: 0,
        isHealthy: false,
        consecutiveFailures: 5,
        lagMs: null,
        freshness: 'failing',
        staleLagMs: 300000,
        freshLagMs: 30000,
      });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.indexer.isHealthy).toBe(false);
      expect(res.body.indexer.consecutiveFailures).toBe(5);
    });

    it('returns HTTP 200 when both DB and indexer are healthy', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'up',
        reachable: true,
      });

      vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
        lastSuccessfulPollTime: Date.now(),
        lastKnownLedger: 42,
        isHealthy: true,
        consecutiveFailures: 0,
        lagMs: 8000,
        freshness: 'fresh',
        staleLagMs: 300000,
        freshLagMs: 30000,
      });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('returns HTTP 200 for healthy-but-idle freshness (not stale)', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'up',
        reachable: true,
      });

      vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
        lastSuccessfulPollTime: Date.now() - 60_000,
        lastKnownLedger: 42,
        isHealthy: true,
        consecutiveFailures: 0,
        lagMs: 60_000,
        freshness: 'idle',
        staleLagMs: 300000,
        freshLagMs: 30000,
      });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.indexer.freshness).toBe('idle');
      expect(res.body.indexer.lagMs).toBe(60_000);
    });

    it('returns HTTP 503 when indexer freshness is stale', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'up',
        reachable: true,
      });

      vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
        lastSuccessfulPollTime: Date.now() - 600_000,
        lastKnownLedger: 42,
        isHealthy: false,
        consecutiveFailures: 0,
        lagMs: 600_000,
        freshness: 'stale',
        staleLagMs: 300000,
        freshLagMs: 30000,
      });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.indexer.freshness).toBe('stale');
      expect(res.body.indexer.isHealthy).toBe(false);
    });
  });

  describe('memory signal', () => {
    it('includes all four memory fields', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.memory).toMatchObject({
        rss: expect.any(Number),
        heapUsed: expect.any(Number),
        heapTotal: expect.any(Number),
        external: expect.any(Number),
      });
    });

    it('heapUsed is positive and does not exceed heapTotal', async () => {
      const res = await request(app).get('/api/health');
      const { heapUsed, heapTotal } = res.body.memory as { heapUsed: number; heapTotal: number };
      expect(heapUsed).toBeGreaterThan(0);
      // heapUsed can briefly exceed heapTotal during GC; allow a 10 % margin
      expect(heapUsed).toBeLessThanOrEqual(heapTotal * 1.1);
    });

    it('rss is greater than heapUsed (process memory includes more than just heap)', async () => {
      const res = await request(app).get('/api/health');
      const { rss, heapUsed } = res.body.memory as { rss: number; heapUsed: number };
      expect(rss).toBeGreaterThan(heapUsed);
    });

    it('memory values are reported in bytes (positive integers)', async () => {
      const res = await request(app).get('/api/health');
      const memory = res.body.memory as Record<string, number>;
      for (const [key, value] of Object.entries(memory)) {
        expect(value, `memory.${key} should be a positive integer`).toBeGreaterThan(0);
        expect(Number.isInteger(value), `memory.${key} should be an integer`).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/health/deep — deep health
// ---------------------------------------------------------------------------

describe('GET /api/health/deep', () => {
  describe('response shape', () => {
    it('returns all documented top-level keys', async () => {
      const res = await request(app).get('/api/health/deep');

      expect([200, 503]).toContain(res.status);
      expect(res.body).toMatchObject({
        overall: expect.stringMatching(/^(up|down)$/),
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
      });
      expect(res.body).toHaveProperty('memory');
      expect(res.body).toHaveProperty('components');
    });

    it('components contains db, soroban, contract, and indexer', async () => {
      const res = await request(app).get('/api/health/deep');
      const { components } = res.body as { components: Record<string, { status: string }> };
      expect(components).toHaveProperty('db');
      expect(components).toHaveProperty('soroban');
      expect(components).toHaveProperty('contract');
      expect(components).toHaveProperty('indexer');
    });

    it('each component has a status field of "up" or "down"', async () => {
      const res = await request(app).get('/api/health/deep');
      const { components } = res.body as { components: Record<string, { status: string }> };
      for (const [name, component] of Object.entries(components)) {
        expect(component.status, `components.${name}.status should be "up" or "down"`).toMatch(
          /^(up|down)$/,
        );
      }
    });
  });

  describe('contract component', () => {
    it('reports contract status "down" when CONTRACT_ID is not set', async () => {
      const savedContractId = process.env.CONTRACT_ID;
      process.env.CONTRACT_ID = '';

      const res = await request(app).get('/api/health/deep');
      // Regardless of Soroban reachability, contract is "down"
      expect(res.body.components.contract.status).toBe('down');
      expect(res.body.components.contract.details).toMatch(/CONTRACT_ID not set/i);

      process.env.CONTRACT_ID = savedContractId;
    });
  });

  describe('overall flag', () => {
    it('returns overall "down" when db is unreachable', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'down',
        reachable: false,
        error: 'disk I/O error',
      });

      vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
        lastSuccessfulPollTime: Date.now(),
        lastKnownLedger: 10,
        isHealthy: true,
        consecutiveFailures: 0,
        lagMs: 1000,
        freshness: 'fresh',
        staleLagMs: 300000,
        freshLagMs: 30000,
      });

      const res = await request(app).get('/api/health/deep');
      expect(res.status).toBe(503);
      expect(res.body.overall).toBe('down');
      expect(res.body.components.db.status).toBe('down');
    });

    it('returns overall "down" when indexer has consecutive failures', async () => {
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockReturnValue({
        status: 'up',
        reachable: true,
      });

      vi.spyOn(await import('./services/eventIndexer'), 'getIndexerStatus').mockReturnValue({
        lastSuccessfulPollTime: null,
        lastKnownLedger: 0,
        isHealthy: false,
        consecutiveFailures: 3,
        lagMs: null,
        freshness: 'failing',
        staleLagMs: 300000,
        freshLagMs: 30000,
      });

      const res = await request(app).get('/api/health/deep');
      expect(res.status).toBe(503);
      expect(res.body.overall).toBe('down');
      expect(res.body.components.indexer.status).toBe('down');
    });
  });

  describe('memory signal', () => {
    it('includes memory in deep response', async () => {
      const res = await request(app).get('/api/health/deep');
      expect(res.body.memory).toMatchObject({
        rss: expect.any(Number),
        heapUsed: expect.any(Number),
        heapTotal: expect.any(Number),
        external: expect.any(Number),
      });
    });
  });

  describe('error handling', () => {
    it('returns 503 with overall "down" on unexpected thrown error', async () => {
      // Force the db check to throw rather than return a struct
      vi.spyOn(await import('./services/db'), 'checkDbHealth').mockImplementation(() => {
        throw new Error('unexpected internal failure');
      });

      const res = await request(app).get('/api/health/deep');
      expect(res.status).toBe(503);
      expect(res.body.overall).toBe('down');
      expect(res.body.error).toBeDefined();
    });
  });
});
