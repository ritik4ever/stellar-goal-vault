# Campaign Detail Loading Performance

This document records the cost drivers of **campaign detail loading** — what
happens between clicking a campaign on the board and the detail panel showing its
pledge history — how to reproduce the benchmark that measures it, and the limits
we recommend keeping it inside.

The CPU-side work is measured by `src/components/benchmarks/campaignDetail.bench.ts`
and pinned by `src/components/benchmarks/campaignDetailPipeline.test.ts`. Both use
deterministic in-process fixtures, so they need no network and no database.

## What happens when a campaign is opened

The board response is the fast path: it already carries every field the detail
panel needs for its header, so the panel paints immediately from the summary row
and is upgraded in place. Selecting a campaign then runs
`App.refreshSelectedData`, which issues two requests in parallel:

| Step | Where | Kind | Cost |
|---|---|---|---|
| 1. Summary row already on the board | `App.selectedCampaign` | in-memory | negligible |
| 2. Campaign detail (`GET /campaigns/:id`) | `services/api.getCampaign` | network | round trip + payload (includes `pledges`) |
| 3. First history page (`GET /campaigns/:id/history?page=1&pageSize=20`) | `services/api.getCampaignHistoryPage` | network | round trip + 20 events |
| 4. Order the returned page | `lib/campaignDetailLoading.sortHistoryEvents` | CPU | `O(P log P)`, `P = 20` |
| 5. Merge the fetched detail over the summary | `lib/campaignDetailLoading.mergeCampaignDetail` | CPU | `O(1)` shallow spread |
| 6. "Load more" history pages, on demand | `lib/campaignDetailLoading.mergeHistoryPages` | CPU + network | `O((W + P) log(W + P))`, `W` = events already loaded |

Steps 2 and 3 are already overlapped with `Promise.all`, so the panel waits for
the slower of the two rather than for their sum. The remaining, avoidable cost is
step 6: it re-sorts the whole loaded window on every page, so it grows with how
far the reader has scrolled.

## Main cost drivers

| Driver | Where | Complexity | Notes |
|---|---|---|---|
| Two detail requests | `App.refreshSelectedData` | network-bound | Dominant in wall-clock terms and out of the browser's control. Already parallel; a slow backend, not a slow client, is what makes the panel feel slow. |
| History page re-sort | `mergeHistoryPages` → `sortHistoryEvents` | `O((W + P) log(W + P))` | The only super-linear client cost. Re-runs over the full loaded window on every "load more" because concurrent writes can backfill events that sort *before* the newest loaded one. |
| Per-page order check | `sortHistoryEvents` | `O(P log P)` | Cheap and bounded: pages are 20 events, and an already-ordered page is close to a linear scan. |
| Summary/detail fold | `mergeCampaignDetail` | `O(1)` | Shallow spread. `pledges` is adopted **by reference** (never copied) and `metadata` falls back to the summary, so this cost does not depend on pledge count. |
| Panel render, icon set, markdown | `CampaignDetailPanel`, `ContributorSummary` | render-bound | Code-split and bundle costs are covered in `PERFORMANCE.md`; `ContributorSummary` is lazy so its parser is not part of the first detail paint. |

### Indicative figures

Measured by running the benchmark in this repository (Node 24, Apple Silicon) —
use them as a shape, not as an SLA, and re-measure on your own machine:

| Case | Throughput | Mean per call |
|---|---|---|
| `sortHistoryEvents` (20-event page) | ~1.2M ops/s | ~0.8 µs |
| `mergeHistoryPages`, 20 events loaded | ~234k ops/s | ~4.3 µs |
| `mergeHistoryPages`, 200 events loaded | ~74k ops/s | ~13.6 µs |
| `mergeHistoryPages`, 2,000 events loaded | ~7.3k ops/s | ~136 µs |
| `mergeCampaignDetail` (0 / 100 / 1,000 pledges) | ~6.3–8.0M ops/s | ~0.13–0.16 µs |

Two things to read out of this table: the merge cost is flat in the number of
pledges (the reference pass-through works), and it grows with the loaded history
window — roughly 30× slower at 2,000 loaded events than at 20.

## Recommended limits

| Limit | Value | Where it is enforced | Why |
|---|---|---|---|
| History page size | **20** (`HISTORY_PAGE_SIZE`) | `lib/campaignDetailLoading.ts`, requested by `App.refreshHistory` / `loadMoreHistory` | Keeps each "load more" merge bounded and the first history paint small. Raising it multiplies `P` in the `n log n` merge on every page. |
| Loaded history window | **≤ 2,000 events** (≈100 pages) | client convention, guarded by this benchmark | At 2,000 loaded events a merge costs ~0.14 ms — still a fraction of a frame. Past that, re-sorting the whole window on each page becomes the largest client cost in the panel. |
| Detail payload | passed by reference, no client limit | `mergeCampaignDetail` | The merge does not copy `pledges`, so a large detail payload only costs bandwidth and render time. |
| Campaign list page size | **20** (`CAMPAIGN_PAGE_SIZE`) | `App.tsx` | Bounds the board page that seeds the summary row. |
| Restored list pages | **3** | `App.bootstrap` (bounded restored state) | Caps how much the board refetches from `sessionStorage` before the detail request is allowed to start. |

## How to reproduce the benchmark

From the `frontend` directory:

```bash
# Whole suite: every *.bench.ts file, including the campaign-detail pipeline.
npm run bench

# Only the campaign-detail pipeline.
npx vitest bench --run src/components/benchmarks/campaignDetail.bench.ts

# A single dataset size or case (substring match on the bench name).
npx vitest bench --run src/components/benchmarks/campaignDetail.bench.ts -t "2,000"
```

The correctness-at-scale suite runs under the normal test command:

```bash
npx vitest run src/components/benchmarks/campaignDetailPipeline.test.ts
npx vitest run src/lib/campaignDetailLoading.test.ts
```

`vitest bench` prints `hz` (ops/sec, higher is better) plus min/mean/p50/p99/max
per case. No network or database is required: the fixtures are generated from a
deterministic formula, with one shared ledger close time per 20 events so the
`id` tie-break in the sort is exercised.

## Measuring before/after a change

1. Run `npx vitest bench --run src/components/benchmarks/campaignDetail.bench.ts`
   on the base commit and save the output.
2. Apply your change and run the same command on the **same machine**, with no
   other heavy processes running.
3. Compare `hz` per case — not the absolute numbers. A regression is a drop in
   `hz` for a case your change touches; the benchmark is a relative signal.
4. If you change an ordering or de-duplication rule, also run
   `campaignDetailPipeline.test.ts`: it asserts the invariants (total order,
   union cardinality, input immutability) analytically, so it stays green on any
   hardware while the benchmark tells you what the change costs.

The network half of the pipeline (steps 2 and 3 above) cannot be measured
offline. To measure end to end, use the browser's Network panel or
`npm run build:analyze` for bundle impact, and the repository benchmark scripts
(`scripts/benchmark.sh`) for a running stack.
