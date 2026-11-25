import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    // Forked workers get independent jsdom, storage, timers, and module state.
    // This keeps CI file-parallel execution from sharing mutable browser state.
    pool: 'forks',
    isolate: true,
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
