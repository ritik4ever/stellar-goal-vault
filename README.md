# Stellar Goal Vault

Stellar Goal Vault is a lightweight crowdfunding MVP for the Stellar ecosystem.

It includes:
- A React dashboard to create and manage funding campaigns
- A Node.js + Express API backed by SQLite
- A Soroban contract scaffold for on-chain campaign creation, pledges, claims, and refunds
- A seeded contribution backlog you can turn into GitHub issues after publishing

## What the project does?

Creators open a campaign with a target amount and deadline.

Contributors can pledge until the deadline:
- If the target is reached, the creator can claim the vault
- If the target is missed, contributors can refund their pledges

This repo is intentionally scoped as an MVP so it is easy to extend with wallet signing, event indexing, and production-grade UX.

## Current architecture

Frontend (`frontend`, port `3000`)
- React + Vite dashboard
- Campaign board, detail panel, timeline, and contribution backlog
- Uses `/api` proxy for backend calls
- Freighter-backed pledge flow that simulates, signs, submits, and then reconciles local state

Backend (`backend`, port `3001`)
- Express REST API
- SQLite persistence for campaigns, pledges, and event history
- Real-time campaign status derived from current timestamps and stored pledges
- Exposes contract/network config to the frontend and reconciles confirmed pledge hashes

Contract (`contracts`)
- Soroban Rust scaffold
- Implements `create_campaign`, `contribute`, `claim`, `refund`, `get_campaign`, and `get_contribution`
- Not yet wired into live wallet signing flow in the frontend

## Core campaign model

Each campaign stores:
- `creator`
- `title`
- `description`
- `assetCode`
- `targetAmount`
- `pledgedAmount`
- `deadline`

Campaign states:
- `open` when deadline has not passed and target is not yet met
- `funded` when pledged amount is at least the target and funds have not been claimed
- `claimed` when the creator has claimed a funded vault
- `failed` when deadline has passed without reaching the target

## API reference

Base URL:
- Local backend: `http://localhost:3001`
- Frontend proxy: `/api`

### `GET /api/health`
- Service health check
- Response:

```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "2026-03-27T21:30:00.000Z",
  "uptimeSeconds": 12.345,
  "database": {
    "status": "up",
    "reachable": true
  }
}
```

- `status` is `ok` when the API and database probe succeed, otherwise `degraded`
- `database.status` is `up` or `down` based on a lightweight SQLite reachability check

### `GET /api/campaigns`
- Returns all campaigns with computed progress
- Query parameters:
  - `q` (optional): Search query to filter campaigns by title, creator, or campaign ID (case-insensitive)
  - `asset` (optional): Filter campaigns by asset code (e.g., USDC, XLM)
  - `status` (optional): Filter campaigns by status (open, funded, claimed, failed)

### `GET /api/campaigns/:id`
- Returns one campaign with pledges and event history

### `POST /api/campaigns`
- Create a campaign

Request body:
- `creator`
- `title`
- `description`
- `assetCode`
- `targetAmount`
- `deadline`

### `POST /api/campaigns/:id/pledges`
- Add a pledge to a live campaign

Request body:
- `contributor`
- `amount`

### `POST /api/campaigns/:id/pledges/reconcile`
- Record a confirmed on-chain pledge locally after the Soroban transaction succeeds

Request body:
- `contributor`
- `amount`
- `transactionHash`
- `confirmedAt` (optional)

### `POST /api/campaigns/:id/claim`
- Claim a funded campaign after deadline

Request body:
- `creator`

### `POST /api/campaigns/:id/refund`
- Refund all active pledges from one contributor on a failed campaign

Request body:
- `contributor`

### `GET /api/campaigns/:id/history`
- Fetch local event history for the selected campaign

### `GET /api/open-issues`
- Returns seeded issue ideas for public open-source contribution

## Run locally

Prerequisites:
- Node.js 18+
- npm 9+
- Optional for contract work: Rust + Soroban toolchain

From repo root:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Open:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

Build:

```bash
npm run build
```

## Deploy contract

Set a funded Stellar testnet secret key and run:

```bash
SECRET_KEY="S..." npm run deploy:contract
```

The script will:
1. Build the Soroban contract
2. Deploy to Stellar testnet
3. Output the contract ID
4. Save the ID to `contracts/contract_id.txt`

## Environment variables

Backend:
- `PORT` defaults to `3001`
- `DB_PATH` defaults to `backend/data/campaigns.db`
- `SOROBAN_RPC_URL` defaults to Stellar testnet RPC
- `CONTRACT_ID` is required for Freighter pledge signing
- `NETWORK_PASSPHRASE` defaults to Stellar testnet
- `CONTRACT_AMOUNT_DECIMALS` defaults to `2` and controls display-to-contract unit scaling

Frontend:
- `VITE_API_URL` defaults to `/api`

Contract deployment:
- `SECRET_KEY` required
- `NETWORK_PASSPHRASE` optional
- `RPC_URL` optional

## Open-source ready next steps

The main contribution issue for this repo is:

`Implement Freighter-signed pledge transactions`

That issue is already represented in:
- `backend/src/services/openIssues.ts`
- `OPEN_SOURCE_ISSUES.md`
- The frontend backlog panel

## Known limitations

- Campaign creation is still local-first, so pledges will only simulate successfully for campaign IDs that also exist in the configured contract
- No authentication or rate limiting on write endpoints
- No background indexer for on-chain event sync yet

## Suggested roadmap

- Replace mock pledge actions with Freighter + Soroban transactions
- Index on-chain events into SQLite
- Add filters, sorting, and campaign pages
- Add contract tests and backend integration tests
