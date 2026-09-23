# Frontend Performance Notes

## How to Reproduce the Benchmark

Run the bundle visualizer with:

```bash
npm run build:analyze
```

This generates `dist/bundle-analysis.html` and opens it automatically in your browser, showing a treemap of all modules, their parsed sizes, and gzip/brotli sizes. This is the primary method for contributors to measure before/after changes to the bundle size.

## Main Cost Drivers (Baseline)

| Module | Approx. Gzipped Size | Cost Driver Reason |
|---|---|---|
| `@stellar/stellar-sdk` and other wallet APIs | ~200 KB | Contains large cryptographic and network logic. |
| `lucide-react` | ~50 KB | Contains many SVG icons. |
| `recharts` | ~55 KB | Large charting and data visualization library. |
| `react` + `react-dom` + `react-router-dom` | ~50 KB | Core framework dependencies. |

> Sizes are approximate. Run `npm run build:analyze` for current figures.

## Recommended Limits

- **Main application chunk (`index`)**: We recommend keeping the main application chunk under **600 KB** (uncompressed) to avoid Vite's chunk size warning (`chunkSizeWarningLimit: 600` is configured in `vite.config.mts`).
- **Vendor chunks**: Should be split aggressively to leverage browser caching. Avoid letting any single vendor chunk exceed **500 KB** gzipped if possible.

## Code-Splitting Strategy

Four manual chunks are defined in `vite.config.ts` under `build.rollupOptions.output.manualChunks`:

- **`vendor-react`** — `react`, `react-dom`, `react-router-dom`. Cached independently; rarely changes.
- **`vendor-stellar`** — `@stellar/stellar-sdk`, `@stellar/freighter-api`, `@lobstrco/signer-extension-api`, `@creit.tech/xbull-wallet-connect`. The largest dependencies; isolating them prevents invalidating the app chunk on every deploy.
- **`vendor-charts`** — `recharts`. Loaded only on screens that render charts; splitting allows the browser to defer this chunk.
- **`vendor-ui`** — `lucide-react`. Contains UI icons and components that are frequently updated but can be cached separately.

## Total Gzipped Bundle Size

| Chunk | Gzipped |
|---|---|
| `index` (app code) | ~30 KB |
| `vendor-react` | ~50 KB |
| `vendor-stellar` | ~200 KB |
| `vendor-charts` | ~55 KB |
| `vendor-ui` | ~50 KB |
| **Total** | **~385 KB** |

> Re-run `npm run build:analyze` after any dependency upgrade to keep this table current.

## Route-Level Code Splitting

If route-level code splitting is required, wrap route components in `React.lazy()` + `<Suspense>` to get per-route splitting automatically.
