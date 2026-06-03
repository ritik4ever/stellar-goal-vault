# Deployment Guide

This guide explains how to deploy the **Stellar Goal Vault** project:

- **Contract → Stellar testnet**
- **Backend → Render**
- **Frontend → Vercel**

---

## Prerequisites

- GitHub repository access
- Node.js 18+ and npm 9+
- Render account for backend deployment
- Vercel account for frontend deployment
- Soroban CLI installed for contract deployment
- Stellar testnet account funded with friendbot

---

## 1. Deploy the Soroban Contract (Testnet)

The backend uses `CONTRACT_ID` to enable the on-chain pledge flow.

### 1.1 Install Soroban CLI

Follow the official Soroban setup guide:
https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli

### 1.2 Fund a Testnet Account

If you do not already have a testnet account, fund one with friendbot:

```bash
PUBLIC_KEY="G..."
curl "https://friendbot.stellar.org/?addr=$PUBLIC_KEY"
```

### 1.3 Deploy the Contract

From the repository root:

```bash
SECRET_KEY="S..." npm run deploy:contract
```

If deploy succeeds, the script will:

1. Build the contract
2. Deploy it to Stellar testnet
3. Print the contract ID
4. Save the contract ID to `contracts/contract_id.txt`

### 1.4 Save the Contract ID

Set the backend environment variable:

```env
CONTRACT_ID=<your-contract-id>
```

If you want to override the default RPC endpoint or network passphrase:

```bash
SECRET_KEY="S..." NETWORK_PASSPHRASE="Test SDF Network ; September 2015" RPC_URL="https://soroban-testnet.stellar.org:443" npm run deploy:contract
```

---

## 2. Backend Deployment (Render)

### 2.1 Create a Render Web Service

1. Sign in to https://render.com
2. Click **New → Web Service**
3. Connect your GitHub repository
4. Choose the `backend` folder as the Root Directory

### 2.2 Configure Build and Start

- **Build Command:**

```bash
npm install && npx tsc -p ./tsconfig.json
```

- **Start Command:**

```bash
node dist/index.js
```

- **Health Check Path:**

```text
/api/health
```

Render will provide `PORT` automatically. The backend defaults to `3001` when `PORT` is unset, but Render will set it to the correct value in the service environment.

### 2.3 Required Environment Variables

Set these in Render's environment configuration:

```env
CONTRACT_ID=<your-contract-id>
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
```

### 2.4 Recommended Backend Environment Variables

Optionally add:

```env
ALLOWED_ASSETS=USDC,XLM
ALLOWED_ORIGINS=https://<your-vercel-domain>
DB_PATH=backend/data/campaigns.db
DEFAULT_MAX_PER_CONTRIBUTOR=0
```

- `ALLOWED_ORIGINS` restricts CORS to your frontend domain.
- Do not rely on SQLite for production data persistence on Render; the container filesystem is ephemeral.

### 2.5 Notes on Render and SQLite

- The backend uses SQLite (`better-sqlite3`) by default.
- Render's storage is not permanent across redeploys.
- For production, use an external database and update `DB_PATH` accordingly.

---

## 3. Frontend Deployment (Vercel)

### 3.1 Import the Project

1. Sign in to https://vercel.com
2. Click **Add New Project**
3. Select the Stellar Goal Vault repository
4. Use the `frontend` folder as the Root Directory

### 3.2 Configure Build

- **Build Command:**

```bash
npm install && npm run build
```

- **Output Directory:**

```text
dist
```

### 3.3 Configure Environment Variables

Set the frontend base API URL:

```env
VITE_API_URL=https://<your-backend-service>.onrender.com
```

This value must be the Render backend URL without a trailing `/`.

### 3.4 Deploy

1. Save the environment variables
2. Trigger deploy
3. Wait until the build succeeds

---

## 4. Verify Deployment

### 4.1 Verify Backend

Open in browser or use curl:

```bash
curl https://<your-backend-service>.onrender.com/api/health
```

Expected response:

```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "...",
  "uptimeSeconds": 0,
  "database": {
    "status": "up",
    "reachable": true
  }
}
```

### 4.2 Verify Frontend

1. Open your Vercel frontend URL
2. Confirm the app loads
3. Confirm the app makes API requests to the Render backend

If the app fails to load data, verify the frontend env variable `VITE_API_URL`.

### 4.3 Confirm Contract Integration

If `CONTRACT_ID` is missing, the app may still run, but on-chain pledge integration will not function.

Use the backend health endpoint and the frontend deployment status in Vercel to verify end-to-end availability.

---

## 5. Troubleshooting

### Contract deployment failures

- `soroban-cli not installed`: install it from Soroban docs
- `SECRET_KEY` invalid: confirm the secret key belongs to a funded testnet account
- friendbot errors: regenerate the public address and retry
- contract ID not saved: inspect `contracts/contract_id.txt`

### Backend build or start errors

- If build fails, run locally:

```bash
cd backend
npm install
npx tsc -p ./tsconfig.json
```

- If Render cannot start the service:
  - ensure the start command is `node dist/index.js`
  - ensure `CONTRACT_ID` and `SOROBAN_RPC_URL` are set
  - use Render logs to troubleshoot startup errors

### Frontend API errors

- If the frontend shows network failures:
  - verify `VITE_API_URL` uses `https://`
  - confirm the Vercel environment variable is deployed
  - confirm Render backend health check passes at `/api/health`

### CORS errors

- Set `ALLOWED_ORIGINS=https://<your-vercel-domain>` on the backend
- If in development, leave `ALLOWED_ORIGINS` empty so the backend permits local origins

### Data persistence issues

- Backend uses SQLite by default
- Render storage is ephemeral; data may reset on redeploy
- For production, use an external database and add a persistent `DB_PATH`

---

## Quick Test Checklist

1. Contract deployed to testnet and `CONTRACT_ID` saved
2. Render backend service built with `npx tsc -p ./tsconfig.json`
3. Backend started with `node dist/index.js`
4. Render health check path set to `/api/health`
5. Vercel frontend configured with `VITE_API_URL`
6. Frontend loads and fetches data from the backend

If these items pass, the deployment guide has been successfully applied.

## Related Documentation
- [Runbook — Common Operational Tasks](./RUNBOOK.md) — step-by-step procedures for resetting the database, rotating API keys, redeploying contracts, rolling back the backend, and clearing the event cache.
- [Architecture Diagrams](./ARCHITECTURE_DIAGRAMS.md)
- [Contributing Guide](./CONTRIBUTING.md)




