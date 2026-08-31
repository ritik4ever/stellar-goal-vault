# Troubleshooting Guide

This guide covers common issues encountered while developing, building, or running the application.

## 1. SQLite File Permission Errors
**Symptom**: `Error: SQLITE_CANTOPEN: unable to open database file` when starting the backend.
**Cause**: The process running the backend does not have write permissions to the directory where the SQLite database file is stored or to the file itself.
**Fix**: Grant appropriate read/write permissions to the database file and its parent directory.
```bash
chmod 755 backend/data
chmod 644 backend/data/campaigns.db
```

## 2. Soroban CLI Version Mismatch
**Symptom**: `error: Found argument '--network' which wasn't expected` or unexpected CLI behavior when deploying contracts.
**Cause**: You have an outdated or newer version of the Soroban CLI installed globally that is incompatible with the project's contract scripts.
**Fix**: Install the specific version of Soroban CLI required by the project using cargo.
```bash
cargo install --locked --version 20.0.0 soroban-cli
```

## 3. Freighter Connection Issues
**Symptom**: "Freighter is not installed" or "Connection rejected" in the web application.
**Cause**: The Freighter browser extension is not installed, the user denied the connection request, or the extension is locked.
**Fix**: Reset the local network configuration via CLI to ensure proper testnet connections if local accounts are used.
```bash
stellar network add --global testnet --rpc-url https://soroban-testnet.stellar.org:443
```

## 4. CORS Errors
**Symptom**: `Access to fetch at 'http://localhost:8000/api/...' from origin 'http://localhost:3000' has been blocked by CORS policy.`
**Cause**: The backend server is not configured to allow cross-origin requests from the frontend development server.
**Fix**: Update your backend environment variables to allow the frontend origin, or restart the backend with CORS enabled.
```bash
export CORS_ALLOWED_ORIGINS="http://localhost:3000"
npm run dev --prefix backend
```

## 5. Contract ID Not Set
**Symptom**: `Error: Contract ID not configured` when attempting to invoke a contract function from the frontend.
**Cause**: The compiled contract ID is missing from the environment configuration files.
**Fix**: Rebuild the contracts and copy the generated contract ID into your backend `.env` file.
```bash
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/contract.wasm --source account > backend/.env.contract
```

## 6. Node Version Mismatch
**Symptom**: `SyntaxError: Unexpected token '?'` or package installation failures during `npm install`.
**Cause**: You are using an unsupported version of Node.js.
**Fix**: Switch to the recommended Node.js version (e.g., v18 or v20) using nvm.
```bash
nvm install 18
nvm use 18
```

## 7. Docker Daemon Not Running
**Symptom**: `Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?`
**Cause**: The Docker background service is not running on your host machine.
**Fix**: Start the Docker service systemd.
```bash
sudo systemctl start docker
sudo systemctl enable docker
```

## 8. Environment Variables Not Loaded
**Symptom**: Application starts but immediately crashes with missing configuration errors.
**Cause**: The `.env` file is missing or not being properly sourced in the backend directory.
**Fix**: Copy the example environment file and populate it.
```bash
cp backend/.env.example backend/.env
```

## 9. Network Timeout on Testnet
**Symptom**: `Timeout waiting for transaction confirmation` when interacting with the Stellar Testnet.
**Cause**: Network congestion or the RPC node is temporarily unreachable.
**Fix**: Ping the RPC endpoint to check availability.
```bash
curl -X POST "https://soroban-testnet.stellar.org:443" -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}'
```

## 10. Insufficient Funds in Testnet Account
**Symptom**: `op_underfunded` or `tx_insufficient_balance` when submitting a transaction.
**Cause**: The account signing the transaction does not have enough XLM to cover the network fees and minimum balance requirements.
**Fix**: Fund your account using the Stellar Friendbot.
```bash
curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
```
