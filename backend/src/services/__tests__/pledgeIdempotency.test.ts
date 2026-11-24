import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, initDb, resetDbForTests } from '../db';
import { addPledge, createCampaign } from '../campaignStore';
import { clearIdempotencyCache, IDEMPOTENCY_TTL_SECONDS } from '../idempotencyCache';
import {
  createIdempotencyMiddleware,
  idempotencyMiddleware,
} from '../../middleware/idempotencyMiddleware';
import * as loggerModule from '../../logger';

// A stand-in for Redis: the store that survives a process restart.
const shared = vi.hoisted(() => ({ available: false, map: new Map<string, string>() }));

vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache')>();
  return {
    ...actual,
    isCacheAvailable: () => shared.available,
    getCacheValue: async (key: string) => shared.map.get(key) ?? null,
    setCacheValue: async (key: string, value: string) => {
      shared.map.set(key, value);
    },
    deleteCacheValue: async (key: string) => shared.map.delete(key),
  };
});

const CREATOR = `G${'A'.repeat(55)}`;
const ALICE = `G${'D'.repeat(55)}`;
const BOB = `G${'E'.repeat(55)}`;
const TTL_MS = IDEMPOTENCY_TTL_SECONDS * 1000;
const T0 = new Date('2026-06-01T00:00:00Z').getTime();

let campaignId: string;
let executions: number;
let gate: Promise<void> | null;

function buildApp(middleware: express.RequestHandler = idempotencyMiddleware) {
  const app = express();
  app.use(express.json());
  // The same chain as the pledge route: idempotency first, then the real write.
  app.post('/api/campaigns/:id/pledges', middleware, async (req, res) => {
    if (gate) await gate;
    executions += 1;
    try {
      addPledge(req.params.id, {
        contributor: req.body.contributor,
        amount: req.body.amount,
        assetCode: 'USDC',
      });
      res.status(201).json({ data: { executions } });
    } catch (error) {
      const failure = error as { statusCode?: number; code?: string; message: string };
      res
        .status(failure.statusCode ?? 500)
        .json({ error: { code: failure.code, message: failure.message } });
    }
  });
  return app;
}

function pledge(
  app: express.Express,
  key: string | null,
  body: { contributor: string; amount: number },
) {
  const req = request(app).post(`/api/campaigns/${campaignId}/pledges`).send(body);
  return key ? req.set('Idempotency-Key', key) : req;
}

