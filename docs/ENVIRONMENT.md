# Environment Variables Reference

This document provides a comprehensive reference of all environment variables used across the Stellar Goal Vault codebase, including backend configuration, frontend configuration, and contract deployment.

---

## Backend Configuration

These variables are defined in the backend service (typically in `backend/.env`). The backend server uses these variables for network configuration, database settings, logging, and security.

| Name | Status | Default | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `CONTRACT_ID` | **Required** | (None) | The Soroban contract ID of the deployed goal-vault contract. | `CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6CYN5` |
| `PORT` | Optional | `3001` | The HTTP port the Express server listens on. | `3001` |
| `LOG_LEVEL` | Optional | `info` | Logging verbosity: `debug` \| `info` \| `warn` \| `error` \| `silent`. | `info` |
| `DB_PATH` | Optional | `backend/data/campaigns.db` | File path to the SQLite database. | `backend/data/campaigns.db` |
| `ALLOWED_ASSETS` | Optional | `USDC,XLM` | Comma-separated list of asset codes accepted by the API. | `USDC,XLM,ARS` |
| `ALLOWED_ORIGINS` | Optional | `*` | Comma-separated origins allowed by CORS. Use `*` to allow all origins in development. | `*` |
| `SOROBAN_RPC_URL` | Optional | `https://soroban-testnet.stellar.org:443` | Soroban RPC endpoint URL. | `https://soroban-testnet.stellar.org:443` |
| `SOROBAN_NETWORK_PASSPHRASE` | Optional | `Test SDF Network ; September 2015` | The passphrase representing the specific Stellar network. | `Test SDF Network ; September 2015` |
| `CONTRACT_AMOUNT_DECIMALS` | Optional | `2` | Decimal scaling between display amounts and on-chain units (stroops). | `2` |
| `DEFAULT_MAX_PER_CONTRIBUTOR` | Optional | `0` | Maximum pledge per contributor across a single campaign (0 = no limit). | `1000` |
| `ASSET_ADDRESSES` | Optional | *See description* | Comma-separated `ASSET_CODE:CONTRACT_ADDRESS` pairs for on-chain asset lookup. Defaults to XLM & USDC testnet addresses. | `XLM:CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6CYN5,USDC:CA6WSTPZ7RRCUC6H37CQFODG763XG2HXP2G6F367VCOGGVDP32P7665E` |
| `NODE_ENV` | Optional | `development` | Node environment: `development` \| `production` \| `test`. | `production` |
| `API_KEYS` | Optional <br>⚠️ **Sensitive** | (None) | Comma-separated list of valid API keys for authentication. Only enforced when `NODE_ENV=production`. | `key1,key2,key3` |
| `REDIS_URL` | Optional <br>⚠️ **Sensitive** | (None) | Redis cache URL for production deployments. Format: `redis://[:password@]host[:port][/db]`. | `redis://localhost:6379` |
| `CACHE_TTL` | Optional | `300` | Cache Time-To-Live in seconds for production API endpoints. | `300` |

---

## Frontend Configuration

These variables are defined in the frontend service (typically in `frontend/.env`).

| Name | Status | Default | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `VITE_API_URL` | Optional | `/api` | HTTP proxy target URL for frontend API calls. Vite proxies requests starting with this path to the backend. | `/api` |

---

## Contract Deployment

These variables are passed to the contract deployment script (`scripts/deploy.sh`) to publish the Soroban smart contract.

| Name | Status | Default | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `SECRET_KEY` | **Required** <br>⚠️ **Sensitive** | (None) | Stellar account secret key used to deploy and initialize the smart contract. | `SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |
| `NETWORK_PASSPHRASE` | Optional | `Test SDF Network ; September 2015` | Target Stellar network passphrase. | `Test SDF Network ; September 2015` |
| `RPC_URL` | Optional | `https://soroban-testnet.stellar.org:443` | Stellar/Soroban RPC URL endpoint. | `https://soroban-testnet.stellar.org:443` |

---

## Secret Rotation Guides

A rotation guide for each sensitive environment variable (secret) in this project is detailed below.

### 1. `SECRET_KEY` (Contract Deployment)

The `SECRET_KEY` is a Stellar private key containing full control over the deployer account and the funds held within it. If this key is compromised, it could lead to complete loss of funds or unauthorized deployment of contracts under your deployer identity.

> [!WARNING]
> If a compromise is suspected, immediately rotate this key!

#### Rotation Procedure:
1. **Generate a new keypair**: Use the Stellar Lab or `stellar keys generate` command to create a new, secure public/private keypair.
2. **Fund the new account**: Ensure the new public key has sufficient native token (XLM) balance on the target network (e.g., testnet or mainnet) to pay for transaction and gas fees.
3. **Update CI/CD or deployment environment**: Replace the old `SECRET_KEY` value in your secure deployment storage, GitHub Actions Secrets, or local secure developer environment variables.
4. **Drain remaining balance**: Transfer any remaining native tokens (XLM) from the old account to the new account.
5. **Revoke access if necessary**: If you have added the old key to multi-signature configurations or access control lists on deployed contracts, update those contracts to authorize the new public key and revoke the old one.

---

### 2. `API_KEYS` (Backend Production Authentication)

The `API_KEYS` variable contains a comma-separated list of strings that represent valid client keys. These are checked by the `apiKeyAuth` middleware in the Express backend when running in production.

#### Rotation Procedure (Zero Downtime):
1. **Generate new keys**: Create one or more new secure random strings to serve as the new API keys.
2. **Append to configuration**: In your production environment configuration (e.g. AWS ECS, Heroku, or production `.env` file), append the new keys to the existing list:
   ```env
   API_KEYS=old_key_1,old_key_2,new_key_1
   ```
3. **Redeploy / Restart backend**: Apply the updated environment variable and restart the backend service. Because both old and new keys are in the active list, clients using the old keys will not experience service disruption.
4. **Update clients**: Safely distribute the new API keys to your client applications, and deploy the updated clients.
5. **Remove old keys**: Once all clients have migrated to the new key, update the backend environment variable again to exclude the old keys:
   ```env
   API_KEYS=new_key_1
   ```
6. **Redeploy / Restart backend**: Restart the backend service to complete the rotation. Old keys will now be rejected.

---

### 3. `REDIS_URL` (Backend Caching)

The `REDIS_URL` specifies the connection string for the backend's Redis cache instance. If it includes authentication details (e.g. `redis://:password@host:port`), it is sensitive.

#### Rotation Procedure:
1. **Update Redis Server Auth**:
   - If using a Redis provider that supports dual password authentication (like Redis Enterprise or AWS ElastiCache with user groups), add a new password alongside the old one.
   - If dual auth is not supported, you must schedule a password change on the Redis server, keeping in mind that there may be brief downtime/errors while the password matches are out of sync.
2. **Update App Config**: Update the `REDIS_URL` environment variable with the new password/connection details on the backend server.
3. **Restart Backend**: Redeploy or restart the Express backend. The application will reconnect to Redis using the new password.
4. **Remove Old Password**: Once the backend is successfully connected, revoke the old password from the Redis server's authorized list.
