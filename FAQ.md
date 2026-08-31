# Frequently Asked Questions

Common questions about **Stellar Goal Vault** organized by audience.

---

## Table of Contents

**For Creators**
1. [How do I create a campaign?](#1-how-do-i-create-a-campaign)
2. [What tokens can my campaign accept?](#2-what-tokens-can-my-campaign-accept)
3. [Can I cancel or delete a campaign?](#3-can-i-cancel-or-delete-a-campaign)
4. [Can I update my campaign after publishing it?](#4-can-i-update-my-campaign-after-publishing-it)
5. [How do I claim a funded vault?](#5-how-do-i-claim-a-funded-vault)
6. [What happens if my campaign misses its target?](#6-what-happens-if-my-campaign-misses-its-target)
7. [Can I extend my campaign deadline?](#7-can-i-extend-my-campaign-deadline)

**For Backers**
8. [How does pledging work?](#8-how-does-pledging-work)
9. [Can I cancel a pledge?](#9-can-i-cancel-a-pledge)
10. [How do I get a refund?](#10-how-do-i-get-a-refund)
11. [What wallets are supported?](#11-what-wallets-are-supported)
12. [How do I set up Freighter?](#12-how-do-i-set-up-freighter)
13. [Why did my pledge fail?](#13-why-did-my-pledge-fail)
14. [Is there a minimum pledge amount?](#14-is-there-a-minimum-pledge-amount)

**Technical**
15. [Is mainnet supported?](#15-is-mainnet-supported)
16. [What are the fees?](#16-what-are-the-fees)
17. [How do I get testnet XLM?](#17-how-do-i-get-testnet-xlm)
18. [How do I deploy the Soroban contract?](#18-how-do-i-deploy-the-soroban-contract)
19. [How do I reset the local database?](#19-how-do-i-reset-the-local-database)
20. [How do I configure environment variables?](#20-how-do-i-configure-environment-variables)
21. [How do I run the full stack locally?](#21-how-do-i-run-the-full-stack-locally)
22. [How do I contribute a new feature?](#22-how-do-i-contribute-a-new-feature)

---

## For Creators

### 1. How do I create a campaign?

Open the dashboard at `http://localhost:3000`, click **New Campaign**, and fill in:

- **Title** — 3–120 characters
- **Description** — optional, up to 2000 characters
- **Accepted tokens** — one or more of `USDC`, `XLM`, `ARS`
- **Target amount** — total you need to raise
- **Deadline** — must be a future date

The campaign is created locally via `POST /api/campaigns`. Once the Soroban contract integration is live, creation will also record the campaign on-chain.

---

### 2. What tokens can my campaign accept?

By default, campaigns can accept `USDC`, `XLM`, and `ARS`. The allowed set is controlled by the `ALLOWED_ASSETS` environment variable on the backend, so a self-hosted deployment can add or restrict tokens at the config level.

When a campaign accepts multiple tokens, contributors choose which one to pledge and the dashboard shows a per-token progress bar.

---

### 3. Can I cancel or delete a campaign?

Not directly through the UI yet. Campaigns transition automatically between states (`open` → `funded`/`failed`) based on pledges and the deadline. There is no manual cancel flow in the current MVP.

If you need to remove a test campaign in a local development environment, you can delete it directly from the SQLite database — see [FAQ #19](#19-how-do-i-reset-the-local-database).

---

### 4. Can I update my campaign after publishing it?

The Soroban contract exposes `update_metadata` for on-chain updates before the deadline:

```bash
stellar contract invoke --id $CONTRACT_ID -- update_metadata \
  --campaign_id 1 \
  --creator $CREATOR_ADDRESS \
  --new_metadata "Updated description"
```

The contract emits a `MetadataUpdated` event containing the old and new values. The backend event indexer picks this up automatically and updates local state.

You cannot change `targetAmount`, `deadline`, or `acceptedTokens` after creation.

---

### 5. How do I claim a funded vault?

Once a campaign reaches its target **and** the deadline has passed, the creator can claim it. Send a signed claim transaction through the frontend or call the endpoint directly:

```bash
curl -X POST http://localhost:3001/api/campaigns/:id/claim \
  -H "Content-Type: application/json" \
  -d '{"creator": "G...", "transactionHash": "abc123..."}'
```

The campaign status moves to `claimed` and the funds are released on-chain via the Soroban contract.

---

### 6. What happens if my campaign misses its target?

If the deadline passes without reaching `targetAmount`, the campaign status changes to `failed`. No further pledges are accepted. Contributors can then request refunds for their pledges — the process is described in [FAQ #10](#10-how-do-i-get-a-refund).

---

### 7. Can I extend my campaign deadline?

Yes, through on-chain governance. Any existing contributor can request an extension:

```bash
stellar contract invoke --id $CONTRACT_ID -- request_deadline_extension \
  --campaign_id 1 \
  --caller $CONTRIBUTOR_ADDRESS \
  --new_deadline <unix_timestamp>
```

The extension is applied once more than 50% of unique contributors approve it. Constraints:

- New deadline must be later than the current one
- Cannot exceed 180 days from campaign creation

---

## For Backers

### 8. How does pledging work?

1. Connect your Freighter wallet (see [FAQ #12](#12-how-do-i-set-up-freighter))
2. Open a campaign that is in `open` status
3. Enter a pledge amount and select a token if the campaign accepts more than one
4. Freighter prompts you to sign the Soroban transaction
5. Once confirmed on-chain, the backend reconciles the pledge and the campaign progress updates

Off-chain: the pledge is recorded locally first via `POST /api/campaigns/:id/pledges`. The Soroban transaction is submitted separately and the confirmed hash is reconciled via `POST /api/campaigns/:id/pledges/reconcile`.

---

### 9. Can I cancel a pledge?

No. Once submitted, pledges are final. The on-chain Soroban contract does not expose a cancel instruction. If the campaign fails (misses its target by the deadline), you can request a full refund — see [FAQ #10](#10-how-do-i-get-a-refund).

---

### 10. How do I get a refund?

Refunds are available when a campaign's status is `failed`. The backend calls the Soroban contract to verify the refund transaction and return the pledged amount:

```bash
curl -X POST http://localhost:3001/api/campaigns/:id/refund \
  -H "Content-Type: application/json" \
  -d '{
    "contributor": "G...",
    "soroban": {
      "txHash": "...",
      "contractId": "C...",
      "networkPassphrase": "Test SDF Network ; September 2015",
      "rpcUrl": "https://soroban-testnet.stellar.org:443",
      "walletAddress": "G..."
    }
  }'
```

The `refundedAmount` in the response confirms how much was returned.

---

### 11. What wallets are supported?

**[Freighter](https://freighter.app)** is the only supported wallet right now. It is a browser extension available for Chrome and Firefox that signs Soroban transactions natively.

Support for other Stellar wallets (e.g., Lobstr, xBull) is not in scope for the current MVP but can be added by implementing the [SEP-0007](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) URI scheme or [WalletConnect](https://walletconnect.com/) in a future release.

---

### 12. How do I set up Freighter?

1. Install the **Freighter** extension from [freighter.app](https://freighter.app) (Chrome or Firefox)
2. Click **Create a new wallet** and save your recovery phrase
3. Go to **Settings → Network** and switch to **Testnet**
4. Fund your wallet with testnet XLM — see [FAQ #17](#17-how-do-i-get-testnet-xlm)
5. Open the app — the wallet widget in the header should display your public key

If the header shows "Connect Freighter", click it and approve the connection request in the extension popup. Make sure both the app and Freighter are on the same network.

---

### 13. Why did my pledge fail?

| Cause | What to check |
|---|---|
| Campaign is not `open` | Status past deadline or already `funded` |
| Per-contributor limit hit | `maxPerContributor` set on the campaign |
| Invalid contributor address | Must be a valid `G...` Stellar public key |
| Amount is zero or negative | `amount` must be a positive number |
| Wrong asset code | Asset must be in the campaign's `acceptedTokens` |
| Contract ID mismatch | Backend `CONTRACT_ID` must match the deployed contract |

Check the campaign status and your contribution history:

```bash
curl http://localhost:3001/api/campaigns/:id
curl http://localhost:3001/api/campaigns/:id/contributors
```

---

### 14. Is there a minimum pledge amount?

Yes. The Soroban contract enforces a minimum contribution of **100 stroops** by default (configurable at deploy time via `initialize(admin, min_contribution)`). Pledges below this threshold are rejected with `"contribution below minimum"`.

On the backend side there is no separate minimum — the contract validation is the authoritative check.

---

## Technical

### 15. Is mainnet supported?

The codebase is mainnet-compatible but the MVP defaults to Stellar **testnet**. To point at mainnet, update your environment variables:

```env
SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
CONTRACT_ID=<your_mainnet_contract_id>
```

And regenerate TypeScript bindings against the mainnet contract:

```bash
NETWORK=mainnet \
CONTRACT_ID=YOUR_MAINNET_CONTRACT_ID \
RPC_URL=https://soroban-mainnet.stellar.org \
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" \
npm run gen:bindings
```

Before going to mainnet, review the [SECURITY.md](./SECURITY.md) checklist and the known limitations section in the README.

---

### 16. What are the fees?

Stellar Goal Vault itself charges **no fees**. The only costs are standard Stellar network transaction fees:

- **Base fee:** 100 stroops (0.00001 XLM) per operation — set by the Stellar network
- **Soroban resource fees:** vary based on contract CPU/memory usage, typically a few hundred stroops per transaction

The MVP does not take any protocol-level fee cut. A fee mechanism could be added to the Soroban contract in a future release.

---

### 17. How do I get testnet XLM?

Use the Stellar Friendbot to fund any testnet account for free:

```bash
curl -X POST "https://friendbot.stellar.org?addr=YOUR_TESTNET_PUBLIC_KEY"
```

Or visit [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=testnet) and click the **Friendbot** button. Each request funds the account with 10,000 testnet XLM.

---

### 18. How do I deploy the Soroban contract?

**Prerequisites:** Rust + `wasm32-unknown-unknown` target, `soroban-cli`, and a funded testnet secret key.

```bash
SECRET_KEY="S..." npm run deploy:contract
```

The script builds the contract, deploys it to testnet, and saves the contract ID to `contracts/contract_id.txt`. Update your backend config:

```bash
CONTRACT_ID=$(cat contracts/contract_id.txt)
```

For full redeployment and rollback steps, see [RUNBOOK.md](./RUNBOOK.md).

---

### 19. How do I reset the local database?

```bash
# Stop the backend
docker compose stop backend

# Delete the SQLite file
rm -f backend/data/campaigns.db

# Restart — the schema is recreated automatically on startup
docker compose start backend
```

To seed deterministic test data after resetting:

```bash
cd backend && npx ts-node src/services/seedDeterministic.ts
```

---

### 20. How do I configure environment variables?

Copy the example file and edit it:

```bash
cp backend/.env.example backend/.env
```

Key variables:

| Variable | Default | Notes |
|---|---|---|
| `CONTRACT_ID` | _(required)_ | Deployed Soroban contract ID |
| `PORT` | `3001` | Backend HTTP port |
| `ALLOWED_ASSETS` | `USDC,XLM,ARS` | Comma-separated accepted tokens |
| `SOROBAN_RPC_URL` | testnet | RPC endpoint |
| `DB_PATH` | `backend/data/campaigns.db` | SQLite file path |
| `LOG_LEVEL` | `info` | `debug \| info \| warn \| error` |
| `DEFAULT_MAX_PER_CONTRIBUTOR` | `0` | `0` = no limit |

For production-specific options (API keys, Redis cache, rate limits) see [`backend/.env.example`](backend/.env.example).

---

### 21. How do I run the full stack locally?

**Without Docker:**

```bash
npm run install:all
npm run dev:backend   # http://localhost:3001
npm run dev:frontend  # http://localhost:3000
```

**With Docker (hot-reload):**

```bash
docker compose up --build
```

The `docker-compose.override.yml` mounts source directories automatically so changes are reflected without rebuilding images.

---

### 22. How do I contribute a new feature?

1. Fork the repo and create a branch: `git checkout -b feat/my-thing`
2. Install dependencies: `npm run install:all`
3. Make your changes and run the relevant tests:
   - Backend: `cd backend && npx vitest`
   - Contract: `cd contracts && cargo test`
4. Commit using conventional commits (`feat:`, `fix:`, `chore:`, etc.)
5. Open a PR against `main`

Good starting points: issues labelled `good first issue`, or the ideas in [OPEN_SOURCE_ISSUES.md](./OPEN_SOURCE_ISSUES.md).

---

*Last updated: 2026-07-30 — update this date with each major release.*