function pledgeCount(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM pledges`).get() as { n: number }).n;
}

function setup(): void {
  process.env.DB_PATH = ':memory:';
  resetDbForTests();
  initDb();
  clearIdempotencyCache();
  shared.available = false;
  shared.map.clear();
  executions = 0;
  gate = null;
  const campaign = createCampaign({
    creator: CREATOR,
    title: 'Idempotency',
    description: 'Campaign used to test pledge idempotency.',
    acceptedTokens: ['USDC'],
    targetAmount: 1000,
    deadline: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
  });
  campaignId = campaign.id;
}

describe('pledge idempotency: replay and conflicts', () => {
  beforeEach(setup);
  afterEach(() => resetDbForTests());

  it('has one effect for a repeated request and replays the original response', async () => {
    const app = buildApp();
    const body = { contributor: ALICE, amount: 100 };

    const first = await pledge(app, 'key-1', body);
    const second = await pledge(app, 'key-1', body);

    expect(first.status).toBe(201);
    expect(first.headers['x-idempotency-cache']).toBe('MISS');
    expect(second.status).toBe(201);
    expect(second.headers['x-idempotency-cache']).toBe('HIT');
    expect(second.body).toEqual(first.body);
    expect(executions).toBe(1);
    expect(pledgeCount()).toBe(1);
  });

  it('treats a repeated request with the fields in a different order as the same request', async () => {
    const app = buildApp();

    await request(app)
      .post(`/api/campaigns/${campaignId}/pledges`)
      .set('Idempotency-Key', 'key-order')
      .send({ contributor: ALICE, amount: 100 });
    const replay = await request(app)
      .post(`/api/campaigns/${campaignId}/pledges`)
      .set('Idempotency-Key', 'key-order')
      .send({ amount: 100, contributor: ALICE });

    expect(replay.headers['x-idempotency-cache']).toBe('HIT');
    expect(pledgeCount()).toBe(1);
  });

  it('rejects the same key with a different body instead of replaying the old response', async () => {
    const app = buildApp();

    await pledge(app, 'key-2', { contributor: ALICE, amount: 100 });
    const reused = await pledge(app, 'key-2', { contributor: ALICE, amount: 250 });

    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(executions).toBe(1);
    expect(pledgeCount()).toBe(1);
  });

  it('gives different contributors who send the same key their own pledge', async () => {
    const app = buildApp();

    const alice = await pledge(app, 'shared-key', { contributor: ALICE, amount: 100 });
    const bob = await pledge(app, 'shared-key', { contributor: BOB, amount: 100 });

    expect(alice.status).toBe(201);
    expect(bob.status).toBe(201);
    expect(bob.headers['x-idempotency-cache']).toBe('MISS');
    expect(executions).toBe(2);
    expect(pledgeCount()).toBe(2);
  });

  it('does not store a failed request, so the retry runs again', async () => {
    const app = buildApp();

    const rejected = await pledge(app, 'key-fail', { contributor: ALICE, amount: 5000 });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('CAMPAIGN_FUNDING_CAP_EXCEEDED');
    expect(pledgeCount()).toBe(0);

    const retry = await pledge(app, 'key-fail', { contributor: ALICE, amount: 100 });
    expect(retry.status).toBe(201);
    expect(retry.headers['x-idempotency-cache']).toBe('MISS');
    expect(pledgeCount()).toBe(1);
  });

  it('does nothing special without an Idempotency-Key header', async () => {
    const app = buildApp();

    await pledge(app, null, { contributor: ALICE, amount: 100 });
    await pledge(app, null, { contributor: ALICE, amount: 100 });

    expect(executions).toBe(2);
    expect(pledgeCount()).toBe(2);
  });
});

describe('pledge idempotency: concurrent requests with the same key', () => {
  beforeEach(setup);
  afterEach(() => resetDbForTests());

  it('runs one effect when an identical request arrives while the first is in progress', async () => {
    const app = buildApp();
    let open!: () => void;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const body = { contributor: ALICE, amount: 100 };

    const first = pledge(app, 'key-race', body).then((res) => res);
    const second = pledge(app, 'key-race', body).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 100));
    open();
    const [a, b] = await Promise.all([first, second]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect([a, b].map((r) => r.headers['x-idempotency-cache']).sort()).toEqual(['HIT', 'MISS']);
    expect(executions).toBe(1);
    expect(pledgeCount()).toBe(1);
  });

  it('rejects a concurrent request that reuses the key with a different body', async () => {
    const app = buildApp();
    let open!: () => void;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const first = pledge(app, 'key-race-2', { contributor: ALICE, amount: 100 }).then((r) => r);
    const second = pledge(app, 'key-race-2', { contributor: ALICE, amount: 300 }).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 100));
    open();
    const results = await Promise.all([first, second]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(executions).toBe(1);
    expect(pledgeCount()).toBe(1);
  });

  it('lets the next request run when the first one failed', async () => {
    const app = buildApp();
    let open!: () => void;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const first = pledge(app, 'key-race-3', { contributor: ALICE, amount: 5000 }).then((r) => r);
    const second = pledge(app, 'key-race-3', { contributor: ALICE, amount: 5000 }).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 100));
    open();
    const results = await Promise.all([first, second]);

    // Nothing was stored for a failed request, so each ran and each failed.
    expect(results.map((r) => r.status)).toEqual([400, 400]);
    expect(pledgeCount()).toBe(0);
  });
});

describe('pledge idempotency: 24-hour expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    setup();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDbForTests();
  });

  it('still replays one millisecond before the key expires', async () => {
    const app = buildApp();
    const body = { contributor: ALICE, amount: 100 };

    await pledge(app, 'key-ttl', body);
    vi.setSystemTime(T0 + TTL_MS - 1);
    const replay = await pledge(app, 'key-ttl', body);

    expect(replay.headers['x-idempotency-cache']).toBe('HIT');
    expect(executions).toBe(1);
    expect(pledgeCount()).toBe(1);
  });

  it('treats the key as new once it has expired', async () => {
    const app = buildApp();
    const body = { contributor: ALICE, amount: 100 };

    await pledge(app, 'key-ttl', body);
    vi.setSystemTime(T0 + TTL_MS);
    const afterExpiry = await pledge(app, 'key-ttl', body);

    expect(afterExpiry.status).toBe(201);
    expect(afterExpiry.headers['x-idempotency-cache']).toBe('MISS');
    expect(executions).toBe(2);
    expect(pledgeCount()).toBe(2);
  });

  it('treats the key as new just after 24-hour expiry', async () => {
    const app = buildApp();
    const body = { contributor: ALICE, amount: 100 };

    await pledge(app, 'key-ttl-after', body);
    vi.setSystemTime(T0 + TTL_MS + 1000);
    const afterExpiry = await pledge(app, 'key-ttl-after', body);

    expect(afterExpiry.status).toBe(201);
    expect(afterExpiry.headers['x-idempotency-cache']).toBe('MISS');
    expect(executions).toBe(2);
    expect(pledgeCount()).toBe(2);
  });

  it('applies the same boundary when the entry comes from the shared store and cleans expired state', async () => {
    shared.available = true;
    const app = buildApp();
    const body = { contributor: ALICE, amount: 100 };

    await pledge(app, 'key-ttl-shared', body);
    clearIdempotencyCache();

    vi.setSystemTime(T0 + TTL_MS - 1);
    expect((await pledge(app, 'key-ttl-shared', body)).headers['x-idempotency-cache']).toBe('HIT');

    clearIdempotencyCache();
    vi.setSystemTime(T0 + TTL_MS);
    const expired = await pledge(app, 'key-ttl-shared', body);
    expect(expired.headers['x-idempotency-cache']).toBe('MISS');
    expect(pledgeCount()).toBe(2);
    // Expired entry evicted from shared store at worker boundary
    expect(shared.map.size).toBe(1); // Only the newly created entry remains
  });
});

describe('pledge idempotency: across a restart', () => {
  beforeEach(setup);
  afterEach(() => resetDbForTests());

  it('replays after a restart when a shared cache holds the entry', async () => {
    shared.available = true;
    const app = buildApp();
    const body = { contributor: ALICE, amount: 100 };

    await pledge(app, 'key-restart', body);
    clearIdempotencyCache(); // a new process starts with an empty in-memory cache
    const afterRestart = await pledge(app, 'key-restart', body);

    expect(afterRestart.status).toBe(201);
    expect(afterRestart.headers['x-idempotency-cache']).toBe('HIT');
    expect(executions).toBe(1);
    expect(pledgeCount()).toBe(1);
  });

  it('forgets the key after a restart when there is no shared cache', async () => {
    // Documents the limit of the in-memory store: without Redis, a repeat that
    // arrives after a restart is a new request and creates a second pledge.
    shared.available = false;
    const app = buildApp();
    const body = { contributor: ALICE, amount: 100 };

    await pledge(app, 'key-restart-memory', body);
    clearIdempotencyCache();
    const afterRestart = await pledge(app, 'key-restart-memory', body);

    expect(afterRestart.headers['x-idempotency-cache']).toBe('MISS');
    expect(executions).toBe(2);
    expect(pledgeCount()).toBe(2);
  });
});

describe('pledge idempotency: observability and multi-worker concurrency (SGV-2026-174)', () => {
  beforeEach(setup);
  afterEach(() => {
    vi.restoreAllMocks();
    resetDbForTests();
  });

  it('logs pending and committed outcomes with redacted campaign and key references', async () => {
    const infoSpy = vi.spyOn(loggerModule, 'logInfo');
    const errorSpy = vi.spyOn(loggerModule, 'logError');
    const app = buildApp();
    const rawKey = 'obs-idempotency-key-12345';
    const body = { contributor: ALICE, amount: 100 };

    await pledge(app, rawKey, body);
    await pledge(app, rawKey, body);

    const events = infoSpy.mock.calls.filter(
      ([event]) =>
        event === 'pledge_idempotency_pending' || event === 'pledge_idempotency_committed',
    );
    expect(events).toHaveLength(3);

    const [pendingEvent, pendingMeta] = events[0];
    expect(pendingEvent).toBe('pledge_idempotency_pending');
    expect(pendingMeta).toMatchObject({
      outcome: 'pending',
      inFlightWait: false,
    });
    expect(String((pendingMeta as Record<string, unknown>).campaignRef)).not.toBe(campaignId);
    expect(String((pendingMeta as Record<string, unknown>).keyRef)).not.toBe(rawKey);
    expect(JSON.stringify(pendingMeta)).not.toContain(campaignId);
    expect(JSON.stringify(pendingMeta)).not.toContain(rawKey);

    const [committedEvent, committedMeta] = events[1];
    expect(committedEvent).toBe('pledge_idempotency_committed');
    expect(committedMeta).toMatchObject({
      outcome: 'committed',
      statusCode: 201,
      replay: false,
    });

    const [replayEvent, replayMeta] = events[2];
    expect(replayEvent).toBe('pledge_idempotency_committed');
    expect(replayMeta).toMatchObject({
      outcome: 'committed',
      statusCode: 201,
      replay: true,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs rejected outcomes for key reuse and failed pledge requests', async () => {
    const infoSpy = vi.spyOn(loggerModule, 'logInfo');
    const errorSpy = vi.spyOn(loggerModule, 'logError');
    const app = buildApp();

    const failed = await pledge(app, 'obs-rejected-fail-9999', {
      contributor: ALICE,
      amount: 5000,
    });
    expect(failed.status).toBe(400);

    await pledge(app, 'obs-rejected-reuse-9999', { contributor: ALICE, amount: 100 });
    const reused = await pledge(app, 'obs-rejected-reuse-9999', {
      contributor: ALICE,
      amount: 250,
    });
    expect(reused.status).toBe(422);

    const rejectedCalls = errorSpy.mock.calls.filter(
      ([, meta]) => (meta as Record<string, unknown>)?.event === 'pledge_idempotency_rejected',
    );
    expect(rejectedCalls).toHaveLength(2);
    expect(rejectedCalls[0][1]).toMatchObject({
      event: 'pledge_idempotency_rejected',
      outcome: 'rejected',
      reason: 'request_failed',
      statusCode: 400,
    });
    expect(rejectedCalls[1][1]).toMatchObject({
      event: 'pledge_idempotency_rejected',
      outcome: 'rejected',
      reason: 'idempotency_key_reused',
      statusCode: 422,
    });
    expect(
      infoSpy.mock.calls.some(
        ([event, meta]) =>
          event === 'pledge_idempotency_committed' &&
          (meta as Record<string, unknown>)?.keyRef === 'obs-...9999' &&
          (meta as Record<string, unknown>)?.statusCode === 400,
      ),
    ).toBe(false);
  });

  it('logs two concurrent workers receiving the same key and distinguishes pending, committed, and rejected outcomes', async () => {
    shared.available = true;
    const infoSpy = vi.spyOn(loggerModule, 'logInfo');
    const errorSpy = vi.spyOn(loggerModule, 'logError');

    const workerA = buildApp(createIdempotencyMiddleware({ workerId: 'worker-a' }));
    const workerB = buildApp(createIdempotencyMiddleware({ workerId: 'worker-b' }));

    let open!: () => void;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const rawKey = 'concurrent-workers-key-7777';
    // Target is 1000; two concurrent 600-USDC requests mean one commits and the other hits the cap.
    const body = { contributor: ALICE, amount: 600 };

    const reqA = pledge(workerA, rawKey, body).then((r) => r);
    const reqB = pledge(workerB, rawKey, body).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 100));
    open();

    const [resA, resB] = await Promise.all([reqA, reqB]);
    expect([resA.status, resB.status].sort()).toEqual([201, 400]);
    expect(pledgeCount()).toBe(1);

    const pendingWorkers = infoSpy.mock.calls
      .filter(([event]) => event === 'pledge_idempotency_pending')
      .map(([, meta]) => (meta as Record<string, unknown>).workerId)
      .sort();
    expect(pendingWorkers).toEqual(['worker-a', 'worker-b']);

    const committedLogs = infoSpy.mock.calls.filter(
      ([event]) => event === 'pledge_idempotency_committed',
    );
    expect(committedLogs).toHaveLength(1);
    expect(committedLogs[0][1]).toMatchObject({
      outcome: 'committed',
      statusCode: 201,
      replay: false,
    });

    const rejectedLogs = errorSpy.mock.calls.filter(
      ([, meta]) => (meta as Record<string, unknown>)?.event === 'pledge_idempotency_rejected',
    );
    expect(rejectedLogs).toHaveLength(1);
    expect(rejectedLogs[0][1]).toMatchObject({
      outcome: 'rejected',
      reason: 'request_failed',
      statusCode: 400,
    });

    // Subsequent retry on workerB replays the committed response from shared storage.
    const replay = await pledge(workerB, rawKey, body);
    expect(replay.status).toBe(201);
    expect(replay.headers['x-idempotency-cache']).toBe('HIT');
    expect(pledgeCount()).toBe(1);
  });
});
