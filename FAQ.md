# Frequently Asked Questions

Answers to the most common contributor and user questions about **Stellar Goal Vault**.

---

## Table of Contents

1. [How do I get testnet XLM for development and testing?](#1-how-do-i-get-testnet-xlm-for-development-and-testing)
2. [How do I set up Freighter wallet for pledge transactions?](#2-how-do-i-set-up-freighter-wallet-for-pledge-transactions)
3. [How do I deploy the Soroban contract?](#3-how-do-i-deploy-the-soroban-contract)
4. [How do I reset the local development database?](#4-how-do-i-reset-the-local-development-database)
5. [How do I run the load test script?](#5-how-do-i-run-the-load-test-script)
6. [Why does my pledge fail?](#6-why-does-my-pledge-fail)
7. [How do I configure environment variables?](#7-how-do-i-configure-environment-variables)
8. [How do I run the full stack locally with Docker?](#8-how-do-i-run-the-full-stack-locally-with-docker)
9. [How do I run the contract property tests?](#9-how-do-i-run-the-contract-property-tests)
10. [How do I contribute a new feature?](#10-how-do-i-contribute-a-new-feature)

---

### 1. How do I get testnet XLM for development and testing?

Stellar testnet XLM is free and available through the Stellar Laboratory Friendbot.

**Steps:**

1. Create a Stellar testnet account using the [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=testnet).
2. Fund the account using the **Friendbot** button on the same page.
3. Your account will receive 10,000 free testnet XLM.

Alternatively, use the Friendbot API directly:

```bash
curl -X POST "https://friendbot.stellar.org?addr=YOUR_TESTNET_PUBLIC_KEY"
```

**Expected output:**

```json
{
  "_links": {
    "transaction": { "href": "https://horizon-testnet.stellar.org/transactions/..." }
  }
}
```

> **Related:** [Stellar testnet docs](https://developers.stellar.org/docs/learn/fundamentals/networks#testnet)

---

### 2. How do I set up Freighter wallet for pledge transactions?

[Freighter](https://freighter.app) is the Stellar browser extension wallet used to sign pledge transactions.

**Steps:**

1. Install the **Freighter** browser extension (Chrome or Firefox).
2. Open Freighter and click **Create a new wallet**.
3. Save your recovery phrase in a secure location.
4. Click **Settings** → **Network** → switch to **Testnet**.
5. Fund your wallet with testnet XLM (see [FAQ #1](#1-how-do-i-get-testnet-xlm-for-development-and-testing)).
6. Verify connection by opening the app — the wallet widget in the header should show your public key.

**Troubleshooting:**

- If the widget shows "Connect Freighter", click it and approve the connection in the extension.
- Ensure both Freighter and the app are on the same network (Testnet).
- If transactions fail, check that your account has a non-zero XLM balance (minimum reserve is ~1 XLM).

> **Related:** [`frontend/src/services/freighter.ts`](frontend/src/services/freighter.ts) — Freighter integration code

---

### 3. How do I deploy the Soroban contract?

The contract lives in the `contracts/` directory and is deployed via the provided shell script.

**Prerequisites:**

- `soroban-cli` installed (see [soroban.stellar.org](https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli))
- Rust nightly with `wasm32v1-none` target: `rustup target add wasm32v1-none`
- A funded Stellar testnet secret key

**Steps:**

```bash
# From the repository root
SECRET_KEY="S..." ./scripts/deploy.sh
```

**What happens:**

1. The script builds the contract with `soroban contract build`
2. Deploys it to the testnet with `soroban contract deploy`
3. Saves the contract ID to `contracts/contract_id.txt`
4. Prints the contract ID to the console

**After deployment:**

```bash
# Update the backend environment
CONTRACT_ID=$(cat contracts/contract_id.txt)
sed -i "s/^CONTRACT_ID=.*/CONTRACT_ID=$CONTRACT_ID/" backend/.env
```

> **See also:** [RUNBOOK.md — Redeploy the Soroban Contract](./RUNBOOK.md#3-redeploy-the-soroban-contract) for redeployment and rollback procedures.

---

### 4. How do I reset the local development database?

The SQLite database at `backend/data/campaigns.db` stores all campaigns, pledges, and event history.

**Quick reset (deletes all data):**

```bash
# Stop the backend first
docker compose stop backend

# Delete the database file
rm -f backend/data/campaigns.db

# Restart
docker compose start backend
```

**Reset with deterministic seed data:**

```bash
# After deleting the DB (steps above)
cd backend && npx ts-node src/services/seedDeterministic.ts
```

This seeds 3 campaigns (open, funded, claimed) and 2 pledges for reproducible testing.

> **See also:** [RUNBOOK.md — Reset the Dev Database](./RUNBOOK.md#1-reset-the-dev-database) and [`backend/src/services/seedDeterministic.ts`](backend/src/services/seedDeterministic.ts)

---

### 5. How do I run the load test script?

The backend includes an Autocannon-based load test for simulating concurrent traffic.

**Prerequisites:**

- Backend running locally:
  ```bash
  npm run dev:backend
  ```

**Run the default test:**

```bash
cd backend
npm run load:test
```

**Custom test parameters:**

```bash
cd backend
npm run load:test -- \
  --base-url http://127.0.0.1:3001 \
  --connections 20 \
  --duration 20 \
  --campaigns 8 \
  --read-weight 3 \
  --pledge-weight 1
```

**Available flags:**

| Flag              | Default | Description                              |
|-------------------|---------|------------------------------------------|
| `--connections`   | 20      | Number of concurrent connections         |
| `--duration`      | 20      | Test duration in seconds                 |
| `--campaigns`     | 8       | Seed campaigns created before the run    |
| `--read-weight`   | 3       | Relative weight of GET requests          |
| `--pledge-weight` | 1       | Relative weight of POST pledge requests  |
| `--pledge-amount` | 5       | Amount per pledge request                |
| `--asset-code`    | USDC    | Asset code used for seed campaigns       |

**Expected output:**

```
Running 20s test @ http://127.0.0.1:3001
Stat      Avg     Stdev   Max
Latency   12 ms   8 ms    45 ms
Req/Sec   450     35      520
Bytes/Sec 2.1 MB  180 kB  2.5 MB

Non-2xx: 0
Timeouts: 0
```

> **Related:** [`backend/scripts/load-test.js`](backend/scripts/load-test.js) — full script with source

---

### 6. Why does my pledge fail?

Pledge failures typically fall into one of these categories:

**1. Campaign is not in "open" status**

- Campaigns past their deadline or fully funded return an error.
- Check the campaign status: `curl http://localhost:3001/api/campaigns/:id`

**2. Contributor limit reached**

- If the campaign has a `maxPerContributor` set, your total contributions across all pledges cannot exceed that limit.
- Check your current contributions: `curl http://localhost:3001/api/campaigns/:id/contributors`

**3. Invalid request body**

- `contributor` must be a valid Stellar public key (`G...`).
- `amount` must be a positive number.
- Ensure the request body is valid JSON.

**4. Database locked (SQLite contention)**

- SQLite can block under high concurrency. This is expected during load tests but rare under normal use.
- Retry the pledge after a brief wait.

**5. Contract ID mismatch (Freighter flow)**

- If using the Soroban-integrated pledge flow, the backend `CONTRACT_ID` must match the deployed contract.
- Verify: `curl http://localhost:3001/api/config | grep contractId`

> **Related:** [RUNBOOK.md — Clear the Soroban Event Cache](./RUNBOOK.md#5-clear-the-soroban-event-cache) if events appear out of sync

---

### 7. How do I configure environment variables?

**Backend environment** (`backend/.env`):

```env
# Required
CONTRACT_ID=your_deployed_contract_id

# Optional (defaults shown)
PORT=3001
DB_PATH=backend/data/campaigns.db
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
ALLOWED_ASSETS=USDC,XLM,ARS
LOG_LEVEL=info
```

Start by copying the example file:

```bash
cp backend/.env.example backend/.env
```

**Frontend environment** (`frontend/.env`):

```env
VITE_API_URL=http://localhost:3001/api
```

> **Important:** In production, `VITE_API_URL` should point to your deployed backend URL.

**Contract deployment environment:**

- `SECRET_KEY` — Stellar account secret key (required for deploy)
- `NETWORK_PASSPHRASE` — defaults to testnet
- `RPC_URL` — defaults to testnet

> **See also:** [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example)

---

### 8. How do I run the full stack locally with Docker?

Docker Compose runs both the backend and frontend with hot-reload for local development.

**Start everything:**

```bash
docker compose up --build
```

This starts:
- **Backend** at `http://localhost:3001` (with `ts-node-dev` for hot reload)
- **Frontend** at `http://localhost:3000` (with Vite HMR)

**Run in background:**

```bash
docker compose up --build -d
```

**Stop:**

```bash
docker compose down
```

**View logs:**

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

> **Note:** The `docker-compose.override.yml` mounts source directories and enables hot-reload automatically. No extra flags needed.

---

### 9. How do I run the contract property tests?

The Soroban contract includes property-based tests using the `proptest` crate.

**Prerequisites:**

- Rust toolchain installed
- `wasm32v1-none` target: `rustup target add wasm32v1-none`

**Run all contract tests:**

```bash
cd contracts
cargo test
```

**Run property tests only:**

```bash
cd contracts
cargo test property_tests
```

**Run with verbose output:**

```bash
cd contracts
cargo test -- --nocapture
```

**Expected output:**

```
running X tests
test test_multi_token_campaign ... ok
test test_multi_token_refund ... ok
test test_claim_before_deadline ... ok
test test_claim_creator_mismatch ... ok
test test_claim_double_claim ... ok
test test_claim_success ... ok
```

> **Related:** [`contracts/src/test.rs`](contracts/src/test.rs) and [PROPERTY_TESTS_IMPLEMENTATION.md](./PROPERTY_TESTS_IMPLEMENTATION.md)

---

### 10. How do I contribute a new feature?

**Quick start:**

1. **Fork** the repository on GitHub.
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/stellar-goal-vault.git`
3. **Install dependencies:** `npm run install:all`
4. **Create a branch:** `git checkout -b feature/my-feature`
5. Make your changes and **test** them:
   - Backend tests: `cd backend && npx vitest`
   - Contract tests: `cd contracts && cargo test`
   - E2E tests: `npm run test:e2e`
6. **Commit** using conventional commits (e.g., `feat: add new endpoint`).
7. **Push** and open a **Pull Request** against the `main` branch.

**Code style:**

- TypeScript in `backend/` and `frontend/` with ESLint + Prettier
- Rust in `contracts/` with `cargo fmt`
- Pre-commit hooks are configured via Husky + lint-staged

**Where to start:**

- Check the [open issues](https://github.com/ritik4ever/stellar-goal-vault/issues) labelled `good first issue`.
- Browse `OPEN_SOURCE_ISSUES.md` for curated contribution ideas.
- Read the [Contributing Guide](./CONTRIBUTING.md) for detailed setup instructions.

---

*Last updated: 2026-06-01*