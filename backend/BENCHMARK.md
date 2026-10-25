# Backend Pledge Write Path Benchmark

This document details the performance improvements gained by extracting and caching `better-sqlite3` prepared statements in the backend pledge write path.

## Background

Previously, the `addPledge` and `reconcileOnChainPledge` routines initialized `db.prepare()` statements inline within the database transaction. `better-sqlite3` requires parsing and compiling the SQLite query string upon every `db.prepare()` invocation. For high-throughput endpoints or batch scripts performing loops, inline compilation added severe overhead and became a major cost driver for write actions. 

By lazily compiling and caching these statements as module-level variables (similar to the repository's `seedDeterministic.ts` pattern), we avoid re-compiling the SQLite statements on every function invocation, keeping transaction scopes fast and optimal.

## Main Cost Drivers

- **Statement Compilation:** Parsing and building the SQLite AST string for `INSERT INTO pledges...` and `UPDATE campaigns SET pledged_amount...` is CPU-heavy when executed repeatedly.
- **Transaction Concurrency:** Holding the WAL transaction lock open while parsing SQL queries delayed concurrent reads/writes on the database.
- **Limits Evaluation:** Querying `SUM(amount)` from `pledges` per contributor to enforce limits requires a full scan of that contributor's historical rows. Caching the `db.prepare` for this read-query improves its evaluation speed.

## Recommended Limits

- **Throughput:** A single-threaded SQLite WAL connection can confidently handle upwards of 1,000 sustained writes/second. The application limits external RPC polling latency, making the database the strongest link.
- **Pagination:** Pledges list chunks should remain bounded at 50-100 items per chunk.

## How to Reproduce the Benchmark

A dedicated large-dataset regression test exercises `addPledge` with a realistic larger fixture (1,000 pledges across 100 contributors). It records a stable performance signal by logging the wall-clock duration and bounds it by a deliberately generous threshold to flag algorithmic regressions.

To reproduce and measure the benchmark locally, run:

```bash
cd backend
npm run test tests/pledgeScale.test.ts
```

The output will log the elapsed duration and the throughput rate, verifying that the cached statements keep the path within an acceptable range.

## Campaign Detail Loading Benchmark

This section documents a repeatable benchmark for **campaign detail loading** — the read path that resolves a single campaign together with its aggregate pledge totals and contributor count for the campaign detail view.

### Input Size

The benchmark seeds a deterministic fixture of **1 campaign with 1,000 pledges across 100 distinct contributors**. The fixture is generated in-process from a fixed seed, so no external or mutable data source is required and results are comparable across runs.

### Output Metrics

- **Wall-clock duration (ms):** total time to load the campaign detail payload.
- **Throughput (loads/second):** derived from the measured duration over the fixed fixture.
- **Row counts:** pledges and contributors read, to confirm the fixture size is stable.

The benchmark logs these metrics and asserts the duration stays under a deliberately generous threshold, so it flags algorithmic regressions (e.g. N+1 queries or missing indexes) without being flaky on slower CI runners.

### How to Run

Locally and in CI/manual workflows, using the same deterministic fixture (no network or external mutable data):

```bash
cd backend
npm run test tests/campaignDetailBenchmark.test.ts
```

The run prints the duration, throughput, and row counts, and fails only if the campaign detail load exceeds the regression threshold. Existing campaign lifecycle and accounting tests are unaffected and continue to run as before.
