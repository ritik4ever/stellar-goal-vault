# Frontend Performance Notes

## Bundle Analysis

Run the bundle visualizer with:

```bash
npm run build:analyze
```

This generates `dist/bundle-analysis.html` and opens it automatically in your browser, showing a treemap of all modules, their parsed sizes, and gzip/brotli sizes.

## Top 3 Largest Modules (Baseline)

| Module | Approx. Gzipped Size | Action Taken |
|---|---|---|
| `@stellar/stellar-sdk` | ~180 KB | Code-split into `vendor-stellar` chunk via `manualChunks` |
| `recharts` | ~55 KB | Code-split into `vendor-charts` chunk via `manualChunks` |
| `react` + `react-dom` | ~45 KB | Code-split into `vendor-react` chunk via `manualChunks` |

> Sizes are approximate. Run `npm run build:analyze` for current figures.

## Code-Splitting Strategy

Three manual chunks are defined in `vite.config.ts` under `build.rollupOptions.output.manualChunks`:

- **`vendor-react`** — `react`, `react-dom`. Cached independently; rarely changes.
- **`vendor-stellar`** — `@stellar/stellar-sdk`. The largest single dependency; isolating it prevents it from invalidating the app chunk on every deploy.
- **`vendor-charts`** — `recharts`. Loaded only on screens that render charts; splitting allows the browser to defer this chunk until it is needed.

## Total Gzipped Bundle Size

| Chunk | Gzipped |
|---|---|
| `index` (app code) | ~30 KB |
| `vendor-react` | ~45 KB |
| `vendor-stellar` | ~180 KB |
| `vendor-charts` | ~55 KB |
| **Total** | **~310 KB** |

> Re-run `npm run build:analyze` after any dependency upgrade to keep this table current.

## Route-Level Code Splitting

The application is currently a single-page app without a router. If a router (e.g. React Router) is introduced in the future, wrap route components in `React.lazy()` + `<Suspense>` to get per-route splitting automatically.
