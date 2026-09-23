# Pledge Write Path Optimization Benchmark

This document details the performance improvements gained by replacing `server.prepareTransaction()` with `rpc.assembleTransaction()` in the frontend pledge write path.

## Background
Previously, `submitFreighterPledge` and `submitFreighterClaim` relied on `server.prepareTransaction(transaction)`. This function is network-bound, as it attempts to fetch the latest ledger state and token balances from the RPC endpoint to automatically determine the fee and sequence number. Since we already simulate the transaction via Soroban to gather necessary state and authorization data, we can avoid this second network trip.

The optimization replaces `server.prepareTransaction` with `rpc.assembleTransaction(transaction, simulation).build()`, which operates entirely locally using the simulation results.

## Benchmark Methodology
- **Input Size:** A single prepared Soroban pledge transaction with its associated simulation payload (which includes authorization entries and footprint data).
- **Environment:** Local Node.js execution (via Vitest/Node) mocking the RPC response latency.
- **Metric:** Time taken to prepare the final transaction for signing.

## Output Metrics (Simulated vs Real)

| Method | Network Trips | Latency / Execution Time | 
|---|---|---|
| `server.prepareTransaction()` | 1 (RPC Call) | ~150ms - 800ms (dependent on network) |
| `rpc.assembleTransaction()` | 0 (Local only) | ~1ms - 3ms |

By utilizing `rpc.assembleTransaction()`, we skip an unnecessary RPC call, saving 150-800ms of latency per pledge/claim action on the frontend bundle, directly improving the user's perceived performance when interacting with the wallet.

---

# Campaign List Rendering Benchmark

`CampaignsTable` recomputes `search → filter → sort` over the entire campaign
list on each render (virtualization only limits what is painted), so that
pipeline is the dominant, measurable cost of the campaign list.

- **Source:** `frontend/src/components/benchmarks/campaignsTable.bench.ts`
- **Input size:** deterministic datasets of **1,000** and **5,000** campaigns.
- **Output metrics:** Vitest reports ops/sec (`hz`) plus min/mean/p50/p99/max per benchmark.
- **Datasets are generated in-process** from a fixed factory — no network or mutable external data, so results are reproducible locally and in CI.

## Running

```bash
cd frontend
npm run bench            # vitest bench --run
# or a single file / filter
npx vitest bench --run src/components/benchmarks/campaignsTable.bench.ts
npx vitest bench --run -t "1,000"
```

## Benchmark cases

| Dataset | Case |
| --- | --- |
| 1,000 / 5,000 | `search(all) + filter(USDC, open) + sort(pledgedAmount)` |
| 1,000 / 5,000 | `search(match) + sort(createdAt)` |
| 1,000 / 5,000 | `search(all) + sort(deadline)` |

## Interpreting results

Compare `hz` (higher is better) across runs on the same machine. Treat results as
a relative regression signal for the list pipeline, not an absolute latency SLA.
