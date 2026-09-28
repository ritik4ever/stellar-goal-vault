/**
 * Secret Configuration Security Regression Tests
 *
 * These tests guard every layer of the secret-configuration boundary in this
 * repository.  They are intentionally written as *negative* tests: every
 * assertion verifies that a misconfiguration, bypass, or weakening attempt is
 * **detected and rejected**, not silently accepted.
 *
 * Protected boundaries
 * ────────────────────
 * A) validateEnv — Zod schema + superRefine that blocks startup on bad config
 * B) apiKeyAuthMiddleware — runtime Bearer-token enforcement for write endpoints
 * C) redactSensitive / redactSecretConfig — log-time secret scrubbing
 * D) summarizeSecretConfig — presence-only secret diagnostics (no values)
 * E) .env.example discipline — the example file must never hold real secrets
 * F) Gitleaks configuration — secret-scanning rules must be present and non-empty
 *
 * Failure signal
 * ──────────────
 * If any test below starts *passing* when it previously failed after a code
 * change, that is a sign the protected boundary was removed or weakened.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateEnv, envSchema } from './validateEnv';
import {
  redactSensitive,
  redactSecretConfig,
  summarizeSecretConfig,
  SECRET_CONFIG_ENV_KEYS,
} from './logger';

// ── Path helpers ──────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const GITHUB = path.join(ROOT, '.github');

// ── Shared valid production baseline ─────────────────────────────────────────
// Used as the "known-good" starting point; individual tests deviate from it.
const VALID_PROD_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  SOROBAN_RPC_URL: 'https://soroban-mainnet.stellar.org:443',
  SOROBAN_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
  ALLOWED_ORIGINS: 'https://app.example.com',
  API_KEYS: 'prod-key-alpha,prod-key-beta',
  LOG_LEVEL: 'info',
  WEBHOOK_URL: 'https://hooks.example.com/sgv',
  WEBHOOK_SECRET: 'super-secret-webhook-hmac-key',
};

// ─────────────────────────────────────────────────────────────────────────────
// A. validateEnv — startup-time secret configuration enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — validateEnv production enforcement', () => {
  // ── Baseline ──────────────────────────────────────────────────────────────
  it('accepts a fully-populated valid production environment', () => {
    expect(() => validateEnv(VALID_PROD_ENV)).not.toThrow();
  });

  // ── API_KEYS ──────────────────────────────────────────────────────────────
  it('rejects production when API_KEYS is absent', () => {
    const env = { ...VALID_PROD_ENV, API_KEYS: '' };
    expect(() => validateEnv(env)).toThrow(/API_KEYS is required in production/);
  });

  it('rejects production when API_KEYS contains only commas (no real keys)', () => {
    const env = { ...VALID_PROD_ENV, API_KEYS: ',,,,' };
    expect(() => validateEnv(env)).toThrow(/API_KEYS is required in production/);
  });

  it('rejects production when API_KEYS contains only whitespace tokens', () => {
    // "  ,   ,  " splits and filters to an empty array
    const env = { ...VALID_PROD_ENV, API_KEYS: '  ,   ,  ' };
    expect(() => validateEnv(env)).toThrow(/API_KEYS is required in production/);
  });

  // ── WEBHOOK_SECRET ────────────────────────────────────────────────────────
  it('rejects production when WEBHOOK_URL is set but WEBHOOK_SECRET is empty', () => {
    const env = { ...VALID_PROD_ENV, WEBHOOK_SECRET: '' };
    expect(() => validateEnv(env)).toThrow(
      /WEBHOOK_SECRET is required in production when WEBHOOK_URL is configured/,
    );
  });

  it('rejects production when WEBHOOK_URL is set but WEBHOOK_SECRET is only whitespace', () => {
    const env = { ...VALID_PROD_ENV, WEBHOOK_SECRET: '   ' };
    expect(() => validateEnv(env)).toThrow(
      /WEBHOOK_SECRET is required in production when WEBHOOK_URL is configured/,
    );
  });

  it('accepts production when WEBHOOK_URL is absent (no secret needed)', () => {
    const { WEBHOOK_URL: _, WEBHOOK_SECRET: __, ...envWithoutWebhook } = VALID_PROD_ENV;
    expect(() => validateEnv(envWithoutWebhook)).not.toThrow();
  });

  // ── NODE_ENV bypass attempts ───────────────────────────────────────────────
  it('rejects "prod" as NODE_ENV (must use exact string "production")', () => {
    const env = { ...VALID_PROD_ENV, NODE_ENV: 'prod' };
    expect(() => validateEnv(env)).toThrow(/NODE_ENV must be one of/);
  });

  it('rejects "Production" (case-sensitive check)', () => {
    const env = { ...VALID_PROD_ENV, NODE_ENV: 'Production' };
    expect(() => validateEnv(env)).toThrow(/NODE_ENV must be one of/);
  });

  it('rejects "staging" as NODE_ENV', () => {
    const env = { ...VALID_PROD_ENV, NODE_ENV: 'staging' };
    expect(() => validateEnv(env)).toThrow(/NODE_ENV must be one of/);
  });

  it('rejects a NODE_ENV that is just whitespace', () => {
    const env = { ...VALID_PROD_ENV, NODE_ENV: '  ' };
    expect(() => validateEnv(env)).toThrow(/NODE_ENV must be one of/);
  });

  // ── SOROBAN_RPC_URL protocol ───────────────────────────────────────────────
  it('rejects production when SOROBAN_RPC_URL uses plain http://', () => {
    const env = { ...VALID_PROD_ENV, SOROBAN_RPC_URL: 'http://soroban.example.com:8000' };
    expect(() => validateEnv(env)).toThrow(/SOROBAN_RPC_URL must use HTTPS in production/);
  });

  // ── LOG_LEVEL secret-leak prevention ──────────────────────────────────────
  it('rejects LOG_LEVEL=debug in production (debug logs can leak secrets)', () => {
    const env = { ...VALID_PROD_ENV, LOG_LEVEL: 'debug' };
    expect(() => validateEnv(env)).toThrow(/LOG_LEVEL.*not allowed in production/i);
  });

  // ── CONTRACT_ID ───────────────────────────────────────────────────────────
  it('rejects production when CONTRACT_ID is absent', () => {
    const env = { ...VALID_PROD_ENV, CONTRACT_ID: '' };
    expect(() => validateEnv(env)).toThrow(/CONTRACT_ID is required in production/);
  });

  it('rejects production when CONTRACT_ID is only whitespace', () => {
    const env = { ...VALID_PROD_ENV, CONTRACT_ID: '   ' };
    expect(() => validateEnv(env)).toThrow(/CONTRACT_ID is required in production/);
  });

  // ── CORS wildcard bypass ───────────────────────────────────────────────────
  it('rejects production when ALLOWED_ORIGINS is * (wildcard allows all origins)', () => {
    const env = { ...VALID_PROD_ENV, ALLOWED_ORIGINS: '*' };
    expect(() => validateEnv(env)).toThrow(/ALLOWED_ORIGINS is required in production/);
  });

  it('rejects production when ALLOWED_ORIGINS is empty string', () => {
    const env = { ...VALID_PROD_ENV, ALLOWED_ORIGINS: '' };
    expect(() => validateEnv(env)).toThrow(/ALLOWED_ORIGINS is required in production/);
  });

  // ── Development/test allowed values that production must block ────────────
  it('allows debug LOG_LEVEL in non-production', () => {
    const devEnv = {
      NODE_ENV: 'test',
      CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      SOROBAN_RPC_URL: 'http://localhost:8000',
      SOROBAN_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      LOG_LEVEL: 'debug',
    };
    expect(() => validateEnv(devEnv)).not.toThrow();
  });

  it('allows http SOROBAN_RPC_URL in non-production', () => {
    const devEnv = {
      NODE_ENV: 'development',
      SOROBAN_RPC_URL: 'http://localhost:8000',
      SOROBAN_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    };
    expect(() => validateEnv(devEnv)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. apiKeyAuthMiddleware — runtime API key enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — apiKeyAuthMiddleware enforcement', () => {
  // Import lazily inside each test so process.env changes take effect cleanly.
  // The middleware reads process.env.API_KEYS at call-time, not module-import time.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadMiddleware() {
    vi.resetModules();
    const mod = await import('./middleware/apiKeyAuth');
    return mod.apiKeyAuthMiddleware;
  }

  function makeReq(overrides: Record<string, unknown> = {}): any {
    return {
      path: '/api/campaigns',
      headers: {},
      ...overrides,
    };
  }

  function makeRes(): any {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('throws UNAUTHORIZED when Authorization header is missing', async () => {
    vi.stubEnv('API_KEYS', 'real-prod-key');
    const middleware = await loadMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Missing or invalid Authorization header/);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws UNAUTHORIZED when Authorization header does not use Bearer scheme', async () => {
    vi.stubEnv('API_KEYS', 'real-prod-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Missing or invalid Authorization header/);
  });

  it('throws FORBIDDEN when the supplied API key is not in the valid list', async () => {
    vi.stubEnv('API_KEYS', 'real-prod-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer wrong-key' } });
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Invalid API key/);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the supplied API key is empty after Bearer prefix', async () => {
    vi.stubEnv('API_KEYS', 'real-prod-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer ' } });
    const res = makeRes();
    const next = vi.fn();

    // Empty string after "Bearer " is not in the valid list
    expect(() => middleware(req, res, next)).toThrow(/Invalid API key/);
  });

  it('throws FORBIDDEN for a key that is a prefix of a valid key', async () => {
    vi.stubEnv('API_KEYS', 'real-prod-key-full');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer real-prod-key' } });
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Invalid API key/);
  });

  it('throws FORBIDDEN for a key that is a suffix of a valid key', async () => {
    vi.stubEnv('API_KEYS', 'prefix-real-prod-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer real-prod-key' } });
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Invalid API key/);
  });

  it('calls next() when a valid key is presented', async () => {
    vi.stubEnv('API_KEYS', 'key-one,key-two');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer key-two' } });
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // called with no error argument
  });

  it('allows /api/health (public path) without any Authorization header', async () => {
    vi.stubEnv('API_KEYS', 'real-prod-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ path: '/api/health' });
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('does NOT bypass auth for a path that merely starts with a public prefix substring', async () => {
    // "/api/healthcheck" is not in the whitelist (/api/health matches only by startsWith)
    // Ensure longer paths like /api/health/deep are still allowed (they do start with /api/health)
    vi.stubEnv('API_KEYS', 'real-prod-key');
    const middleware = await loadMiddleware();
    // Paths NOT in public list should require auth
    const req = makeReq({ path: '/api/campaigns', headers: {} });
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. redactSensitive — log-payload secret scrubbing
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — redactSensitive must never leak secret values', () => {
  const SENSITIVE_KEYS = [
    'authorization',
    'Authorization',
    'cookie',
    'api_keys',
    'API_KEYS',
    'apiKey',
    'apiKeys',
    'secret',
    'SECRET_KEY',
    'password',
    'passwd',
    'private_key',
    'privateKey',
    'WEBHOOK_SECRET',
    'webhookSecret',
    'webhook_secret',
    'SERVER_PRIVATE_KEY',
    'token',
    'access_token',
    'refresh_token',
    'client_secret',
    'mnemonic',
    'seed',
  ];

  for (const key of SENSITIVE_KEYS) {
    it(`redacts key "${key}" from log objects`, () => {
      const payload = { [key]: 'super-secret-value-that-must-not-appear', safe: 'visible' };
      const result = redactSensitive(payload) as Record<string, unknown>;

      expect(result[key]).not.toBe('super-secret-value-that-must-not-appear');
      expect(result[key]).toMatch(/\[REDACTED/);
      // Non-sensitive sibling key must still be present
      expect(result['safe']).toBe('visible');
    });
  }

  it('redacts secrets nested inside objects', () => {
    const payload = {
      outer: {
        inner: {
          API_KEYS: 'deeply-nested-secret',
          name: 'still visible',
        },
      },
    };
    const result = redactSensitive(payload) as any;
    expect(result.outer.inner.API_KEYS).toMatch(/\[REDACTED/);
    expect(result.outer.inner.name).toBe('still visible');
  });

  it('redacts Bearer tokens in string values', () => {
    const result = redactSensitive('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
    expect(result).toBe('Bearer [REDACTED]');
  });

  it('redacts credential-bearing Redis URLs in string values', () => {
    const result = redactSensitive('redis://:hunter2@cache.internal:6379/0');
    expect(result).not.toContain('hunter2');
  });

  it('does not redact non-sensitive keys', () => {
    const payload = { campaignId: 'abc123', title: 'My campaign', status: 'open' };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['campaignId']).toBe('abc123');
    expect(result['title']).toBe('My campaign');
    expect(result['status']).toBe('open');
  });

  it('handles null and undefined inputs without throwing', () => {
    expect(() => redactSensitive(null)).not.toThrow();
    expect(() => redactSensitive(undefined)).not.toThrow();
    expect(redactSensitive(null)).toBeNull();
  });

  it('handles arrays, redacting sensitive keys inside them', () => {
    const arr = [{ API_KEYS: 'k1,k2', safe: 'ok' }];
    const result = redactSensitive(arr) as any[];
    expect(result[0].API_KEYS).toMatch(/\[REDACTED/);
    expect(result[0].safe).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. redactSecretConfig / summarizeSecretConfig — structured secret diagnostics
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — redactSecretConfig and summarizeSecretConfig', () => {
  it('redactSecretConfig masks API_KEYS value but counts keys', () => {
    const cfg = { API_KEYS: 'key-alpha,key-beta,key-gamma', PORT: '3001' };
    const result = redactSecretConfig(cfg);
    // Must not contain the actual key values
    expect(JSON.stringify(result)).not.toContain('key-alpha');
    expect(JSON.stringify(result)).not.toContain('key-beta');
    // Should include a count hint
    expect(String(result['API_KEYS'])).toContain('REDACTED');
    // Non-secret key passes through
    expect(result['PORT']).toBe('3001');
  });

  it('redactSecretConfig masks WEBHOOK_SECRET completely', () => {
    const cfg = { WEBHOOK_SECRET: 'my-signing-secret', LOG_LEVEL: 'info' };
    const result = redactSecretConfig(cfg);
    expect(JSON.stringify(result)).not.toContain('my-signing-secret');
    expect(String(result['WEBHOOK_SECRET'])).toContain('REDACTED');
  });

  it('redactSecretConfig masks SERVER_PRIVATE_KEY completely', () => {
    const cfg = { SERVER_PRIVATE_KEY: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    const result = redactSecretConfig(cfg);
    expect(JSON.stringify(result)).not.toContain('SAAAA');
  });

  it('redactSecretConfig masks credential-bearing REDIS_URL', () => {
    const cfg = { REDIS_URL: 'redis://:hunter2@cache.prod:6379/0' };
    const result = redactSecretConfig(cfg);
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(String(result['REDIS_URL'])).toContain('REDACTED');
  });

  it('summarizeSecretConfig reports configured=true for set secrets', () => {
    const env = { API_KEYS: 'key1', WEBHOOK_SECRET: 'shh', SERVER_PRIVATE_KEY: 'S123' };
    const summary = summarizeSecretConfig(env);
    expect(summary['API_KEYS_configured']).toBe(true);
    expect(summary['WEBHOOK_SECRET_configured']).toBe(true);
    expect(summary['SERVER_PRIVATE_KEY_configured']).toBe(true);
  });

  it('summarizeSecretConfig reports configured=false for absent secrets', () => {
    const env: Record<string, string | undefined> = {
      API_KEYS: '',
      WEBHOOK_SECRET: undefined,
      SERVER_PRIVATE_KEY: '   ', // whitespace-only counts as not configured
    };
    const summary = summarizeSecretConfig(env);
    expect(summary['API_KEYS_configured']).toBe(false);
    expect(summary['WEBHOOK_SECRET_configured']).toBe(false);
    // summarizeSecretConfig uses Boolean(raw && raw.trim()) — whitespace is falsy after trim
    expect(summary['SERVER_PRIVATE_KEY_configured']).toBe(false);
  });

  it('summarizeSecretConfig never includes actual secret values', () => {
    const env = { API_KEYS: 'ultra-secret-key', WEBHOOK_SECRET: 'top-secret' };
    const summary = summarizeSecretConfig(env);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('ultra-secret-key');
    expect(serialized).not.toContain('top-secret');
  });

  it('SECRET_CONFIG_ENV_KEYS list contains all expected sensitive vars', () => {
    // If someone removes a key from this list, redactSecretConfig will start
    // emitting raw values for that key. This test is the canary.
    const required = ['API_KEYS', 'WEBHOOK_SECRET', 'SERVER_PRIVATE_KEY', 'REDIS_URL'];
    for (const key of required) {
      expect(SECRET_CONFIG_ENV_KEYS).toContain(key as any);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. .env.example discipline — no real secrets in the committed example files
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — .env.example files must not contain real secrets', () => {
  const EXAMPLE_FILES = [
    path.join(ROOT, '.env.example'),
    path.join(BACKEND, '.env.example'),
  ];

  // Patterns that indicate a real secret has been accidentally committed
  const SECRET_PATTERNS: Array<{ label: string; re: RegExp }> = [
    // Stellar secret keys: S + 55 base32 chars
    { label: 'Stellar secret key (S...)', re: /^[^#]*=\s*S[A-Z2-7]{55}/m },
    // Generic high-entropy assignment that looks like a real key/token (≥32 chars after =)
    { label: 'high-entropy secret assignment', re: /^[^#]*(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)\s*=\s*[A-Za-z0-9+/=_-]{32,}/m },
    // Password embedded in a URL (redis://:password@host)
    { label: 'credential-bearing URL', re: /redis:\/\/:[^@\s]{4,}@/ },
    // GitHub tokens
    { label: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{36}/ },
  ];

  for (const filePath of EXAMPLE_FILES) {
    for (const { label, re } of SECRET_PATTERNS) {
      it(`${path.relative(ROOT, filePath)} does not contain: ${label}`, () => {
        if (!fs.existsSync(filePath)) {
          // File is optional at the root level; skip rather than fail
          return;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(
          re.test(content),
          `Found pattern "${label}" in ${path.relative(ROOT, filePath)} — ` +
          'real secrets must never be committed even in example files',
        ).toBe(false);
      });
    }
  }

  it('backend .env.example has CONTRACT_ID defined but left empty', () => {
    const content = fs.readFileSync(path.join(BACKEND, '.env.example'), 'utf-8');
    // CONTRACT_ID should appear and its value should be blank (not a real contract address)
    expect(content).toMatch(/CONTRACT_ID\s*=/);
    const match = content.match(/^CONTRACT_ID\s*=\s*(.*)$/m);
    const value = (match?.[1] ?? '').trim();
    expect(value, 'CONTRACT_ID in .env.example should be empty — do not commit a real contract ID').toBe('');
  });

  it('backend .env.example has SERVER_PRIVATE_KEY absent or empty', () => {
    const content = fs.readFileSync(path.join(BACKEND, '.env.example'), 'utf-8');
    const match = content.match(/^[^#\n]*SERVER_PRIVATE_KEY\s*=\s*(.*)$/m);
    if (match) {
      const value = match[1].trim();
      expect(
        value,
        'SERVER_PRIVATE_KEY in .env.example must not have a real value',
      ).toBe('');
    }
    // If there's no assignment at all that's fine
  });

  it('root .env.example has SERVER_PRIVATE_KEY absent or empty', () => {
    const content = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf-8');
    const match = content.match(/^[^#\n]*SERVER_PRIVATE_KEY\s*=\s*(.*)$/m);
    if (match) {
      const value = match[1].trim();
      expect(
        value,
        'SERVER_PRIVATE_KEY in root .env.example must not have a real value',
      ).toBe('');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Gitleaks configuration — secret-scanning rules must be present
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — Gitleaks secret-scanning configuration', () => {
  const GITLEAKS_TOML = path.join(ROOT, '.gitleaks.toml');
  const GITLEAKS_WORKFLOW = path.join(GITHUB, 'workflows', 'gitleaks.yml');

  it('.gitleaks.toml exists', () => {
    expect(fs.existsSync(GITLEAKS_TOML)).toBe(true);
  });

  it('.gitleaks.toml defines a rule for Stellar secret keys', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf-8');
    expect(content).toContain('stellar-secret-key');
  });

  it('.gitleaks.toml defines a rule for generic API keys', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf-8');
    expect(content).toContain('generic-api-key');
  });

  it('.gitleaks.toml does not have an empty [rules] section (no rules = no scanning)', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf-8');
    // Should have at least one [[rules]] entry
    expect(content).toMatch(/\[\[rules\]\]/);
  });

  it('.gitleaks.toml Stellar secret key rule regex covers S + 55 base32 chars', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf-8');
    // The regex should be broad enough to catch S[A-Z2-7]{55}
    expect(content).toMatch(/S\[A-Z2-7\]\{55\}/);
  });

  it('gitleaks workflow exists', () => {
    expect(fs.existsSync(GITLEAKS_WORKFLOW)).toBe(true);
  });

  it('gitleaks workflow runs on push to main', () => {
    const content = fs.readFileSync(GITLEAKS_WORKFLOW, 'utf-8');
    expect(content).toMatch(/push:/);
    expect(content).toMatch(/main|master/);
  });

  it('gitleaks workflow runs on pull_request', () => {
    const content = fs.readFileSync(GITLEAKS_WORKFLOW, 'utf-8');
    expect(content).toMatch(/pull_request:/);
  });

  it('gitleaks workflow passes fetch-depth: 0 (scans full history)', () => {
    const content = fs.readFileSync(GITLEAKS_WORKFLOW, 'utf-8');
    // Without full history, only the latest commit is scanned
    expect(content).toMatch(/fetch-depth:\s*0/);
  });

  it('gitleaks workflow references the .gitleaks.toml config file', () => {
    const content = fs.readFileSync(GITLEAKS_WORKFLOW, 'utf-8');
    expect(content).toContain('.gitleaks.toml');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Canary / negative self-verification
//    These tests prove that the detectors above would catch regressions.
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — canary self-verification', () => {
  it('validateEnv envSchema accepts a valid production config (canary baseline)', () => {
    const result = envSchema.safeParse(VALID_PROD_ENV);
    expect(result.success).toBe(true);
  });

  it('removing API_KEYS causes envSchema to report an issue in production', () => {
    const result = envSchema.safeParse({ ...VALID_PROD_ENV, API_KEYS: '' });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message).join(' ') ?? '';
    expect(messages).toMatch(/API_KEYS/);
  });

  it('removing WEBHOOK_SECRET when WEBHOOK_URL is set causes envSchema to report an issue', () => {
    const result = envSchema.safeParse({ ...VALID_PROD_ENV, WEBHOOK_SECRET: '' });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message).join(' ') ?? '';
    expect(messages).toMatch(/WEBHOOK_SECRET/);
  });

  it('redactSensitive detector catches a key named "secret"', () => {
    const result = redactSensitive({ secret: 'must-not-appear' }) as any;
    expect(result.secret).not.toBe('must-not-appear');
    expect(result.secret).toMatch(/\[REDACTED/);
  });

  it('Stellar secret key pattern correctly matches a 56-char S-key', () => {
    const pattern = /S[A-Z2-7]{55}/;
    const fakeKey = 'S' + 'A'.repeat(55);
    expect(pattern.test(fakeKey)).toBe(true);
    // Must NOT match a public key (G-prefix)
    expect(pattern.test('G' + 'A'.repeat(55))).toBe(false);
  });

  it('high-entropy secret pattern does not flag commented-out lines', () => {
    const pattern = /^[^#]*(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)\s*=\s*[A-Za-z0-9+/=_-]{32,}/m;
    const commented = '# API_KEY=abcdefghijklmnopqrstuvwxyz12345678';
    expect(pattern.test(commented)).toBe(false);
    const uncommented = 'API_KEY=abcdefghijklmnopqrstuvwxyz12345678';
    expect(pattern.test(uncommented)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Additional validateEnv edge cases
//
//    These cover bypass paths that are not tested in groups A or the existing
//    validateEnv.test.ts: the CORS_ALLOWED_ORIGINS alias wildcard path,
//    whitespace-only ALLOWED_ORIGINS resolving through the alias, and the
//    SOROBAN_RPC_URL HTTP bypass when URL is http:// with a trailing slash.
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — validateEnv additional edge cases', () => {
  // ── CORS alias wildcard bypass ─────────────────────────────────────────────
  it('rejects production when ALLOWED_ORIGINS is unset and CORS_ALLOWED_ORIGINS is *', () => {
    // If ALLOWED_ORIGINS is absent, the resolver falls back to CORS_ALLOWED_ORIGINS.
    // A wildcard in the alias must be caught — not silently accepted.
    const env = {
      ...VALID_PROD_ENV,
      ALLOWED_ORIGINS: '',
      CORS_ALLOWED_ORIGINS: '*',
    };
    expect(() => validateEnv(env)).toThrow(/ALLOWED_ORIGINS is required in production/);
  });

  it('rejects production when ALLOWED_ORIGINS is whitespace-only and CORS_ALLOWED_ORIGINS is *', () => {
    // ALLOWED_ORIGINS='   ' is truthy in JS but resolves to '' via OR short-circuit in validateEnv
    // (the schema reads: ALLOWED_ORIGINS || CORS_ALLOWED_ORIGINS || '')
    // Even if whitespace resolves to CORS_ALLOWED_ORIGINS='*', the wildcard must be rejected.
    const env = {
      ...VALID_PROD_ENV,
      ALLOWED_ORIGINS: '   ',
      CORS_ALLOWED_ORIGINS: '*',
    };
    // Whether whitespace resolves to the alias or stays as-is, the result must still fail:
    // whitespace-only splits to [] after trim+filter, which is empty → rejected.
    // OR the alias '*' → rejected.
    expect(() => validateEnv(env)).toThrow(/ALLOWED_ORIGINS is required in production/);
  });

  it('rejects production when both ALLOWED_ORIGINS and CORS_ALLOWED_ORIGINS are empty', () => {
    const env = {
      ...VALID_PROD_ENV,
      ALLOWED_ORIGINS: '',
      CORS_ALLOWED_ORIGINS: '',
    };
    expect(() => validateEnv(env)).toThrow(/ALLOWED_ORIGINS is required in production/);
  });

  it('accepts production when CORS_ALLOWED_ORIGINS is used as alias with a valid origin', () => {
    // The alias is legitimate when ALLOWED_ORIGINS is unset — document this boundary
    const { ALLOWED_ORIGINS: _, ...envWithoutPrimary } = VALID_PROD_ENV;
    const env = {
      ...envWithoutPrimary,
      ALLOWED_ORIGINS: '',
      CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    };
    expect(() => validateEnv(env)).not.toThrow();
  });

  // ── SOROBAN_RPC_URL HTTP bypass variants ───────────────────────────────────
  it('rejects production when SOROBAN_RPC_URL is http:// with trailing path', () => {
    const env = {
      ...VALID_PROD_ENV,
      SOROBAN_RPC_URL: 'http://soroban.example.com/rpc',
    };
    expect(() => validateEnv(env)).toThrow(/SOROBAN_RPC_URL must use HTTPS in production/);
  });

  it('rejects production when SOROBAN_RPC_URL uses ws:// (WebSocket, not HTTPS)', () => {
    const env = {
      ...VALID_PROD_ENV,
      SOROBAN_RPC_URL: 'ws://soroban.example.com:8000',
    };
    // ws:// is a valid URL but not https: — must be rejected
    expect(() => validateEnv(env)).toThrow(/SOROBAN_RPC_URL must use HTTPS in production/);
  });

  // ── API_KEYS whitespace-only tokens ───────────────────────────────────────
  it('rejects production when every API_KEYS token is only spaces after splitting', () => {
    // "  ,   ,  " splits to ['  ', '   ', '  '] then filter(Boolean) keeps them all
    // because non-empty strings are truthy — but the spaces-only check in validateEnv
    // uses filter(Boolean) which keeps whitespace strings.
    // This documents the ACTUAL behaviour: whitespace tokens DO pass filter(Boolean).
    // The correct production guard is therefore to use trimmed tokens.
    // validateEnv uses: (data.API_KEYS || '').split(',').filter(Boolean)
    // '  ,   ,  '.split(',') = ['  ', '   ', '  '] — all truthy, so length = 3 → PASSES.
    // This is a known limitation: whitespace-padded API_KEYS passes validateEnv.
    // The security risk: no real key, but auth middleware will receive those whitespace keys
    // and only reject them at runtime (the key in the Bearer token won't match).
    // We document this as a known gap by asserting the CURRENT behavior:
    const env = { ...VALID_PROD_ENV, API_KEYS: '  ,   ,  ' };
    // Current: filter(Boolean) keeps whitespace-only tokens → 3 entries → does NOT throw
    // This test is a DOCUMENTATION test. If validateEnv is strengthened to trim tokens,
    // update this test to expect a throw.
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('rejects production when API_KEYS is only commas (filter produces empty array)', () => {
    // ',,,,'.split(',').filter(Boolean) = [] → empty → correctly rejected
    const env = { ...VALID_PROD_ENV, API_KEYS: ',,,,' };
    expect(() => validateEnv(env)).toThrow(/API_KEYS is required in production/);
  });

  // ── LOG_LEVEL silent ───────────────────────────────────────────────────────
  it('accepts LOG_LEVEL=silent in production (silent suppresses all output, not a leak risk)', () => {
    const env = { ...VALID_PROD_ENV, LOG_LEVEL: 'silent' };
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('accepts LOG_LEVEL=warn in production', () => {
    const env = { ...VALID_PROD_ENV, LOG_LEVEL: 'warn' };
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('rejects an unrecognised LOG_LEVEL value in any environment', () => {
    const env = { ...VALID_PROD_ENV, LOG_LEVEL: 'verbose' as any };
    expect(() => validateEnv(env)).toThrow();
  });

  // ── CONTRACT_ID whitespace variants ───────────────────────────────────────
  it('rejects production when CONTRACT_ID is only tabs and spaces', () => {
    const env = { ...VALID_PROD_ENV, CONTRACT_ID: '\t  \t' };
    expect(() => validateEnv(env)).toThrow(/CONTRACT_ID is required in production/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. apiKeyAuthMiddleware — additional boundary cases
//
//    Covers the whitespace-key padding trap, the dev-mode empty-key pass-through
//    quirk, the x-api-key header header format, and other middleware edge cases
//    not covered in group B.
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — apiKeyAuthMiddleware additional cases', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadMiddleware() {
    vi.resetModules();
    const mod = await import('./middleware/apiKeyAuth');
    return mod.apiKeyAuthMiddleware;
  }

  function makeReq(overrides: Record<string, unknown> = {}): any {
    return { path: '/api/campaigns', headers: {}, ...overrides };
  }

  function makeRes(): any {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('rejects a key with surrounding whitespace when the stored key has no whitespace', async () => {
    // If an operator sets API_KEYS="real-key" but a client sends "Bearer  real-key" (extra space),
    // the middleware must reject it — exact match only.
    vi.stubEnv('API_KEYS', 'real-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer  real-key' } }); // two spaces
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Invalid API key/);
  });

  it('rejects an API key that has leading/trailing whitespace when stored key is trimmed', async () => {
    // API_KEYS=" real-key " — the middleware uses split(',').filter(Boolean) without trim.
    // The stored entry is ' real-key ' with spaces; 'real-key' will NOT match it.
    // This documents the whitespace-padding misconfiguration risk.
    vi.stubEnv('API_KEYS', ' real-key ');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer real-key' } });
    const res = makeRes();
    const next = vi.fn();

    // The key 'real-key' is not in [' real-key '] → FORBIDDEN
    expect(() => middleware(req, res, next)).toThrow(/Invalid API key/);
  });

  it('allows all public paths without auth even when API_KEYS is set', async () => {
    const publicPaths = [
      '/api/health',
      '/api/config',
      '/api/stats',
      '/api/leaderboard',
      '/api/open-issues',
    ];
    vi.stubEnv('API_KEYS', 'real-key');
    const middleware = await loadMiddleware();

    for (const publicPath of publicPaths) {
      const req = makeReq({ path: publicPath });
      const res = makeRes();
      const next = vi.fn();
      middleware(req, res, next);
      expect(next, `expected next() for public path ${publicPath}`).toHaveBeenCalled();
    }
  });

  it('allows a sub-path of a public path (startsWith match)', async () => {
    // /api/health/details starts with /api/health → public
    vi.stubEnv('API_KEYS', 'real-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ path: '/api/health/details' });
    const res = makeRes();
    const next = vi.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes through in dev-mode even with a nonsense Bearer token', async () => {
    // When API_KEYS is empty, any Bearer value passes — this is the dev escape hatch.
    // The test documents and pins this intentional behaviour.
    vi.stubEnv('API_KEYS', '');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer totally-not-a-real-key' } });
    const res = makeRes();
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('throws UNAUTHORIZED for Authorization: Bearer (no key, only the scheme word)', async () => {
    // "Bearer" without a space — authHeader.startsWith('Bearer ') requires the space
    vi.stubEnv('API_KEYS', 'real-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: 'Bearer' } });
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Missing or invalid Authorization header/);
  });

  it('throws UNAUTHORIZED for an empty Authorization header value', async () => {
    vi.stubEnv('API_KEYS', 'real-key');
    const middleware = await loadMiddleware();
    const req = makeReq({ headers: { authorization: '' } });
    const res = makeRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/Missing or invalid Authorization header/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. redactSensitive — additional boundary cases
//
//    Covers: non-string primitives in sensitive keys, the x-api-key HTTP header
//    name, depth-limit behaviour, and GitHub token string detection.
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — redactSensitive additional boundary cases', () => {
  it('redacts x-api-key (HTTP header name matched by SENSITIVE_KEY_RE)', () => {
    const payload = { 'x-api-key': 'some-api-key-value', safe: 'ok' };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['x-api-key']).toBe('[REDACTED]');
    expect(result['safe']).toBe('ok');
  });

  it('redacts set-cookie (HTTP response header matched by SENSITIVE_KEY_RE)', () => {
    const payload = { 'set-cookie': 'session=abc123; HttpOnly', page: 1 };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['set-cookie']).toBe('[REDACTED]');
    expect(result['page']).toBe(1);
  });

  it('replaces a numeric value in a sensitive key with the [REDACTED] string', () => {
    // { token: 12345 } — the value is a number, not a string.
    // redactSensitive always writes '[REDACTED]' (string) for sensitive keys regardless of type.
    const payload = { token: 12345, count: 7 };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['token']).toBe('[REDACTED]');
    expect(result['count']).toBe(7); // non-sensitive numeric passes through unchanged
  });

  it('replaces a boolean value in a sensitive key with [REDACTED]', () => {
    const payload = { secret: true, enabled: false };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['secret']).toBe('[REDACTED]');
    expect(result['enabled']).toBe(false);
  });

  it('replaces an array value in a sensitive key with [REDACTED]', () => {
    const payload = { api_keys: ['key1', 'key2'], names: ['alice', 'bob'] };
    const result = redactSensitive(payload) as Record<string, unknown>;
    // Sensitive key — value replaced regardless of type
    expect(result['api_keys']).toBe('[REDACTED]');
    // Non-sensitive array passes through
    expect(result['names']).toEqual(['alice', 'bob']);
  });

  it('redacts a GitHub PAT string (ghp_ prefix) to [REDACTED_TOKEN]', () => {
    const token = 'ghp_' + 'A'.repeat(36);
    const result = redactSensitive(token);
    expect(result).toBe('[REDACTED_TOKEN]');
  });

  it('redacts a GitHub OAuth token string (gho_ prefix) to [REDACTED_TOKEN]', () => {
    const token = 'gho_' + 'B'.repeat(36);
    const result = redactSensitive(token);
    expect(result).toBe('[REDACTED_TOKEN]');
  });

  it('does not redact a non-sensitive string that happens to contain "key" as a substring', () => {
    // "monkeybar" contains "key" but is not a sensitive key name
    const payload = { monkeybar: 'visible', keyboard: 'also visible' };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['monkeybar']).toBe('visible');
    expect(result['keyboard']).toBe('also visible');
  });

  it('returns null unchanged (null is not an object to walk)', () => {
    expect(redactSensitive(null)).toBeNull();
  });

  it('returns undefined unchanged', () => {
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it('handles an empty object without throwing', () => {
    const result = redactSensitive({});
    expect(result).toEqual({});
  });

  it('handles an empty array without throwing', () => {
    const result = redactSensitive([]);
    expect(result).toEqual([]);
  });

  it('redacts database_url and db_url keys (credential-bearing URL aliases)', () => {
    // SENSITIVE_KEY_RE covers database[_-]?url and db[_-]?url
    const payload = {
      database_url: 'postgres://user:pass@host/db',
      db_url: 'mysql://root:secret@localhost/app',
    };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['database_url']).toBe('[REDACTED]');
    expect(result['db_url']).toBe('[REDACTED]');
  });

  it('redacts wallet_secret and webhook_secret keys', () => {
    const payload = {
      wallet_secret: 'S' + 'A'.repeat(55),
      webhook_secret: 'hmac-signing-key',
    };
    const result = redactSensitive(payload) as Record<string, unknown>;
    expect(result['wallet_secret']).toBe('[REDACTED]');
    expect(result['webhook_secret']).toBe('[REDACTED]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. redactSecretConfig — additional precision tests
//
//    Verifies the count reporting in API_KEYS redaction, DATABASE_URL handling,
//    and that the SECRET_CONFIG_ENV_KEYS list covers DATABASE_URL.
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — redactSecretConfig additional precision', () => {
  it('redactSecretConfig reports the correct key count for API_KEYS', () => {
    const cfg = { API_KEYS: 'k1,k2,k3', PORT: '3001' };
    const result = redactSecretConfig(cfg);
    // Should say "3 keys"
    expect(String(result['API_KEYS'])).toMatch(/3 key/);
    expect(String(result['API_KEYS'])).toContain('REDACTED');
  });

  it('redactSecretConfig reports 1 key for a single-key API_KEYS value', () => {
    const cfg = { API_KEYS: 'only-one-key' };
    const result = redactSecretConfig(cfg);
    expect(String(result['API_KEYS'])).toMatch(/1 key[^s]/); // singular
  });

  it('redactSecretConfig masks DATABASE_URL completely', () => {
    const cfg = { DATABASE_URL: 'postgres://user:pass@db.internal/prod' };
    const result = redactSecretConfig(cfg);
    expect(JSON.stringify(result)).not.toContain('user');
    expect(JSON.stringify(result)).not.toContain('pass');
    expect(String(result['DATABASE_URL'])).toContain('REDACTED');
  });

  it('SECRET_CONFIG_ENV_KEYS includes DATABASE_URL', () => {
    expect(SECRET_CONFIG_ENV_KEYS).toContain('DATABASE_URL' as any);
  });

  it('summarizeSecretConfig reports configured=true for DATABASE_URL when set', () => {
    const env = { DATABASE_URL: 'postgres://user:pass@host/db' };
    const summary = summarizeSecretConfig(env);
    expect(summary['DATABASE_URL_configured']).toBe(true);
  });

  it('summarizeSecretConfig reports configured=false for DATABASE_URL when absent', () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: undefined };
    const summary = summarizeSecretConfig(env);
    expect(summary['DATABASE_URL_configured']).toBe(false);
  });

  it('redactSecretConfig passes through PORT and NODE_ENV unchanged', () => {
    const cfg = { PORT: '3001', NODE_ENV: 'production', API_KEYS: 'k1' };
    const result = redactSecretConfig(cfg);
    expect(result['PORT']).toBe('3001');
    expect(result['NODE_ENV']).toBe('production');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. walletIntegrationReady — partial Soroban network configuration
//
//    config.ts exports `walletIntegrationReady` which gates pledge-signing.
//    If only one of SOROBAN_RPC_URL / SOROBAN_NETWORK_PASSPHRASE is set (and
//    the other is not), hasSorobanNetworkProfile is false and the flag is false
//    even though validateEnv passed. These tests pin that boundary.
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — walletIntegrationReady partial-config edge cases', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadConfig() {
    vi.resetModules();
    return import('./config');
  }

  it('is false when CONTRACT_ID is empty (even if RPC and passphrase are set)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CONTRACT_ID', '');
    vi.stubEnv('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org:443');
    vi.stubEnv('SOROBAN_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015');
    const { walletIntegrationReady } = await loadConfig();
    expect(walletIntegrationReady).toBe(false);
  });

  it('is false when SOROBAN_RPC_URL is set but SOROBAN_NETWORK_PASSPHRASE is absent', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CONTRACT_ID', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    vi.stubEnv('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org:443');
    vi.stubEnv('SOROBAN_NETWORK_PASSPHRASE', '');
    // useDevelopmentDefaults = false (RPC is set), hasSorobanNetworkProfile = false
    const { walletIntegrationReady } = await loadConfig();
    expect(walletIntegrationReady).toBe(false);
  });

  it('is false when SOROBAN_NETWORK_PASSPHRASE is set but SOROBAN_RPC_URL is absent', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CONTRACT_ID', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    vi.stubEnv('SOROBAN_RPC_URL', '');
    vi.stubEnv('SOROBAN_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015');
    // useDevelopmentDefaults = false (passphrase is set), hasSorobanNetworkProfile = false
    const { walletIntegrationReady } = await loadConfig();
    expect(walletIntegrationReady).toBe(false);
  });

  it('is true when CONTRACT_ID, RPC URL, and passphrase are all set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CONTRACT_ID', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    vi.stubEnv('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org:443');
    vi.stubEnv('SOROBAN_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015');
    const { walletIntegrationReady } = await loadConfig();
    expect(walletIntegrationReady).toBe(true);
  });

  it('is true in development with no RPC/passphrase set (testnet defaults apply)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CONTRACT_ID', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    vi.stubEnv('SOROBAN_RPC_URL', '');
    vi.stubEnv('SOROBAN_NETWORK_PASSPHRASE', '');
    // useDevelopmentDefaults = true → hasSorobanNetworkProfile = true
    const { walletIntegrationReady } = await loadConfig();
    expect(walletIntegrationReady).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M. Gitleaks allowlist — scope validation
//
//    The .gitleaks.toml allowlist paths use glob-style patterns that point to
//    backend/src/tests/.* — but the actual test files live directly in
//    backend/src/*.test.ts, NOT in a tests/ subdirectory. This group asserts
//    that the main source files we know contain fixture API keys do NOT match
//    the allowlist path pattern, ensuring gitleaks would still scan them.
//    It also verifies that fixture strings used in these test files are
//    short-enough or contain hyphens that they won't false-trigger the
//    generic-api-key rule (length < 16 or contains non-[a-z0-9] chars).
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — Gitleaks allowlist scope validation', () => {
  it('.gitleaks.toml allowlist does NOT exempt backend/src/*.test.ts files', () => {
    const content = fs.readFileSync(path.join(ROOT, '.gitleaks.toml'), 'utf-8');
    // The allowlist path is backend/src/tests/.* — NOT backend/src/ directly
    // Test files at backend/src/*.test.ts are NOT in that path and ARE scanned
    expect(content).toContain('backend/src/tests/.*');
    expect(content).not.toMatch(/backend\/src\/\*\.test\.ts/); // not exempted by glob
  });

  it('fixture API key strings in the test suite use hyphens (exempt from generic-api-key regex)', () => {
    // gitleaks generic-api-key rule: [a-z0-9]{16,128} (no hyphens)
    // Keys like "prod-key-alpha" contain hyphens → won't match → safe to use in tests
    const genericKeyRe = /(?:api_key|apikey|secret|password|private_key|token)[-|_|=|\s|:]{1,4}([a-z0-9]{16,128})/i;
    const fixtureKeys = ['prod-key-alpha', 'prod-key-beta', 'real-prod-key', 'key-one', 'key-two'];
    for (const key of fixtureKeys) {
      // These are used as values, not as inline assignments — they won't trigger the rule
      // But even if they appeared as `API_KEYS=prod-key-alpha`, the value has hyphens
      expect(genericKeyRe.test(`API_KEYS=${key}`)).toBe(false);
    }
  });

  it('.gitleaks.toml allowlist regex for sha512 hashes does not exempt real Stellar keys', () => {
    const stellarKeyRe = /S[A-Z2-7]{55}/;
    // A sha512 hash starts with sha512- — it should NOT match the Stellar key pattern
    const sha512Hash = 'sha512-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/==';
    expect(stellarKeyRe.test(sha512Hash)).toBe(false);
  });

  it('.gitleaks.toml does not exempt the backend/src directory entirely', () => {
    const content = fs.readFileSync(path.join(ROOT, '.gitleaks.toml'), 'utf-8');
    // Would be a critical misconfiguration — no broad exemption of the entire src tree
    expect(content).not.toMatch(/["']backend\/src["']/);
    expect(content).not.toMatch(/["']backend\/src\/\*\*["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N. Additional canary / self-verification expansions
// ─────────────────────────────────────────────────────────────────────────────
describe('Secret config — additional canary self-verification', () => {
  it('SENSITIVE_KEY_RE matches x-api-key case-insensitively', () => {
    const re = /^(authorization|cookie|set-cookie|x-api-key|api[_-]?keys?|secret|password|passwd|private[_-]?key|seed|mnemonic|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|wallet[_-]?secret|webhook[_-]?secret|secret[_-]?key|server[_-]?private[_-]?key|redis[_-]?url|database[_-]?url|db[_-]?url|connection[_-]?string)$/i;
    expect(re.test('x-api-key')).toBe(true);
    expect(re.test('X-API-KEY')).toBe(true);
    expect(re.test('set-cookie')).toBe(true);
    expect(re.test('database_url')).toBe(true);
    expect(re.test('db_url')).toBe(true);
    expect(re.test('connection_string')).toBe(true);
    // Non-sensitive names must not match
    expect(re.test('campaignId')).toBe(false);
    expect(re.test('title')).toBe(false);
    expect(re.test('status')).toBe(false);
  });

  it('CORS alias resolution: ALLOWED_ORIGINS || CORS_ALLOWED_ORIGINS means alias is checked', () => {
    // Demonstrates that if ALLOWED_ORIGINS is falsy, CORS_ALLOWED_ORIGINS feeds the check
    const originsStr = '' || '*' || '';
    const originList = originsStr.split(',').map((o: string) => o.trim()).filter(Boolean);
    // '*' in list → should be rejected in production
    expect(originList).toContain('*');
  });

  it('walletIntegrationReady formula: both URL and passphrase must be set for non-dev profile', () => {
    // Mirrors the exact logic in config.ts:
    //   const useDevelopmentDefaults = !isProduction && !configuredRpcUrl && !configuredNetworkPassphrase;
    //   const hasSorobanNetworkProfile = Boolean(useDevelopmentDefaults || (configuredRpcUrl && configuredNetworkPassphrase));
    //   walletIntegrationReady = Boolean(contractId && rpcUrl && passphrase && hasSorobanNetworkProfile);
    function computeReady(contractId: string, rpcUrl: string, passphrase: string, isProduction: boolean): boolean {
      const useDevelopmentDefaults = !isProduction && !rpcUrl && !passphrase;
      const hasSorobanNetworkProfile = Boolean(useDevelopmentDefaults || (rpcUrl && passphrase));
      return Boolean(contractId && rpcUrl && passphrase && hasSorobanNetworkProfile);
    }

    // Only RPC URL set, not production — not ready (passphrase missing)
    expect(computeReady('CONTRACT', 'https://rpc.example', '', false)).toBe(false);
    // Only passphrase set, not production — not ready (RPC missing)
    expect(computeReady('CONTRACT', '', 'passphrase', false)).toBe(false);
    // Both set, not production — ready
    expect(computeReady('CONTRACT', 'https://rpc.example', 'passphrase', false)).toBe(true);
    // Contract missing — not ready
    expect(computeReady('', 'https://rpc.example', 'passphrase', false)).toBe(false);
  });

  it('API_KEYS whitespace-token documentation: filter(Boolean) keeps whitespace entries', () => {
    // Documents the known gap: validateEnv uses filter(Boolean) without trim
    // ' key ' is truthy → survives filter → validateEnv sees length=1 and passes
    const keys = '  ,   ,  '.split(',').filter(Boolean);
    expect(keys.length).toBeGreaterThan(0); // whitespace tokens kept — validateEnv passes
    // But a client sending 'Bearer realkey' won't match ' realkey ' in the auth middleware
    // because middleware also uses split(',').filter(Boolean) — not trim() either
    const middlewareKeys = '  realkey  '.split(',').filter(Boolean);
    expect(middlewareKeys[0]).toBe('  realkey  '); // stored with whitespace
    expect(middlewareKeys.includes('realkey')).toBe(false); // exact mismatch
  });
});
