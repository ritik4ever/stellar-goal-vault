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
    hookTimeout: 30000,
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "tests/",
        "dist/",
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/scripts/**",
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});
