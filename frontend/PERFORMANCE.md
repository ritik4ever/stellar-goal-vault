# Frontend Performance Notes

## How to Reproduce the Benchmark

Run the bundle visualizer with:

```bash
npm run build:analyze
```

This generates `dist/bundle-analysis.html` and opens it automatically in your browser, showing a treemap of all modules, their parsed sizes, and gzip/brotli sizes. This is the primary method for contributors to measure before/after changes to the bundle size.

Run the pipeline micro-benchmarks with:

```bash
npm run bench
```

This executes `vitest bench --run` against the deterministic 1k / 5k / 10k campaign datasets and prints ops/sec plus min/mean/percentile statistics. No network access is needed — all data is generated in-process from a fixed seed.

## Main Cost Drivers (Baseline)

| Module | Approx. Gzipped Size | Cost Driver Reason |
|---|---|---|
| `@stellar/stellar-sdk` and other wallet APIs | ~200 KB | Contains large cryptographic and network logic. |
| `lucide-react` | ~50 KB | Contains many SVG icons. |
| `recharts` | ~55 KB | Large charting and data visualization library. |
| `react` + `react-dom` + `react-router-dom` | ~50 KB | Core framework dependencies. |
| `react-markdown` | ~15 KB | Markdown parser + remark/rehype plugin tree. |

> Sizes are approximate. Run `npm run build:analyze` for current figures.

## Recommended Limits

- **Main application chunk (`index`)**: We recommend keeping the main application chunk under **600 KB** (uncompressed) to avoid Vite's chunk size warning (`chunkSizeWarningLimit: 600` is configured in `vite.config.mts`).
- **Vendor chunks**: Should be split aggressively to leverage browser caching. Avoid letting any single vendor chunk exceed **500 KB** gzipped if possible.

## Code-Splitting Strategy

### Manual vendor chunks

Five manual chunks are defined in `vite.config.mts` under `build.rollupOptions.output.manualChunks`:

| Chunk | Contents | Rationale |
|---|---|---|
| `vendor-react` | `react`, `react-dom`, `react-router-dom` | Core framework; cached independently, changes rarely. |
| `vendor-stellar` | `@stellar/stellar-sdk`, `@stellar/freighter-api`, `@lobstrco/signer-extension-api`, `@creit.tech/xbull-wallet-connect` | Largest dependency group; isolating prevents invalidating the app chunk on every deploy. |
| `vendor-charts` | `recharts` | Loaded only on screens that render charts; deferred by the browser on first visit. |
| `vendor-ui` | `lucide-react` | Icon library; frequently updated but cached separately from app logic. |
| `vendor-markdown` | `react-markdown` | Markdown parser + remark/rehype tree; only needed inside `CampaignDetailPanel`, which is already lazy-loaded. Isolating it keeps `vendor-react` stable and avoids pulling the parser into the initial bundle. |

### Route-level and component-level lazy loading

The following components are loaded lazily via `React.lazy()` + `<Suspense>`, meaning their JS is only fetched after the main shell has painted:

| Component | Lazy since | Fallback |
|---|---|---|
| `App` (main route) | initial | `<div className="app-shell" aria-busy="true">` |
| `ContributorProfile` | initial | same shell fallback |
| `NotFoundPage` | initial | same shell fallback |
| `CreatorAnalytics` | initial | `<SkeletonAnalytics />` |
| `CampaignDetailPanel` | this change | inline detail-panel skeleton |
| `CreateCampaignForm` | this change | inline wizard-card skeleton |

`CampaignDetailPanel` and `CreateCampaignForm` are the two heaviest below-the-fold panels. Moving them to lazy imports means the campaign board table and metrics render without waiting for the form wizard or the Soroban pledge flow to parse.

## Total Gzipped Bundle Size

| Chunk | Gzipped |
|---|---|
| `index` (app code) | ~30 KB |
| `vendor-react` | ~50 KB |
| `vendor-stellar` | ~200 KB |
| `vendor-charts` | ~55 KB |
| `vendor-ui` | ~50 KB |
| `vendor-markdown` | ~15 KB |
| **Total** | **~400 KB** |

> Re-run `npm run build:analyze` after any dependency upgrade to keep this table current.

## Pipeline Correctness and Performance Tests

The campaign list pipeline (`searchCampaigns → applyFilters → sortCampaigns`) is exercised at multiple scales:

| File | Kind | Datasets |
|---|---|---|
| `src/components/benchmarks/campaignsTable.bench.ts` | `vitest bench` (ops/sec) | 1k, 5k, **10k** |
| `src/components/benchmarks/campaignPipelineScale.test.ts` | `vitest test` (correctness) | **10k** |

### Benchmark scenarios (per dataset size)

| Scenario | What it measures |
|---|---|
| `search(all) + filter(USDC, open) + sort(pledgedAmount)` | Typical interactive path: no-op search, two-axis filter, numeric sort. |
| `search(match) + sort(createdAt)` | Title substring match narrowing to a small result set, then date sort. |
| `search(all) + sort(deadline)` | Full-dataset ascending sort — measures raw sort throughput. |
| `filter(all statuses) + sort(targetAmount)` | No-op filter (both axes empty) + full-pass numeric sort. |
| `search(no-match) + filter(EURC, funded) + sort(pledgedAmount)` | Worst-case linear scan with no early exit, then empty result sort. |

### Correctness invariants (10k fixture)

All assertions in `campaignPipelineScale.test.ts` are **cardinality or ordering invariants** computed analytically from the deterministic fixture formula — not micro-timing assertions — so they pass on any hardware without flakiness:

- `searchCampaigns('', …)` returns the exact same array reference (fast path, no copy).
- Asset-filter cardinality matches the expected `ceil(10000 / 3)` count for USDC.
- Status-filter cardinality matches the expected `10000 / 4` count for `open`.
- Combined USDC+open filter uses AND logic and matches `countWhere(i => i%3===0 && i%4===0)`.
- All sort orders (`createdAt` desc, `deadline` asc, `pledgedAmount` desc, `targetAmount` desc) produce fully-ordered output across all 10k rows.
- Full pipeline composition result is a strict subset of the input and satisfies all predicate + ordering constraints simultaneously.
- No utility function mutates its input array.
