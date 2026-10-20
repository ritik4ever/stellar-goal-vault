# 0003 - Freighter Wallet Integration

Status: Accepted

## Context

The MVP needs a way for contributors and creators to sign Soroban transactions (pledge, claim, refund) without the backend ever holding a private key. Three approaches were considered:

1. ** Freighter browser extension ** — the user installs the [Freighter](https://www.freighter.app/) browser extension, which holds their Stellar keypair locally and exposes a JavaScript API (`@stellar/freighter-api`) for requesting access, reading network details, and signing transactions.
2. ** Server-side key signing ** — the backend holds a funded Stellar secret key and signs transactions on behalf of users. Simple to implement but requires trusting the server with user funds and breaks the self-custody model.
3. ** WalletConnect ** — a protocol for connecting mobile wallets to web apps via QR code or deep link. Broader wallet support but significantly more integration complexity, and Stellar ecosystem adoption is limited compared to Freighter.

The project is an open-source MVP targeting Stellar developers and contributors. The signing approach needs to be:

-
 Self-custodial (no private keys on the server)
- Practical for contributors to test locally on Stellar testnet
- Consistent with how the broader Stellar developer ecosystem works today

## Decision

Use **Freighter** as the sole wallet signing mechanism for the MVP.

The frontend (`frontend/src/services/freighter.ts`) integrates `@stellar/freighter-api` directly:

- Listens for extension availability and requests access before signing
- Listens for the current network details to validate the user is on the expected network (testnet or mainnet) before building any transaction
- Signs the assembled XDR and returns it to the caller for submission to the Soroban RPC

The transaction lifecycle for pledges, claims, and refunds follows the simulate → sign → submit → reconcile pattern:

1. Build the transaction using `@stellar/stellar-sdk` and the contract ID from backend config
2. Simulate via Soroban RPC to get the authorisation footprint and fee estimate
3. Pass the assembled XDR to the Freighter sign call — Freighter prompts the user
4. Submit the signed XDR to the Soroban RPC
5. Call the backend reconcile endpoint to record the confirmed transaction hash in SQLite

The backend never receives or stores a private key. `CONTRACT_ID` and `SOROBAN_RPC_URL` are exposed to the frontend via the `/api/config` endpoint so the frontend can build transactions without hardcoding network details.

## Network Mismatch Handling

Freighter can be configured for any Stellar network (mainnet, testnet, futurenet, or a custom network). If the wallet is pointed at a different network than the application, a transaction built for the app's network would be signed but rejected by the RPC (or worse, submitted to the wrong network). The integration therefore enforces a network guard before any signing or submission occurs:

1. After requesting access, read the wallet network details and compare the returned network passphrase against the application's configured `NETWORK_PASSTHRASE` (exposed via `/api/config`).
2. If they differ, throw a typed NetworkMismatchError that carries both the wallet network and the expected network. The error is raised before transaction assembly, so no XDR is ever built, signed, or submitted.
3. The UI surfaces an actionable message telling the user to switch Freighter to the expected network (naming it explicitly, e.g. "Test Network") and retry the action. The connection state is not cached across the guard, so a switch in Freighter is picked up on the next attempt.
4. The guard is applied uniformly to every signing entry point (contributor pledge, creator claim, and refund) by routing all signing through the shared Freighter service.

Focused tests cover the guard in isolation: matching networks proceed to signing, mismatched networks raise NetworkMismatchError and never invoke signing or the submit path, and the user-facing message names the expected network.

## Consequences

-
Contributors need the Freighter extension installed and funded on Stellar testnet to exercise the full pledge/claim/refund flow.
- The backend remains stateless with respect to signing — it only stores the reconciled transaction hash after the fact.
- Network mismatch errors are caught early (before transaction assembly) by comparing the wallet network against the configured `NETWORK_PASSPHRASE`. A mismatched network never submits a transaction and the user receives an actionable recovery message.
- WalletConnect or other wallet adapters can be added later without changing the backend; the simulate → sign → submit → reconcile pattern is wallet-agnostic at the API boundary.
- Server-side key signing remains possible for automated testing or scripts (see `contracts/` deploy scripts) but is explicitly excluded from the user-facing pledge flow.

## References

-
[Freighter API documentation](https://docs.freighter.app/docs/guide/usingFreighterBrowser)
- [Stellar Soroban RPC documentation](https://developers.stellar.org/docs/data/rpc)
- `frontend/src/services/freighter.ts` — implementation
- `frontend/src/services/soroban.ts` — refund flow using the same pattern
- `adr/0001-sqlite-off-chain-mvp.md` — SQLite reconciliation layer
- `adr/0002-react-express-mvp.md` — overall frontend/backend architecture
