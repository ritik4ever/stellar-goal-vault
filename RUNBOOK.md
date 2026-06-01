# Runbook — Common Operational Tasks

This runbook covers the day-to-day operations for **Stellar Goal Vault**. Each procedure includes prerequisites, step-by-step instructions, and expected output.

---

## Table of Contents

- [Prerequisites & Access](#prerequisites--access)
- [1. Reset the Dev Database](#1-reset-the-dev-database)
- [2. Rotate the API Key](#2-rotate-the-api-key)
- [3. Redeploy the Soroban Contract](#3-redeploy-the-soroban-contract)
- [4. Roll Back the Backend](#4-roll-back-the-backend)
- [5. Clear the Soroban Event Cache](#5-clear-the-soroban-event-cache)
- [Quick Reference](#quick-reference)

---

## Prerequisites & Access

| Resource              | Location / Command                                |
|-----------------------|---------------------------------------------------|
| Repository root       | `~/projects/stellar-goal-vault`                   |
| Backend env config    | `backend/.env` (copy of `backend/.env.example`)   |
| Docker Compose        | `docker compose up` / `docker compose down`        |
| soroban-cli           | `soroban --version` (install: see [soroban.stellar.org](https://soroban.stellar.org)) |
| Render dashboard      | https://dashboard.render.com                       |
| Vercel dashboard      | https://vercel.com                                 |

> **Important:** Most write operations (API key rotation, contract redeploy, rollback) affect production.
> Always confirm with the team before executing.

---

## 1. Reset the Dev Database

Resets the local SQLite database to a clean slate with deterministic seed data.

### Prerequisites

- Backend must **not** be running (SQLite file is locked while the process is active).
- Node.js dependencies installed: `cd backend && npm install`

### Steps

```bash
# 1. Stop the backend (if running via Docker)
docker compose stop backend

# 2. Delete the existing database file
rm -f backend/data/campaigns.db

# 3. (Optional) Re-seed with deterministic test data
cd backend && npx ts-node src/services/seedDeterministic.ts

# 4. Restart the backend
docker compose start backend
```

### Expected Output

```
Database recreated at backend/data/campaigns.db
Deterministic database seed complete.   (if step 3 was run)
```

### Verification

```bash
# Health check
curl http://localhost:3001/api/health

# List campaigns (should return seed data if seeded, otherwise empty)
curl http://localhost:3001/api/campaigns
```

---

## 2. Rotate the API Key

Replaces the current API key(s) used for backend authentication. Production only.

> **Note:** This causes a brief window where clients using the old key will receive `403 Forbidden` responses.

### Prerequisites

- Access to the production environment (Render dashboard or deployment platform).
- A new API key generated (use a secure random string, e.g. `openssl rand -hex 32`).

### Steps

```bash
# 1. Generate a new API key
NEW_KEY=$(openssl rand -hex 32)
echo "New API key: $NEW_KEY"
```

#### If hosted on Render

1. Go to **Render Dashboard** → your backend web service → **Environment**.
2. Locate `API_KEYS` (may contain multiple comma-separated keys).
3. Replace the old key with the new key.  
   *Rollover strategy (zero-downtime):* Temporarily list **both** the old and new keys separated by a comma, then remove the old key after all clients have migrated.

4. The service will automatically restart.

#### If self-hosted (Docker / VM)

```bash
# 2. Edit the backend .env file
sed -i "s/^API_KEYS=.*/API_KEYS=$NEW_KEY/" backend/.env

# 3. Restart the backend service
docker compose restart backend
```

### Expected Output

```
# After restart, logs should show:
Server started on port 3001
```

### Verification

```bash
# Old key should be rejected
curl -H "Authorization: Bearer <OLD_KEY>" http://localhost:3001/api/campaigns
# → {"success":false,"error":{"code":"FORBIDDEN","message":"Invalid API key"}}

# New key should work
curl -H "Authorization: Bearer $NEW_KEY" http://localhost:3001/api/campaigns
# → {"data":[...],"pagination":{...}}
```

---

## 3. Redeploy the Soroban Contract

Deploys a new version of the Soroban smart contract to the Stellar testnet (or mainnet) and updates the backend configuration.

### Prerequisites

- `soroban-cli` installed ([guide](https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli))
- A funded Stellar account secret key (`SECRET_KEY`) with sufficient XLM balance
- Rust nightly + `wasm32v1-none` target configured:
  ```bash
  rustup target add wasm32v1-none
  ```
- Contract source changes committed and tested (`cd contracts && cargo test`)

### Steps

```bash
# 1. Navigate to the repository root
cd ~/projects/stellar-goal-vault

# 2. Deploy the contract (this runs the deployment script)
SECRET_KEY="S..." ./scripts/deploy.sh
```

The script will:
- Build the contract (`soroban contract build`)
- Deploy it to the testnet
- Save the new contract ID to `contracts/contract_id.txt`
- Print the contract ID

```bash
# 3. Update the backend environment with the new contract ID
CONTRACT_ID=$(cat contracts/contract_id.txt)
sed -i "s/^CONTRACT_ID=.*/CONTRACT_ID=$CONTRACT_ID/" backend/.env
```

```bash
# 4. If using Docker, rebuild and restart
docker compose up -d --build backend

# 5. If using Render, update CONTRACT_ID in Environment Variables
#    (Render auto-deploys on env var change)
```

### Expected Output

```
========================================
Contract deployed successfully!
========================================

Contract ID: C...
```

### Verification

```bash
# Check the contract ID via the API config endpoint
curl http://localhost:3001/api/config | grep contractId

# Run contract property tests
cd contracts && cargo test
```

### Rollback (if contract deploy fails)

```bash
# Restore the previous contract ID from git
git checkout HEAD~1 -- contracts/contract_id.txt
cp contracts/contract_id.txt ../backend/.env
```

---

## 4. Roll Back the Backend

Reverts the backend service to a previous stable version.

### Prerequisites

- A known-good git commit hash or tag to roll back to.
- Access to the deployment platform (Render / Vercel / Docker host).

#### Option A: Git-based rollback (Docker / self-hosted)

```bash
# 1. Record the current HEAD in case you need to revert the rollback
CURRENT_HEAD=$(git rev-parse HEAD)
echo "Current HEAD: $CURRENT_HEAD"

# 2. Hard-reset to the target stable commit
TARGET_COMMIT="<known-good-commit-hash>"
git reset --hard "$TARGET_COMMIT"

# 3. Rebuild and restart the backend
docker compose up -d --build backend

# 4. Run health checks
sleep 5 && curl -f http://localhost:3001/api/health
```

#### Option B: Render dashboard

1. Go to **Render Dashboard** → your backend web service.
2. Click **Manual Deploy** → **Deploy existing commit** or **Deploy specific commit**.
3. Enter the commit hash you want to deploy.
4. Monitor the deploy logs for success.

#### Option C: Vercel (frontend only)

1. Go to **Vercel Dashboard** → your frontend project.
2. Navigate to **Deployments**.
3. Find the deployment you want to restore and click the **...** menu → **Promote to Production**.

### Verification

```bash
# Health endpoint
curl -f http://localhost:3001/api/health && echo "OK"

# API response sample
curl -s http://localhost:3001/api/campaigns | head -c 200
```

> **If the rollback needs to be undone:**
> ```bash
> git reset --hard "$CURRENT_HEAD"
> docker compose up -d --build backend
> ```

---

## 5. Clear the Soroban Event Cache

Purges the Soroban on-chain event index to force a full re-index from the ledger.

> **When to use:** If events are missing, duplicated, or out of sync with the on-chain state.

### Prerequisites

- Backend must be running.
- Redis must be configured (if using production caching).

### Steps

```bash
# 1. (Optional) Verify the current event count before clearing
curl -s http://localhost:3001/api/campaigns/<campaign-id>/history | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Events: {len(data.get(\"data\", []))}')"
```

#### Clear the SQLite event cache

> This deletes all indexed events. The event indexer will automatically re-fetch from the Soroban RPC on its next poll cycle (every 10 seconds).

```bash
# 2. Stop the backend to prevent new events from being indexed while clearing
docker compose stop backend

# 3. Delete events from the database
sqlite3 backend/data/campaigns.db "DELETE FROM campaign_events;"

# 4. Restart the backend
docker compose start backend
```

#### Clear the Redis cache (production only)

```bash
# If redis-cli is available
redis-cli -u "$REDIS_URL" FLUSHDB

# Or via the application's cache pattern clear (SSH into the backend container)
docker compose exec backend node -e "
  const { clearCachePattern } = require('./dist/services/cache');
  clearCachePattern('cache:*').then(n => console.log('Cleared', n, 'keys'));
"
```

### Expected Output

```
# Backend logs should show:
Soroban event indexer started. Polling every 10s.
[...]
Indexed created event for campaign <id>
Indexed pledged event for campaign <id>
```

### Verification

```bash
# Wait 15-30 seconds for the indexer to re-populate events, then check
curl -s http://localhost:3001/api/campaigns/<campaign-id>/history | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Events after re-index: {len(data.get(\"data\", []))}')"
```

> **Troubleshooting:** If events do not reappear after 60 seconds, check the Soroban RPC URL
> (`SOROBAN_RPC_URL` in backend `.env`) and that the contract ID (`CONTRACT_ID`) is correct.

---

## Quick Reference

| Task                         | Command / Action                                      |
|------------------------------|-------------------------------------------------------|
| Reset dev database           | `rm -f backend/data/campaigns.db && npx ts-node src/services/seedDeterministic.ts` |
| Rotate API key               | Update `API_KEYS` env var → restart service           |
| Deploy contract              | `SECRET_KEY="S..." ./scripts/deploy.sh`               |
| Roll back backend (Docker)   | `git reset --hard <hash>` + `docker compose up -d --build backend` |
| Roll back backend (Render)   | Manual Deploy → Deploy specific commit                |
| Clear Soroban event cache    | `sqlite3 backend/data/campaigns.db "DELETE FROM campaign_events;"` + restart backend |
| Clear Redis cache            | `redis-cli -u "$REDIS_URL" FLUSHDB`                  |
| Health check                 | `curl http://localhost:3001/api/health`               |
| View logs (Docker)           | `docker compose logs -f backend`                      |

---

*Last updated: 2026-06-01*