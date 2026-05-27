import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isAnalyze = process.env.ANALYZE === "true";
const apiProxyTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:3001";

export default defineConfig(async () => {
  const plugins = [react()];

  if (isAnalyze) {
    const { visualizer } = await import("rollup-plugin-visualizer");
    plugins.push(
      visualizer({
        open: true,
        filename: "dist/bundle-analysis.html",
        gzipSize: true,
        brotliSize: true,
        template: "treemap",
      }),
    );
  }

  return {
    plugins,
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom"],
            "vendor-stellar": ["@stellar/stellar-sdk"],
            "vendor-charts": ["recharts"],
          },
        },
      },
    },
    server: {
      port: 3000,
      proxy: {
        "/api": apiProxyTarget,
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test-setup.ts",
    },
  };
});
