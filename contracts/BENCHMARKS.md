# Soroban Contract Benchmarks

> Baseline instruction counts for `stellar-goal-vault` entry points.
> Run `cargo test --release` for baseline, and `scripts/benchmark.sh` for
> `stellar contract invoke --cost` metrics against a local testnet.

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