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
      // The ACAO header must be completely absent — not merely set to a
      // different value. A weaker check (not.toBe) would still pass if the
      // header were echoed back as something other than the origin string.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
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

// ─────────────────────────────────────────────────────────────────────────────
// 8. Case-sensitivity — the allowlist uses exact string matching (Array#includes),
//    so an origin that differs only in letter-case must be rejected.
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — case-sensitivity of origin matching', () => {
  it('rejects an origin that uppercases the scheme', async () => {
    // 'HTTPS://app.example.com' !== 'https://app.example.com'
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'HTTPS://app.example.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects an origin that uppercases the hostname', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://APP.EXAMPLE.COM');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a mixed-case variant of an allowed origin', async () => {
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'Https://App.Example.Com');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Unicode / homograph attacks
//    Visually identical characters from non-ASCII scripts can be used to
//    construct a domain that looks like a trusted origin at a glance.
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — unicode and homograph bypass attempts', () => {
  it('rejects an origin using a Cyrillic lookalike for "a" (U+0430)', async () => {
    // U+0430 CYRILLIC SMALL LETTER A looks identical to U+0061 LATIN SMALL LETTER A
    // 'аpp' here starts with the Cyrillic character.
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://\u0430pp.example.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a punycode-encoded form of an allowed hostname', async () => {
    // xn--pp-fja.example.com is one possible punycode for аpp.example.com;
    // any punycode that is NOT byte-identical to 'app.example.com' must fail.
    const res = await request(app)
      .get(PROBE)
      .set('Origin', 'https://xn--pp-fja.example.com');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Localhost and loopback variants
//     These are common developer shortcuts that must not slip through when a
//     production-style explicit allowlist is active.
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — localhost and loopback bypass attempts', () => {
  const loopbackOrigins = [
    'http://localhost',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1',
    'http://127.0.0.1:3001',
    'http://[::1]',
    'http://[::1]:3001',
  ];

  for (const origin of loopbackOrigins) {
    it(`rejects loopback origin: ${origin}`, async () => {
      const res = await request(app).get(PROBE).set('Origin', origin);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      // ACAO header must be absent — loopback must not be silently whitelisted.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Wildcard entry in the allowlist does not grant subdomain access
//     If an operator mistakenly adds '*.example.com' to ALLOWED_ORIGINS, it
//     should NOT grant access to sub.example.com because:
//       - config.corsAllowedOrigins.includes('*')  → false ('*' !== '*.example.com')
//       - config.corsAllowedOrigins.includes(origin) → false (exact match)
//     This group locks that behaviour in so a future regex-based refactor does
//     not silently loosen the policy.
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — wildcard-in-allowlist does not grant subdomain access', () => {
  // We need a fresh app instance with a wildcard-style entry in ALLOWED_ORIGINS.
  // We use vi.resetModules() + dynamic import to avoid contaminating the
  // top-level app used by all other tests.
  it('does not grant access to a subdomain when allowlist contains *.example.com', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();

    const savedOrigins = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = '*.example.com';

    try {
      const { app: isolatedApp } = await import('./index');
      const res = await request(isolatedApp)
        .get(PROBE)
        .set('Origin', 'https://sub.example.com');

      // '*.example.com' is not the literal string '*', so includes('*') is false.
      // 'https://sub.example.com' !== '*.example.com', so includes(origin) is false.
      // The request must be rejected.
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      process.env.ALLOWED_ORIGINS = savedOrigins;
      vi.resetModules();
    }
  });

  it('does not grant access to the bare domain when allowlist contains *.example.com', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();

    const savedOrigins = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = '*.example.com';

    try {
      const { app: isolatedApp } = await import('./index');
      const res = await request(isolatedApp)
        .get(PROBE)
        .set('Origin', 'https://example.com');

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      process.env.ALLOWED_ORIGINS = savedOrigins;
      vi.resetModules();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Bare OPTIONS (non-CORS preflight)
//     An OPTIONS request without Access-Control-Request-Method is a plain
//     HTTP OPTIONS — not a CORS preflight. The CORS middleware should not
//     treat it as a preflight, but it still applies origin checking.
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — bare OPTIONS (non-preflight)', () => {
  it('handles bare OPTIONS from an allowed origin without leaking CORS headers for disallowed origins', async () => {
    // Allowed origin: normal response expected.
    const allowed = await request(app)
      .options(PROBE)
      .set('Origin', ALLOWED_ORIGIN);

    // Must not be a 403 for the allowed origin.
    expect(allowed.status).not.toBe(403);
  });

  it('blocks bare OPTIONS from a disallowed origin', async () => {
    const res = await request(app)
      .options(PROBE)
      .set('Origin', 'https://evil.com');
    // No Access-Control-Request-Method — this is NOT a CORS preflight.

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Access-Control-Allow-Credentials must be absent on blocked origins
//     Sending credentials:true to a request whose origin was rejected would
//     allow a cross-origin attacker to read credentialed responses. The CORS
//     middleware must not set this header when it rejects the origin.
// ─────────────────────────────────────────────────────────────────────────────
describe('CORS — credentials header absent on blocked origins', () => {
  const credentialSensitiveOrigins = [
    'https://evil.com',
    'https://app.example.com.evil.com',  // subdomain confusion
    'http://app.example.com',            // downgraded protocol
    'https://sub.app.example.com',       // extra subdomain
  ];

  for (const origin of credentialSensitiveOrigins) {
    it(`does not set Access-Control-Allow-Credentials for blocked origin: ${origin}`, async () => {
      const res = await request(app).get(PROBE).set('Origin', origin);

      expect(res.status).toBe(403);
      // This header must not be present — its presence with a credentialed
      // response would enable cross-origin credential theft.
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  }
});
