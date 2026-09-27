/**
 * CORS Security Regression Tests
 *
 * These tests guard the CORS origin allowlist enforced in `index.ts`.
 * They are intentionally written as *negative* tests: every assertion
 * verifies that a disallowed or malformed origin is **rejected**, not
 * accidentally admitted.
 *
 * Protected boundary (index.ts):
 *
 *   cors({
 *     origin: (origin, callback) => {
 *       const isDev = process.env.NODE_ENV !== 'production';
 *       if (
 *         !origin ||
 *         config.corsAllowedOrigins.includes(origin) ||
 *         config.corsAllowedOrigins.includes('*') ||
 *         (isDev && config.corsAllowedOrigins.length === 0)
 *       ) { callback(null, true); }
 *       else { callback(new Error('Not allowed by CORS')); }
 *     },
 *     credentials: true,
 *     ...
 *   })
 *
 * Failure signal: if any test below starts passing when it should fail,
 * it means the boundary above was removed or weakened.
 */

import request from 'supertest';
import { describe, it, expect, beforeAll } from 'vitest';

// ── Environment must be set before `./index` is imported ──────────────────────
// Simulate production-like explicit allowlist so the CORS guard is active.
// NODE_ENV stays 'test' (not 'production') so the app starts without the
// production-only API_KEYS / ALLOWED_ORIGINS startup checks, but we populate
// ALLOWED_ORIGINS explicitly so `isDev && corsAllowedOrigins.length === 0` is
// NOT triggered — i.e. the guard is exercised exactly as it would be in prod.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://staging.example.com';

import { app } from './index';

// ── Shared probe endpoint ─────────────────────────────────────────────────────
// Use GET /api/health — it requires no auth and returns 200 under normal
// conditions, so any non-200/non-403 result is a test environment problem.
const PROBE = '/api/health';

// The single origin that must be unconditionally allowed throughout these tests.
const ALLOWED_ORIGIN = 'https://app.example.com';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Baseline: allowed origin passes
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — baseline (allowed origin)', () => {
  it('returns Access-Control-Allow-Origin for an explicitly allowed origin', async () => {
    const res = await request(app).get(PROBE).set('Origin', ALLOWED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('echoes the second allowed origin correctly', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://staging.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://staging.example.com');
  });

  it('allows requests with no Origin header (server-to-server / curl)', async () => {
    // No Origin header → always allowed per spec; this verifies the !origin branch.
    const res = await request(app).get(PROBE);

    expect(res.status).toBe(200);
  });

  it('sets Access-Control-Allow-Credentials for an allowed origin', async () => {
    const res = await request(app).get(PROBE).set('Origin', ALLOWED_ORIGIN);

    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Bypass attempts — simple unlisted origins
// These MUST return 403 and MUST NOT echo back an Allow-Origin header.
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — bypass attempts (unlisted origins)', () => {
  const blockedOrigins = [
    'https://evil.com',
    'https://attacker.io',
    'http://evil.com',                      // http variant of a blocked origin
    'null',                                 // sandboxed iframe / data-URI origin string

    'https://notexample.com',               // looks similar but is not allowed
    'https://app.example.com.evil.com',     // subdomain confusion
  ];

  for (const origin of blockedOrigins) {
    it(`blocks origin: ${origin}`, async () => {
      const res = await request(app).get(PROBE).set('Origin', origin);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      // The blocked origin must NOT appear in the CORS response header.
      expect(res.headers['access-control-allow-origin']).not.toBe(origin);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Prefix/suffix manipulation (subdomain and path tricks)
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — prefix/suffix manipulation', () => {
  it('rejects an extra subdomain prepended to an allowed origin', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://sub.app.example.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a URL that has an allowed origin as a path suffix', async () => {
    // e.g. https://evil.com/https://app.example.com
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://evil.com/https://app.example.com');

    expect(res.status).toBe(403);
  });

  it('rejects an allowed origin with a port appended', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://app.example.com:8443');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an allowed origin with a path component appended', async () => {
    // Origins must be scheme+host+optional-port only; paths are not allowed.
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://app.example.com/extra-path');

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Protocol downgrade attempts
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — protocol downgrade', () => {
  it('rejects an allowed host over plain http (not https)', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'http://app.example.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an allowed host over ws://', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'ws://app.example.com');

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Malformed / non-standard Origin header values
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — malformed Origin header values', () => {
  it('rejects a bare wildcard Origin header value', async () => {
    const res = await request(app).get(PROBE).set('Origin', '*');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an Origin that is just whitespace', async () => {
    const res = await request(app).get(PROBE).set('Origin', '   ');

    // Either blocked by CORS (403) or stripped to no-origin and passed through
    // (200 with no ACAO header). It must never echo back whitespace as the
    // allowed origin.
    expect([200, 403]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).not.toBe('   ');
  });

  it('rejects an Origin with an embedded newline (header injection attempt)', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://app.example.com\r\nX-Injected: pwned');

    expect(res.status).toBe(403);
  });

  it('rejects an Origin that is not a valid URL', async () => {
    const res = await request(app).get(PROBE).set('Origin', 'not-a-url');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an Origin that is only a scheme', async () => {
    const res = await request(app).get(PROBE).set('Origin', 'https://');

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Preflight (OPTIONS) request behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — preflight (OPTIONS) requests', () => {
  it('returns 204 for a valid preflight from an allowed origin', async () => {
    const res = await request(app)
      .options(PROBE)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');

    // cors package responds with 204 No Content for valid preflights
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('blocks a preflight from a disallowed origin', async () => {
    const res = await request(app)
      .options(PROBE)
      .set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not leak Access-Control-Allow-Origin on a blocked preflight', async () => {
    const res = await request(app)
      .options(PROBE)
      .set('Origin', 'https://attacker.io')
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Wildcard guard — ALLOWED_ORIGINS='*' must NOT be set in this test module
//    (any bypass that slips through because of a '*' in the allowlist is a
//    misconfiguration regression, not a policy regression)
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — wildcard guard (configuration regression)', () => {
  it('confirms ALLOWED_ORIGINS is not a wildcard in this test module', () => {
    // If someone changes the process.env.ALLOWED_ORIGINS assignment at the top
    // of this file to '*', the negative tests above become meaningless.
    // This test acts as a canary.
    const configured = process.env.ALLOWED_ORIGINS ?? '';
    expect(configured).not.toBe('*');
    expect(configured).not.toBe('');
    expect(configured.split(',').map((s) => s.trim())).not.toContain('*');
  });

  it('confirms the allowlist has exactly the two expected entries', () => {
    const entries = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(entries).toEqual([
      'https://app.example.com',
      'https://staging.example.com',
    ]);
  });
});
