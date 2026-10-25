# Pledge Write Path Benchmark

This document describes the repeatable benchmark for the pledge write path introduced in issue [#1003](https://github.com/ritik4ever/stellar-goal-vault/issues/1003).

---

## Overview

The pledge write path benchmark isolates and measures `POST /api/campaigns/:id/pledges` — the SQLite transaction that inserts a pledge row, increments `pledged_amount`, and records a lifecycle event.  It runs in **two modes** so it can be used both for quick local iteration and for CI-level regression detection.

| Mode | Script | Requires live server | Use case |
|---|---|---|---|
| In-process micro-bench | `npm run bench` | No | Local iteration, CI artifact |
| HTTP throughput bench | `npm run bench:pledge` | Yes | Load profile, latency p99 |

---

## Documented input size

The canonical input size is fixed in the scripts and must be updated here whenever it changes intentionally.

| Parameter | Default | Notes |
|---|---|---|
| Campaigns | 4 | Seeded fresh before each run |
| Batch size (in-process) | 50 pledges / campaign | 200 total per iteration |
| Concurrent connections (HTTP) | 10 | Overridable via `--connections` |
| Duration (HTTP) | 15 s | Overridable via `--duration` |
| Pledge amount | 5 USDC | Constant per request |
| Campaign target amount | 10 000 000 USDC | Large enough the funding cap is never hit |

---

## Running locally

### In-process benchmark (no live server needed)

```bash
cd backend
npm run bench
```

This starts an isolated in-memory SQLite database, seeds 4 campaigns, then runs three bench variants:

- **sequential** — pledges one at a time, round-robin across campaigns
- **concurrent** — all pledges fired as parallel `Promise.all()`
- **single-campaign burst** — all pledges directed at one campaign (tests lock contention)

Vitest reports operations/second and average duration for each variant.

### HTTP benchmark (requires a running backend)

1. Start the backend in one terminal:

```bash
cd backend
npm run dev
```

2. In a second terminal, run the benchmark:

```bash
cd backend
npm run bench:pledge
```

With custom settings:

```bash
node backend/scripts/pledge-write-benchmark.js \
  --connections 20 \
  --duration 30 \
  --campaigns 8
```

Available flags:

| Flag | Default | Description |
|---|---|---|
| `--base-url` | `http://127.0.0.1:3001` | Backend URL |
| `--connections` | `10` | Concurrent connections |
| `--duration` | `15` | Duration in seconds |
| `--timeout` | `10` | Request timeout in seconds |
| `--campaigns` | `4` | Seed campaigns |
| `--pledge-amount` | `5` | Amount per pledge (USDC) |
| `--target-amount` | `10000000` | Campaign target |
| `--asset-code` | `USDC` | Asset code |
| `--deadline-hours` | `24` | Hours until campaign deadline |

---

## Output metrics

The HTTP script prints:

- Latency percentiles: **p50, p90, p97.5, p99, max** (ms)
- Request totals: total, 2xx, non-2xx, errors, timeouts
- Error rate (%)
- Average requests / second
- Average throughput (KiB/s)
- Threshold evaluation (see thresholds below)
- Machine-parseable JSON block delimited by `---JSON-START--- / ---JSON-END---`

---

## Thresholds (CI)

| Metric | Threshold |
|---|---|
| p99 latency | ≤ 500 ms |
| Error rate | ≤ 1 % |

These are enforced in the CI workflow and in the HTTP script's exit code.  The in-process bench is advisory — it does not fail the workflow but its output is uploaded as an artifact for trend analysis.

---

## CI / manual workflow

The benchmark is available as a **manual GitHub Actions workflow** and runs on a weekly schedule:

- **Trigger:** `workflow_dispatch` or `schedule: cron 30 6 * * 1` (Monday 06:30 UTC)
- **Workflow file:** `.github/workflows/pledge-write-benchmark.yml`
- **Artifacts:** `pledge-bench-in-process` (Vitest output) and `pledge-bench-http` (HTTP benchmark output)

To trigger manually from the Actions tab, select **Pledge Write Path Benchmark** and optionally override `connections` and `duration`.

Both jobs run against a fresh in-memory SQLite backend started inside the runner — no external services or secrets are required.

---

## Reproducibility guarantees

- All campaigns and contributor addresses are generated deterministically from fixed seeds — no random data.
- The campaign target amount is set high enough that the funding cap is never hit across runs.
- No `maxPerContributor` limit is set on benchmark campaigns, so the per-contributor check never fires.
- The in-memory SQLite database is torn down after each run, leaving no files on disk.
- The HTTP benchmark seeds its own campaigns at run start, ensuring isolation from production or development data.

---

## Related files

| File | Purpose |
|---|---|
| `backend/scripts/pledge-write-benchmark.js` | HTTP benchmark script (autocannon) |
| `backend/src/services/__tests__/pledgeWritePath.bench.ts` | In-process Vitest bench |
| `.github/workflows/pledge-write-benchmark.yml` | CI workflow |
| `docs/LOAD_TESTING.md` | General load testing guide |
