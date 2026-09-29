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
