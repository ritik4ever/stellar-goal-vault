import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, initDb, resetDbForTests } from '../db';
import { addPledge, createCampaign } from '../campaignStore';
import { clearIdempotencyCache, IDEMPOTENCY_TTL_SECONDS } from '../idempotencyCache';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';

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

function buildApp() {
  const app = express();
  app.use(express.json());
  // The same chain as the pledge route: idempotency first, then the real write.
  app.post('/api/campaigns/:id/pledges', idempotencyMiddleware, async (req, res) => {
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
