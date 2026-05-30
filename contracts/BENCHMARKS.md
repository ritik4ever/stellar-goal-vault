# Contract WASM Binary Size

## Baseline (release profile, no wasm-opt)

| Contract | Size |
|----------|------|
| stellar_goal_vault.wasm | ~40 KB |

## Optimized (release + wasm-opt -Oz)

| Contract | Size | Reduction |
|----------|------|-----------|
| stellar_goal_vault.wasm | ~35 KB | ~12% |

*Run `make optimize-contracts` to regenerate these numbers.*
