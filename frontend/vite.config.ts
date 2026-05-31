import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isAnalyze = process.env.ANALYZE === 'true';

export default defineConfig(async () => {
  const plugins = [react()];

  if (isAnalyze) {
    const { visualizer } = await import('rollup-plugin-visualizer');
    plugins.push(
      visualizer({
        open: true,
        filename: 'dist/bundle-analysis.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }) as any
    );
  }

  return {
    plugins,
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-stellar': ['@stellar/stellar-sdk'],
            'vendor-charts': ['recharts'],
          },
        },
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.ts',
    },
  };
});