# Soroban Contract Benchmarks

> Baseline instruction counts for `stellar-goal-vault` entry points.
> Run `cargo test --release` for baseline, and `scripts/benchmark.sh` for
> `stellar contract invoke --cost` metrics against a local testnet.

## WASM Binary Size

Recorded: 2026-06-29
Soroban SDK version: 21.7.7
Rust toolchain: 1.96.0

### Release Profile Settings (`Cargo.toml`)

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = "symbols"
debug = 0
```

### Size Results

| Step | File | Size (bytes) | Reduction |
|------|------|-------------:|----------:|
| Baseline (`cargo build --release`) | `stellar_goal_vault.wasm` | 20 543 | — |
| After `wasm-opt -Oz` | `stellar_goal_vault_opt.wasm` | 17 805 | −2 738 (−13.3%) |

### Post-Build wasm-opt Step

```bash
wasm-opt -Oz --enable-bulk-memory \
  target/wasm32-unknown-unknown/release/stellar_goal_vault.wasm \
  -o target/wasm32-unknown-unknown/release/stellar_goal_vault_opt.wasm
```

Use `stellar_goal_vault_opt.wasm` for deployment to minimise on-chain storage fees.

---

## Methodology

1.  Build the WASM binary:
    ```
    cargo build --target wasm32-unknown-unknown --release
    ```
2.  Run unit tests with cost reporting:
    ```
    cargo test --release
    ```
3.  Deploy to a local (or test) network and invoke each entry point with
    `--cost`:
    ```
    stellar contract invoke \
      --id $CONTRACT_ID \
      --source $ACCOUNT \
      --network testnet \
      --cost \
      -- \
      <entry_point> \
      <args...>
    ```

## Baseline Metrics

Recorded: *YYYY-MM-DD*  
WASM size: 10 093 bytes  
Soroban SDK version: 21.7.7

| Entry point | CPU Instr (est.) | Ledger reads | Ledger writes | Events | Panics |
|---|---|---|---|---|---|
| `create_campaign` | ~26 000 | 1 | 2 | 1 | 5 paths |
| `contribute` | ~45 000 | 4 | 4 | 1 | 6 paths |
| `claim` | ~30 000 | 2 | 2 | 1 per token | 4 paths |
| `refund` | ~28 000 | 3 | 3 | 1 per token | 4 paths |
| `get_campaign` | ~8 000 | 1 | 0 | 0 | 1 path |
| `get_contribution` | ~7 000 | 1 | 0 | 0 | 0 |
| `get_campaign_token_balance` | ~7 000 | 1 | 0 | 0 | 0 |
| `get_contributor_count` | ~8 000 | 1 | 0 | 0 | 1 path |
| `get_next_campaign_id` | ~6 000 | 1 | 0 | 0 | 0 |
| `get_campaign_count` | ~6 000 | 1 | 0 | 0 | 0 |
| `get_version` | ~10 000 | 1 | 1 | 0 | 0 |

### Notes

- **CPU Instr.** are approximate values obtained from test-harness CPU metering
  (soroban-env-host `budget`). Actual on-ledger costs may vary.
- All **% change** comparisons should use the same test harness version.
- A delta **>10%** in either direction must be reviewed before merging.

## Refund Path Benchmark (`refund` / `refund_all`)

A repeatable, offline benchmark of the refund path. It deploys the **release
WASM** in the Soroban test host (so VM instantiation and Wasm execution are
metered, unlike the native test build) and reads each invocation's resources
from `env.cost_estimate()`. No network, account, or contract ID is needed, and
the host cost model is deterministic: the same contract build and SDK version
always produce the same numbers.

```bash
scripts/bench-refund.sh                    # compare against the baseline
scripts/bench-refund.sh --update-baseline  # accept the new numbers
```

- Scenarios and measurement live in [`src/bench_refund.rs`](./src/bench_refund.rs)
  (an `#[ignore]`d test, so `cargo test` does not run it).
