# 0005 - Soroban over Other Smart Contract Platforms

## Context

The project needs a smart contract platform to manage on-chain campaign state — creation, pledges, claims, and refunds. Several platforms were evaluated:

1. **Soroban (Stellar)** — Rust-based smart contract platform native to the Stellar network. Uses the Stellar asset model (trustlines, classic assets) and settles via Stellar consensus. WASM-based execution with a capacity-bound fee model.

2. **Solidity (EVM — Ethereum, Polygon, Arbitrum)** — The dominant smart contract platform with the largest ecosystem of tools, libraries, and developers. Well-understood security patterns (OpenZeppelin, etc.) but high complexity for simple state-machine contracts.

3. **Solana (BPF)** — High-throughput, low-latency platform using Rust and a parallel execution model. Account-based architecture with rent and minimal fee market. Attractive for scale but steeper learning curve for account model.

4. **Tezos (Michelson / LIGO)** — Self-amending ledger with on-chain governance. Formal verification tooling is mature. Smaller developer ecosystem and fewer wallet integrations.

5. **Algorand (TEAL / AVM)** — Pure proof-of-stake with transaction-finality guarantees. Pythonic contract development via PyTEAL but limited debugging tooling.

The project is a Stellar ecosystem crowdfunding app. The platform decision must consider:

- **Ecosystem fit** — the app exists to serve Stellar users and assets
- **Asset model** — Stellar's native asset model (trustlines, asset codes, distribution accounts) should be directly usable without wrapping or bridging
- **Developer onboarding** — contributors come from the Stellar community and should not need to learn a foreign chain
- **MVP scope** — the contract surface is small: `create_campaign`, `contribute`, `claim`, `refund` with a few administrative functions

## Decision

Use **Soroban** as the smart contract platform.

Soroban is Stellar's native smart contract platform. Contracts are written in Rust, compiled to WASM, and deployed to the Stellar network. The Stellar ecosystem provides tooling (`stellar CLI`, `@stellar/stellar-sdk`, Freighter wallet) that integrates directly with Soroban without adapters or bridges.

The contract lives in `contracts/` and is compiled, deployed, and available for invocation. The **planned architecture** is for the frontend to invoke it via `@stellar/stellar-sdk` and `@stellar/freighter-api`. The backend stores the deployed `CONTRACT_ID` and `SOROBAN_RPC_URL` in environment variables and exposes them to the frontend through `/api/config`. As of this writing, the live wallet-signing flow is not yet fully wired into the frontend (see the README for current integration status).

## Consequences

- **Direct Stellar asset access** — campaigns can accept any Stellar asset (USDC, XLM, PYUSD) without wrapping. The `token` parameter in `contribute` is a Soroban `Address` that identifies the token's on-chain contract. For classic Stellar assets, this is the Stellar Asset Contract (SAC) address, which must be deployed on the network before the asset can be accepted by a campaign. SAC deployment is a prerequisite for accepting classic Stellar assets in pledge flows.
- **Rust-based development** — contract developers need Rust and `wasm32-unknown-unknown` target. The Rust toolchain is well-supported but adds a dependency for contributors who only work on frontend or backend.
- **Small platform ecosystem** — Soroban has fewer third-party libraries, audited patterns, and tooling compared to EVM chains. Custom implementations are more common.
- **Ecosystem alignment** — Freighter, Stellar RPC, and the Stellar testnet faucet all target Soroban first. Users and contributors from the Stellar community will be familiar with the stack.
- **Migration cost to switch** — moving to EVM or Solana later would require a complete contract rewrite. The backend and frontend abstractions isolate some of this (the reconcile pattern is chain-agnostic), but the contract logic would not port directly.

## References

- `contracts/` — Soroban contract source
- `frontend/src/services/soroban.ts` — contract interaction from the frontend
- `frontend/src/services/freighter.ts` — wallet signing for Soroban transactions
- [Soroban documentation](https://soroban.stellar.org/docs)
- [Stellar smart contracts overview](https://developers.stellar.org/docs/smart-contracts)
- `adr/0003-freighter-wallet-integration.md` — wallet integration for Soroban signing
