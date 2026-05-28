# Deployment Guide

This guide covers deploying the Stellar Goal Vault stack to production.

## Prerequisites

- A [Vercel](https://vercel.com) account for the frontend
- A [Render](https://render.com) account for the backend
- A Stellar testnet or mainnet account with funded XLM
- Node.js 18+ and npm

## Environment Variables

### Backend (Render)

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | HTTP port (default: 3001) | No |
| `NODE_ENV` | `production` | Yes |
| `CONTRACT_ID` | Soroban contract ID | Yes |
| `ALLOWED_ASSETS` | Comma-separated asset codes (default: USDC,XLM) | No |
| `SOROBAN_RPC_URL` | Stellar RPC endpoint | No |
| `SOROBAN_NETWORK_PASSPHRASE` | Network passphrase | No |
| `LOG_LEVEL` | Logging verbosity (default: info) | No |
| `DB_PATH` | SQLite database path | No |

### Frontend (Vercel)

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_API_URL` | Backend API base URL | Yes |

## Step 1: Deploy the Backend to Render

1. Log into [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub repository containing `ritik4ever/stellar-goal-vault`
4. Configure:
   - **Name:** `stellar-goal-vault-backend`
   - **Region:** Choose closest to your users
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Build Command:** `npm ci && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** Starter (free tier works for development)
5. Add environment variables from the table above
6. Click **Create Web Service**

### Backend Health Check

After deployment, verify the health endpoint:
```bash
curl https://your-backend.onrender.com/api/health
```

Expected response:
```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "uptimeSeconds": 123.456,
  "database": { "reachable": true }
}
```

## Step 2: Deploy the Frontend to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Log in: `vercel login`
3. From the repository root:
   ```bash
   cd frontend
   vercel --prod
   ```
4. Follow the prompts to link your project
5. Set `VITE_API_URL` to your Render backend URL:
   ```bash
   vercel env add VITE_API_URL
   ```
6. Redeploy: `vercel --prod`

Alternatively, connect via [Vercel Dashboard](https://vercel.com):
1. Click **Add New** → **Project**
2. Import your GitHub repo
3. Set **Root Directory** to `frontend`
4. Add `VITE_API_URL` environment variable
5. Click **Deploy**

## Step 3: Deploy the Soroban Contract

```bash
# Fund your deployer account (if not already funded)
stellar account fund --alias deployer

# Build the contract
cd contracts
cargo build --target wasm32-unknown-unknown --release

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_goal_vault.wasm \
  --source deployer \
  --network testnet
```

Copy the returned contract ID and set it as `CONTRACT_ID` on your Render backend.

## Troubleshooting

### Backend fails to start
- Verify `CONTRACT_ID` is set and valid
- Check Render logs for startup errors
- Ensure all required env vars are configured

### Frontend cannot reach backend
- Verify `VITE_API_URL` includes the protocol (`https://`)
- Check CORS settings in backend env (`ALLOWED_ORIGINS`)
- Ensure the backend service is running

### Contract deployment fails
- Ensure you have sufficient XLM for the deploy fee (~1 XLM for testnet)
- Verify the Rust `wasm32-unknown-unknown` target is installed
- Check the contract compiles with `cargo build`