- The committed baseline is [`benchmarks/refund-costs.tsv`](./benchmarks/refund-costs.tsv).
  The current run is written to `target/bench/refund-costs.tsv` (git-ignored).
- The run fails if any metric grows by more than **10%**, or if
  `refund_all_max_contributors` drops by more than 10%. When a change is
  intentional, rerun with `--update-baseline` and commit the TSV with the change
  so reviewers see the cost difference in the diff.
- Every campaign pledges 100 stroops per contributor per token and ends
  underfunded. `refund_all_max_contributors` is the largest number of
  single-token contributors `refund_all` can refund in one transaction under the
  mainnet limits the test host enforces (found by bisection).
- The `fee_stroops` column comes from the SDK's built-in mainnet fee snapshot
  and includes rent, so treat it as an estimate.

### Results

Recorded: 2026-10-20 · soroban-sdk 28.0.0 · release WASM 25 816 bytes (`stellar contract build`)

| Scenario | CPU instr | Mem bytes | Write entries | Write bytes | Event bytes | Fee (stroops) |
|---|---:|---:|---:|---:|---:|---:|
| `refund`, 1 token | 992 284 | 1 286 847 | 6 | 1 468 | 784 | 2 224 366 |
| `refund`, 3 tokens | 1 784 002 | 1 386 258 | 14 | 3 180 | 1 808 | 2 263 887 |
| `refund`, 10 tokens | 5 404 484 | 1 962 414 | 42 | 9 172 | 5 392 | 2 402 806 |
| `refund_all`, 1 contributor × 1 token | 1 068 504 | 1 288 669 | 6 | 1 468 | 768 | 2 224 340 |
| `refund_all`, 10 × 1 | 5 187 781 | 1 814 521 | 24 | 5 284 | 5 376 | 2 326 119 |
| `refund_all`, 25 × 1 | 14 648 822 | 3 461 341 | 54 | 11 644 | 13 056 | 2 497 566 |
| `refund_all`, 10 × 3 | 17 263 832 | 3 927 646 | 68 | 14 628 | 15 616 | 2 571 328 |

**`refund_all` capacity: 31 single-token contributors per transaction.**

### High-cost operation: `refund_all` is capped by the event-size limit

`refund_all` refunds every contributor in a single all-or-nothing call, and its
cost grows linearly with contributors × tokens. Each refunded (contributor,
token) pair adds about **512 bytes** of contract events: the vault's
`("Goal", "Refund")` event plus the token contract's `transfer` event. The
mainnet limit is **16 384 bytes of events per transaction**, which makes it the
binding limit. CPU stays far below its limit: about 15M of the 100M
instructions at 31 contributors.

- At 32 single-token contributors the call is rejected with
  `contract events size bytes: 16640 > 16384`.
- With 3 tokens per contributor, 10 contributors already use 15 616 of the
  16 384 bytes, so the practical ceiling is about `31 / tokens` contributors.
- Because the call has no pagination, a campaign beyond that size can **never**
  be closed out with `refund_all`. Contributors are not stuck: each can still
  call `refund`, which costs a fixed ~1M instructions per token no matter how
  large the campaign is. Admin tooling should not rely on `refund_all` for
  large campaigns. A paginated variant (for example
  `refund_batch(campaign_id, start, limit)`) would remove the cap.

---

## Instructions to Re-baseline

```bash
# 1. Build release WASM
cd contracts && cargo build --target wasm32-unknown-unknown --release

# 2. Deploy (pick one network)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_goal_vault.wasm \
  --source $ACCOUNT \
  --network testnet

# 3. Invoke each entry point with --cost (see CI scripts/benchmark.sh)
scripts/benchmark.sh
```

See also:
- [CI workflow](../.github/workflows/contracts-ci.yml) — runs benchmark on
  every PR modifying `contracts/`.
- [`scripts/benchmark.sh`](../scripts/benchmark.sh) — compares current cost to
  baseline.