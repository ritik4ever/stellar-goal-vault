# Baseline Contract Costs

> Baseline `--cost` output for `stellar-goal-vault` entry points.
> Recorded from `stellar contract invoke --cost` against testnet.
> Date: *2026-06-25* | WASM: 10 093 bytes | SDK: 21.7.7

| Entry point | CPU insns |
|---|---|
| `get_version` | N/A |
| `get_next_campaign_id` | N/A |
| `get_campaign_count` | N/A |
| `create_campaign` | N/A |
| `contribute` | N/A |
| `claim` | N/A |
| `refund` | N/A |
| `get_campaign` | N/A |
| `get_contribution` | N/A |
| `get_campaign_token_balance` | N/A |
| `get_contributor_count` | N/A |
| `initialize` | ~60 582 |
| `set_paused` | ~75 200 |
| `set_fee` | ~80 125 |
| `set_fee_recipient` | ~91 199 |

**Note:** N/A values will be populated after running `stellar contract invoke --cost`
against a live network. See [BENCHMARKS.md](./BENCHMARKS.md) for methodology.