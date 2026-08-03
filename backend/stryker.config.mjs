/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',

  // Use the Vitest runner (compatible with vitest ^1.x)
  testRunner: 'vitest',

  // Vitest runner config
  vitest: {
    configFile: 'vitest.config.ts',
  },

  // Only mutate the two critical service files
  mutate: [
    'src/services/campaignStore.ts',
    'src/services/eventHistory.ts',
  ],

  // Reporters
  reporters: ['html', 'clear-text', 'progress', 'json'],

  // Output directory for HTML report
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },

  // JSON report for CI consumption
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },

  // Minimum acceptable mutation score (in percent)
  thresholds: {
    high: 80,
    low: 70,
    break: 65,
  },

  // Concurrency: keep low to avoid SQLite file contention across test workers
  concurrency: 2,

  // Timeout settings (ms)
  timeoutMS: 60000,
  timeoutFactor: 2,
};
