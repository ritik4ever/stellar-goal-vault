import { defineConfig } from 'vitest/config';

/**
 * CI-friendly, parallel-safe Vitest config for the API integration suite.
 *
 * Isolation levers (safe under file-parallel forks / CI matrix jobs):
 * - `pool: 'forks'` so each file gets independent module + SQLite state.
 * - Per-worker temp DB paths (see tests/*) — never a shared /tmp fixed path.
 * - Coverage + fork counts come from env so concurrent CI jobs do not collide.
 */
const MAX_FORKS = process.env.VITEST_INTEGRATION_MAX_FORKS
  ? Number(process.env.VITEST_INTEGRATION_MAX_FORKS)
  : process.env.CI
    ? 2
    : undefined;

const COVERAGE_DIR =
  process.env.VITEST_INTEGRATION_COVERAGE_DIR || './coverage-integration';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.integration.ts'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    isolate: true,
    fileParallelism: true,
    ...(MAX_FORKS ? { maxForks: MAX_FORKS, minForks: 1 } : {}),
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ['verbose', 'github-actions'] : ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: COVERAGE_DIR,
      exclude: ['node_modules/', 'tests/', 'dist/'],
    },
  },
});
