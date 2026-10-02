import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.integration.ts'],
    exclude: ['node_modules', 'dist'],
    threads: true,
    maxThreads: 1,
    minThreads: 1,
    isolate: true,
    globals: true,
    testTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      // text + text-summary keep CI logs readable; lcov/html/json are uploaded as artifacts
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['node_modules/', 'tests/', 'dist/'],
      // Preserve the repository's existing line-coverage gate (do not weaken).
      thresholds: {
        lines: 80,
      },
    },
  },
});
