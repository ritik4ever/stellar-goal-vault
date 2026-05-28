import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use node environment
    environment: "node",

    // Test file discovery patterns
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.integration.ts"],
    exclude: ["node_modules", "dist"],

    // Parallelism configuration
    // Run tests in parallel threads to maximize performance
    threads: true,
    maxThreads: 4,
    minThreads: 1,

    // Isolate tests per thread to prevent cross-test pollution
    isolate: true,

    // Globals - don't need to import describe/it/expect
    globals: true,

    // Test timeout
    testTimeout: 30000,

    // Reporter
    reporters: ["verbose"],

    // Coverage (optional)
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "tests/",
        "dist/",
        "src/index.ts",
        "src/middleware/**",
        "src/services/eventIndexer.ts",
        "src/services/sorobanRpc.ts",
        "src/validateEnv.ts",
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});
