#  Deployment Guide

This guide explains how to deploy the **Stellar Goal Vault** project:

- **Backend → Render**
- **Frontend → Vercel**

---

##  Backend Deployment (Render)

### 1. Create a Render Web Service
- Go to https://render.com
- Click **New → Web Service**
- Connect your GitHub repository

---

### 2. Configure the Service

- **Root Directory:** `backend` *(update if your backend folder name differs)*

- **Build Command:**
```bash
npm install && npm run build
```
Start Command:
```bash
npm start
```
### 3. Environment Variables

Add the following variables in Render:
```env
PORT=3000
ALLOWED_ASSETS=USDC,XLM,ARS
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
CONTRACT_ID=your_contract_id
```
### 4. Database Notes 

This project uses SQLite (`better-sqlite3`), which is file-based.

- SQLite does NOT persist reliably on Render
- Data may reset on redeploy

Recommended:
Use a hosted database for production:

- PostgreSQL (Neon, Supabase)
- MongoDB Atlas

### 5. Deployment Tips
- Ensure your Soroban contract is deployed before running backend
- Keep your `CONTRACT_ID` secure
- Confirm API is accessible after deployment


## Frontend Deployment (Vercel)

### 1. Import Project
- Go to https://vercel.com
- Click Add New Project
- Import your GitHub repository

### 2. Configure Project
- Root Directory: `frontend` (update if different)

Build Command:
```bash
npm run build
```
Output Directory:
```bash
dist
```

### 3. Environment Variables
Add:
```env
VITE_API_URL=https://your-backend-url.onrender.com
```

### 4. Deploy

Click Deploy and wait for build to complete.

## Connecting Frontend to Backend
- Deploy backend first
- Copy backend URL from Render
- Set it as `VITE_API_URL` in Vercel
- Redeploy frontend if needed


## Troubleshooting
Backend not responding
- Check logs in Render dashboard
- Confirm environment variables are set correctly

Frontend not calling API
- Verify `VITE_API_URL` is correct
- Ensure backend allows CORS requests

Data not persisting
- This is due to SQLite
- Switch to a hosted database for production

## Summary
- Backend runs on Render using Node.js + Express
- Frontend runs on Vercel using Vite + React
- Environment variables must be configured correctly
- SQLite is suitable for development but not production




