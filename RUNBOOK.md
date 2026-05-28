# Runbook: Common Operational Tasks

## Prerequisites

- Access to the production server or deployment platform
- Environment variables for backend, frontend, and contracts
- Stellar CLI installed for contract operations
- GitHub Actions or Render/Vercel admin access

---

## 1. Reset Dev Database

### When to use
- Local development environment needs a clean state
- Test data has become inconsistent during development

### Steps
```bash
# Stop the backend if running
cd backend

# Delete the SQLite database file
rm -f data/database.sqlite

# Restart the backend (creates fresh database with schema)
npm run dev
```

### Expected output
- Backend logs "Database initialized successfully"
- API endpoints return empty data

---

## 2. Rotate API Key

### When to use
- API key has been compromised
- Scheduled key rotation (recommended every 90 days)

### Steps
1. Generate new key:
   ```bash
   openssl rand -hex 32
   ```
2. Update the environment variable in your deployment platform
3. Redeploy the backend service
4. Update all clients that use the old key

### Verification
```bash
curl -H "Authorization: Bearer NEW_KEY" http://localhost:3001/api/health
# Expected: 200 OK
```

---

## 3. Redeploy Soroban Contract

### When to use
- Contract logic has changed
- Testnet contract was reset

### Steps
```bash
cd contracts

# Build the contract
cargo build --target wasm32-unknown-unknown --release

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_goal_vault.wasm \
  --source $SOROBAN_SECRET_KEY \
  --network testnet

# Save the new contract ID
echo "NEW_CONTRACT_ID" > contract_id.txt
```

### Verification
```bash
stellar contract invoke \
  --id $(cat contract_id.txt) \
  --source $SOROBAN_SECRET_KEY \
  --network testnet \
  -- \
  get_campaign \
  --campaign_id 0
```

---

## 4. Roll Back Backend

### When to use
- A deployment introduces a critical bug
- Performance regression after a release

### Steps
1. Identify the last stable release:
   ```bash
   git tag --list | sort -V
   ```
2. Checkout and deploy the stable version:
   ```bash
   git checkout v0.1.0
   cd backend && npm ci && npm run build
   ```
3. Update the deployment to point to the stable build
4. Verify health endpoint returns 200

---

## 5. Clear Soroban Event Cache

### When to use
- Events are stale or duplicated
- After a contract redeployment
- Event reconciliation is out of sync

### Steps
```bash
cd backend

# Connect to SQLite
sqlite3 data/database.sqlite

# Clear the events table
DELETE FROM soroban_events;

# Exit SQLite
.quit

# Restart the backend
npm run dev
```

### Verification
Check the events API:
```bash
curl http://localhost:3001/api/events?limit=1
# Expected: Empty array []
```

---

## 6. Restart All Services (Docker)

### When to use
- System-wide restart needed
- After environment variable changes

### Steps
```bash
docker compose down
docker compose up --build -d

# Check logs
docker compose logs -f
```

### Verification
```bash
curl http://localhost:3001/api/health
# Expected: {"status": "ok"}
```

---

## Emergency Contacts

| Issue Type | Contact | Response Time |
|------------|---------|--------------|
| Security incident | ritik4ever@example.com | Immediate |
| Production outage | GitHub Issues (urgent label) | 1 hour |
| Contract failure | Stellar Developer Discord | 4 hours |

---

## Related Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Full deployment guide
- [SECURITY.md](./SECURITY.md) - Security policies and procedures
- [FAQ.md](./FAQ.md) - Frequently asked questions
