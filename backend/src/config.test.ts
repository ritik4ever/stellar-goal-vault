import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the documented CORS origin configuration.
 *
 * `ALLOWED_ORIGINS` is the variable documented in `.env.example` and
 * `docs/SECURE_CONFIGURATION.md`; `CORS_ALLOWED_ORIGINS` is accepted as a
 * backwards-compatible alias. An empty/unset value means "no explicit
 * allow-list" (development allows all; production rejects unknown origins).
 */

async function loadConfig() {
  vi.resetModules();
  return import('./config');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('config.corsAllowedOrigins', () => {
  it('reads ALLOWED_ORIGINS and splits/trims the list', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', ' https://a.example , https://b.example ');
    const { config } = await loadConfig();
    expect(config.corsAllowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('falls back to the CORS_ALLOWED_ORIGINS alias', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', '');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://legacy.example');
    const { config } = await loadConfig();
    expect(config.corsAllowedOrigins).toEqual(['https://legacy.example']);
  });

  it('defaults to an empty allow-list when neither variable is set', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', '');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    const { config } = await loadConfig();
    expect(config.corsAllowedOrigins).toEqual([]);
  });

  it('preserves a wildcard so local development can opt into all origins', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', '*');
    const { config } = await loadConfig();
    expect(config.corsAllowedOrigins).toEqual(['*']);
  });
});
