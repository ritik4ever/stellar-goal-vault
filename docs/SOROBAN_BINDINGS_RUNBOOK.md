# Soroban binding regeneration runbook

The committed files in `frontend/src/generated/` are the type-safe client
surface used by [`frontend/src/services/soroban.ts`](../frontend/src/services/soroban.ts).
They must be generated from the same deployed Soroban contract ID that the
application configuration uses. A successful TypeScript build only proves that
the local types compile; it does not prove that the deployed contract has the
same ABI.

## Regenerate without live funds

Binding generation reads the deployed contract ABI through Soroban RPC. It does
not submit transactions, sign with a wallet, or require funded accounts.
Choose the network and deployed contract explicitly:

```bash
CONTRACT_ID=C... \
RPC_URL=https://soroban-testnet.stellar.org \
NETWORK_PASSPHRASE='Test SDF Network ; September 2015' \
npm run gen:bindings
```

The command is a one-shot generator. It writes the generated client to
`frontend/src/generated/`; it does not modify the contract or use live funds.
Never use a placeholder contract ID. The generator fails immediately when
`CONTRACT_ID` is unset, which prevents a misleading “successful” regeneration.

For mainnet, use the deployed mainnet ID and passphrase:

```bash
NETWORK=mainnet \
CONTRACT_ID=C... \
RPC_URL=https://soroban-mainnet.stellar.org \
NETWORK_PASSPHRASE='Public Global Stellar Network ; September 2015' \
npm run gen:bindings
```

Review the diff before committing:

```bash
git diff -- frontend/src/generated/
npm --prefix frontend test -- --run src/generated/index.test.ts
npm --prefix frontend run build
```

## Diagnose a contract-ID or ABI mismatch

1. Confirm `CONTRACT_ID`, `RPC_URL`, and `NETWORK_PASSPHRASE` refer to the same
   deployment. A testnet ID with a mainnet RPC is a contract-ID mismatch, not a
   TypeScript problem.
2. Run the one-shot generator and inspect only
   `frontend/src/generated/`. Unexpected changes to method names, argument
   types, return types, or struct fields indicate ABI drift.
3. If the generated diff is expected, commit it with the contract change. If it
   is unexpected, restore the generated files and verify that the deployed ID
   and network variables were not mixed.
4. Use the typed `GoalVaultContract` methods from application code. Do not
   hand-write operation names or cast arguments to `any` to bypass a generated
   type error.

Observable runtime signals include:

- `Simulation failed` or `No result returned from <method>`: the generated
  method does not match the deployed contract response or the RPC preflight
  failed.
- A Soroban “unknown contract function”/missing function error: the deployed
  contract ABI does not expose the method represented by the local binding.
- Invalid argument or ScVal conversion errors: the call site is not using the
  generated method’s parameter types.
- `Wallet` or submission errors after simulation: signing/submission is a
  separate flow; regenerate bindings only when the ABI or contract deployment
  changed.

## CI result

`.github/workflows/check-bindings.yml` runs on pull requests changing the
contract, generated bindings, or this workflow. It:

1. installs the generator dependencies and Stellar CLI;
2. fails with `CONTRACT_ID secret is missing` if the deployed ID is unavailable;
3. regenerates bindings from the configured deployed contract; and
4. fails with the GitHub error annotation
   `ABI drift detected in frontend/src/generated/` when the generated directory
   differs from the committed files.

The green result is the observable signal that committed bindings match the
deployed ABI. A red drift step means regenerate and commit the generated
directory; it is not evidence that a wallet or funded account failed.
