# Soroban Binding Regeneration & ABI Drift Verification

This document describes how Stellar Goal Vault verifies Soroban TypeScript binding regeneration from a clean environment and detects ABI drift without using live funds or network calls.

## Scope

- **Generated bindings**: `frontend/src/generated/index.ts` (`GoalVaultContract` client)
- **Binding guard & regeneration script**: `scripts/bindings-guard.ts`, `scripts/gen-bindings.ts`
- **Deterministic fixtures & ABI drift detector**: `scripts/bindings-abi-fixtures.ts`

## Deterministic Fixtures (No Live Funds)

All contract IDs and account addresses in `scripts/bindings-abi-fixtures.ts` are synthetic base32 strkeys and must never be funded or submitted to live networks:

- **`CONTRIBUTION_ARGS_ABI_CHANGE_FIXTURE`**: Simulates a Soroban contract ABI change to `contribute` arguments while generated bindings still carry the previous signature.
- **`REFUND_ARGS_ABI_CHANGE_FIXTURE`**: Simulates a Soroban contract ABI change to `refund` arguments while generated bindings still carry the previous signature.
- **`CONTRACT_ID_DIVERGENCE_FIXTURE`**: Simulates `frontend/src/generated/.contract-id` diverging from the deployed contract ID.

## Running Verification Tests Offline

```bash
# Type-safe GoalVaultContract calls (mocked Stellar SDK RPC, no live funds)
cd frontend && npx vitest run src/generated/index.test.ts

# Clean-environment regeneration & CI-visible ABI drift detection
cd backend && npx vitest run tests/bindings-regeneration.test.ts tests/bindings-guard.test.ts
```

## CI-Visible Drift Behavior

- `checkBindingsDrift` returns `status: 'drift'` with both contract IDs and the `npm run gen:bindings` recovery command when `.contract-id` diverges from the deployed contract ID (`npm run gen:bindings:check` exits with code `1`).
- `detectAbiSignatureDrift` returns `status: 'drift'` and `exitCode: 1` listing every drifted method and the `npm run gen:bindings` recovery command when contribution or refund arguments change.
