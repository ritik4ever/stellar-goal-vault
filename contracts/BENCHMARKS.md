# Soroban Contract Benchmarks

> Baseline instruction counts for `stellar-goal-vault` entry points.
> Run `cargo test --release` for baseline, and `scripts/benchmark.sh` for
> `stellar contract invoke --cost` metrics against a local testnet.

## Pledge Path Resource Benchmark (repeatable, offline)

`scripts/bench-pledge.sh` measures the pledge path (`create_campaign`,
`contribute`, `claim`, `refund`, `refund_all`) in the Soroban test host. It
needs no network, account or secret. Host metering is deterministic, so the
same code and SDK give the same numbers on every machine. That means two
results can be compared exactly, without noise margins.

```bash
scripts/bench-pledge.sh                    # build WASM, measure, compare to baseline
scripts/bench-pledge.sh --update-baseline  # accept the new numbers (commit the TSV)
scripts/bench-pledge.sh --native           # quick run without the WASM build (not comparable)
scripts/bench-pledge.sh --threshold 5      # stricter regression gate (default 10%)
```

* Scenarios live in [`src/test_pledge_bench.rs`](./src/test_pledge_bench.rs).
  Each one sets up state, then meters exactly one call with
  `env.cost_estimate()`.
* The baseline is [`benchmarks/pledge_baseline.tsv`](./benchmarks/pledge_baseline.tsv).
  The current run is written to `target/bench/pledge_current.tsv`, which is
  git-ignored.
* The script exits `1` if any metric (or the WASM size) grows by more than
  the threshold, or if a baseline scenario disappears. If a change raises
  costs on purpose, rerun with `--update-baseline` and commit the TSV in the
  same PR, so reviewers see the diff.
* `wasm` mode (the default) registers the release binary built by
  `stellar contract build`, so VM costs are included. soroban-sdk 28 no
  longer builds through plain `cargo build --target ...`. `native` mode
  under-counts instructions and memory, and the script skips its
  comparisons.
* The SDK's mainnet per-transaction limits (snapshot 2026-07-10) are
  enforced on every metered call. A scenario that would fail on mainnet
  fails the run.

### Results

Recorded: 2026-10-19 · soroban-sdk 28.0.0 · stellar-cli 27.0.0 ·
WASM 25 239 bytes (`stellar contract build`, optimized from 30 594).
`fee` is the SDK's mainnet fee estimate in stroops. It includes rent for
newly created entries, which is why a first pledge to a fresh campaign
costs more than later ones.

| Scenario | CPU instr | Mem bytes | Reads | Writes | Write bytes | Event bytes | Fee (stroops) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `create_campaign_1_token` | 695 630 | 1 252 885 | 7 | 3 | 748 | 916 | 2 243 781 |
| `create_campaign_10_tokens` | 1 130 677 | 1 330 736 | 16 | 3 | 1 108 | 1 276 | 2 253 721 |
| `contribute_first_pledge` | 1 166 867 | 1 301 490 | 14 | 8 | 1 764 | 512 | 3 392 390 |
| `contribute_repeat_pledge` | 1 082 187 | 1 289 342 | 12 | 6 | 1 460 | 512 | 2 223 093 |
| `contribute_capped_1_token` | 1 199 524 | 1 302 526 | 14 | 8 | 1 764 | 512 | 3 392 413 |
| `contribute_capped_10_tokens` | 1 804 806 | 1 424 584 | 23 | 8 | 2 124 | 512 | 3 393 144 |
| `contribute_first_pledge_after_10` | 1 370 374 | 1 358 593 | 13 | 8 | 2 164 | 512 | 2 255 130 |
| `contribute_first_pledge_after_100` | 2 699 076 | 1 898 593 | 13 | 8 | 5 764 | 512 | 2 259 136 |
| `contribute_first_pledge_after_400` | 6 986 117 | 3 698 593 | 13 | 8 | 17 764 | 512 | 2 272 391 |
| `claim_1_token_with_fee` | 1 144 636 | 1 312 862 | 11 | 6 | 1 484 | 1 024 | 4 472 345 |
| `refund_1_token` | 976 764 | 1 285 526 | 10 | 6 | 1 460 | 512 | 2 223 019 |
| `refund_all_10_contributors` | 5 170 610 | 1 813 190 | 29 | 24 | 5 276 | 5 120 | 2 324 850 |
| `refund_all_32_contributors` | 19 917 313 | 4 558 086 | 73 | 68 | 14 604 | 16 384 | 2 576 916 |

### High-cost operations

The non-ignored `pledge_cost_*` tests in `src/test_pledge_bench.rs` pin these
behaviours. They run in the normal `cargo test` suite.

1. **`refund_all` hits a hard limit at 32 contributors.** Each refund emits a
   512-byte `Refund` event, and mainnet caps contract events at 16 384 bytes
   per transaction. Refunding 33 contributors fails with
   `contract events size bytes: 16896 > 16384`. A failed or canceled
   campaign with more than 32 contributors therefore cannot be closed with
   `refund_all`, and contributors must call `refund` themselves. Cost also
   grows by about 0.66 M instructions and 2 writes per contributor.
2. **The `Contributors(id)` rewrite grows with every new contributor.**
   `contribute` reads and rewrites the entire contributor `Vec` on each
   first-time pledge. That adds about 40 write bytes and about 14 k
   instructions per existing contributor (6.99 M instructions and 17.7 KB
   written at 400 contributors). By extrapolation, the entry would reach the
   64 KiB mainnet entry-size cap at roughly 1 600 contributors. After that,
   new contributors could not pledge at all. This ceiling is extrapolated,
   not measured.
3. **The per-contributor cap check reads one entry per accepted token.**
   With `max_per_contributor` set, `contribute` sums `Contribution` entries
   across every accepted token. That is +9 reads and +0.6 M instructions at
   10 tokens. It is bounded by `MAX_ACCEPTED_TOKENS`.
4. **`claim` with a fee recipient** makes two token transfers per token and
   has the highest single-call fee estimate on the path (about 4.47 M
   stroops).

Possible mitigations (not part of this change): paginate `refund_all`, or
emit one summary event instead of one per contributor. Keep contributors in
per-index entries instead of one `Vec`.

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