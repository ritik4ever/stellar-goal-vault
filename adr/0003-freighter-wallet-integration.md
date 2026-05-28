# ADR 0003: Freighter Wallet Integration

## Status
Accepted

## Context
The Stellar Goal Vault application needs users to sign Soroban transactions
(pledge, claim, refund) with their Stellar wallet. We must choose a wallet
integration approach that works in a browser environment and supports the
Soroban smart contract platform.

## Decision
We will integrate **Freighter** as the primary wallet provider, using the
`@stellar/freighter-api` package for direct browser extension communication.

## Options Considered

### Option 1: Freighter Browser Extension (Chosen)
- **Description**: Use the Freighter browser extension API directly to request
  public key, sign transactions, and submit to the Stellar network.
- **Pros**:
  - Official Stellar wallet with Soroban support
  - Mature, well-documented API
  - TypeScript types available via `@stellar/freighter-api`
  - Direct integration with Stellar SDK
  - No intermediary server required
- **Cons**:
  - Requires users to install a browser extension
  - Only works in browser environments
  - User experience varies by extension version

### Option 2: Server-Side Key Management
- **Description**: Store private keys on the backend server and sign
  transactions server-side.
- **Pros**:
  - No browser extension required
  - Simpler user experience
- **Cons**:
  - Major security risk (key exfiltration)
  - Users must trust the server with their keys
  - Not self-custodial
  - Violates Stellar's self-custody principles

### Option 3: WalletConnect
- **Description**: Use WalletConnect protocol for cross-wallet compatibility.
- **Pros**:
  - Supports multiple wallets
  - QR code pairing for mobile
- **Cons**:
  - More complex integration
  - Limited Soroban support at time of evaluation
  - Higher latency due to bridge server

## Consequences
- Users must install the Freighter browser extension to interact with the dApp
- All Soroban transaction signing happens client-side via Freighter API
- The backend never has access to user private keys
- Transaction submission flow: simulate → sign via Freighter → submit to network
- Error handling must account for extension not installed, wrong network,
  or user rejection of signing request
- The dashboard detects Freighter on mount and shows appropriate UI states
  (connected, not connected, wrong network)

## Implementation
- Frontend uses `useFreighter` hook to manage wallet state
- `sorobanRpc.ts` orchestrates the simulate → sign → submit flow
- Freighter is detected via `window.freighter` or `@stellar/freighter-api`
- Network switching handled dynamically based on environment

## References
- [Freighter API Documentation](https://docs.freighter.app/)
- [@stellar/freighter-api npm package](https://www.npmjs.com/package/@stellar/freighter-api)
- [Stellar Soroban Docs](https://soroban.stellar.org/)
