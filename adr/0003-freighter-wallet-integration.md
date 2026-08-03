# 0003 - Freighter Wallet Integration

Status: Accepted

## Context

The MVP needs a way for contributors and creators to sign Soroban transactions (pledge, claim, refund) without the backend ever holding a private key. Three approaches were considered:

1. **Freighter browser extension** — the user installs the [Freighter](https://www.freighter.app/) browser extension, which holds their Stellar keypair locally and exposes a JavaScript API (`@stellar/freighter-api`) for requesting access, reading network details, and signing transactions.
2. **Server-side key signing** — the backend holds a funded Stellar secret key and signs transactions on behalf of users. Simple to implement but requires trusting the server with user funds and breaks the self-custody model.
3. **WalletConnect** — a protocol for connecting mobile wallets to web apps via QR code or deep link. Broader wallet support but significantly more integration complexity, and Stellar ecosystem adoption is limited compared to Freighter.

The project is an open-source MVP targeting Stellar developers and contributors. The signing approach needs to be:

- Self-custodial (no private keys on the server)
- Practical for contributors to test locally on Stellar testnet
- Consistent with how the broader Stellar developer ecosystem works today

## Decision

Use **Freighter** as the sole wallet signing mechanism for the MVP.

The frontend (`frontend/src/services/freighter.ts`) integrates `@stellar/freighter-api` directly:

- `isConnected` / `requestAccess` — detect and connect the extension
- `getNetworkDetails` — validate the user is on the expected network (testnet or mainnet) before building any transaction
- `signTransaction` — present the assembled XDR to Freighter for user approval; the signed XDR is then submitted to the Soroban RPC

The transaction lifecycle for pledges, claims, and refunds follows the simulate → sign → submit → reconcile pattern:

1. Build the transaction using `@stellar/stellar-sdk` and the contract ID from backend config
2. Simulate via Soroban RPC to get the authorisation footprint and fee estimate
3. Pass the assembled XDR to `signTransaction` — Freighter prompts the user
4. Submit the signed XDR to the Soroban RPC
5. Call the backend reconcile endpoint to record the confirmed transaction hash in SQLite

The backend never receives or stores a private key. `CONTRACT_ID` and `SOROBAN_RPC_URL` are exposed to the frontend via the `/api/config` endpoint so the frontend can build transactions without hardcoding network details.

## Consequences

- Contributors need the Freighter extension installed and funded on Stellar testnet to exercise the full pledge/claim/refund flow.
- The backend remains stateless with respect to signing — it only stores the reconciled transaction hash after the fact.
- Network mismatch errors are caught early (before transaction assembly) by comparing `getNetworkDetails` against the configured `NETWORK_PASSPHRASE`.
- WalletConnect or other wallet adapters can be added later without changing the backend; the simulate → sign → submit → reconcile pattern is wallet-agnostic at the API boundary.
- Server-side key signing remains possible for automated testing or scripts (see `contracts/` deploy scripts) but is explicitly excluded from the user-facing pledge flow.

## References

- [Freighter API documentation](https://docs.freighter.app/docs/guide/usingFreighterBrowser)
- [Stellar Soroban RPC documentation](https://developers.stellar.org/docs/data/rpc)
- `frontend/src/services/freighter.ts` — implementation
- `frontend/src/services/soroban.ts` — refund flow using the same pattern
- `adr/0001-sqlite-off-chain-mvp.md` — SQLite reconciliation layer
- `adr/0002-react-express-mvp.md` — overall frontend/backend architecture
