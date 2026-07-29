import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const isAnalyze = process.env.ANALYZE === 'true';

import crypto from 'crypto';

/**
 * Custom Vite plugin that sets Content-Security-Policy header during development.
 * It generates a unique nonce per request for inline scripts.
 * In production build, it injects a placeholder for the nonce that Nginx replaces.
 */
function cspPlugin(): Plugin {
  return {
    name: 'csp-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const nonce = crypto.randomBytes(16).toString('base64');
        (req as any).cspNonce = nonce;
        
        const scriptSrc = "'self' 'nonce-" + nonce + "' 'strict-dynamic'";
        const connectSrc = "'self' https://soroban-testnet.stellar.org ws: wss:";
        
        const directives = [
          "default-src 'none'",
          `script-src ${scriptSrc}`,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' https: data:",
          `connect-src ${connectSrc}`,
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "report-uri /api/csp-report"
        ].join('; ');
        
        res.setHeader('Content-Security-Policy', directives);
        next();
      });
    },
    transformIndexHtml(html, ctx) {
      const nonce = (ctx.req as any)?.cspNonce || '__CSP_NONCE__';
      return html.replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`);
    },
  };
}

export default defineConfig(async () => {
  const plugins = [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      manifest: {
        name: 'Stellar Goal Vault',
        short_name: 'Goal Vault',
        description: 'Campaign management and funding dashboard for Stellar',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.ico',
            sizes: '64x64 32x32 24x24 16x16',
            type: 'image/x-icon',
          },
        ],
      },
    }),
  ];

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
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const requestId = req.headers['x-request-id'];
              if (typeof requestId === 'string' && requestId.trim().length > 0) {
                proxyReq.setHeader('X-Request-ID', requestId);
              }
            });
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.ts',
    },
  };
});

