import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.integration.ts"],
    exclude: ["node_modules", "dist"],
    threads: true,
    maxThreads: 4,
    minThreads: 1,
    isolate: true,
    globals: true,
    testTimeout: 30000,
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "tests/", "dist/"],
      thresholds: {
        lines: 80,
      },
    },
  },
});
