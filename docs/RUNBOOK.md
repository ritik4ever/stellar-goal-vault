# Runbook — Common Operational Tasks

This runbook covers day-to-day operational tasks for maintainers of Stellar Goal Vault.

## Health Checks

### Quick Health Check
```bash
# Backend health endpoint
curl http://localhost:3001/api/health

# Expected response: { "status": "ok", "timestamp": ... }
```

### Deep Health Check
```bash
curl http://localhost:3001/api/health/deep
# Returns: backend version, DB connection status, contract version
```

## Data Management

### Reset Local Database
```bash
rm -f backend/data/campaigns.db
# The database will be recreated on next server start
```

### Backup Database
```bash
cp backend/data/campaigns.db backend/data/campaigns.db.$(date +%Y%m%d-%H%M%S).bak
```

### Restore Database
```bash
cp backend/data/campaigns.db.backup backend/data/campaigns.db
```

## Running Tests

### All Tests
```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test

# Contracts
cd contracts && cargo test
```

### Integration Tests
```bash
cd backend && npm run test:integration
```

### Specific Test File
```bash
cd backend && npx vitest run src/services/campaignStore.test.ts
```

## Contract Operations

### Build Contract
```bash
cd contracts && cargo build --target wasm32-unknown-unknown --release
```

### Deploy Contract (Testnet)
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_goal_vault.wasm \
  --source <DEPLOYER_SECRET_KEY> \
  --network testnet
```

### Initialize Contract
```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <MAINTAINER_KEY> \
  --network testnet \
  -- \
  initialize \
  --fee_recipient <FEE_ADDRESS>
```

## Monitoring & Debugging

### View Backend Logs
```bash
# Structured logs (JSON format)
tail -f backend/logs/app.log | jq .
```

### Check API Endpoints
```bash
# List all campaigns
curl http://localhost:3001/api/campaigns

# Get single campaign
curl http://localhost:3001/api/campaigns/<ID>

# Campaign stats
curl http://localhost:3001/api/stats
```

### Environment Validation
```bash
node backend/src/validateEnv.js
# Reports missing or invalid environment variables
```

## Incident Response

### Backend Not Starting
1. Check `.env` file exists and has required variables
2. Verify database is not corrupted: `sqlite3 backend/data/campaigns.db "PRAGMA integrity_check;"`
3. Check port availability: `lsof -i :3001`
4. Review startup logs for error messages

### Frontend Not Loading
1. Verify backend is running
2. Check browser console for CORS errors
3. Verify `VITE_API_URL` environment variable
4. Clear browser cache and reload

### Contract Errors
1. Verify network connectivity to Soroban RPC
2. Check contract ID matches deployed version
3. Ensure account has sufficient XLM for fees
4. Review Soroban RPC logs

## Scheduled Tasks

### Expiration Job
The expiration job runs every 5 minutes to check for campaigns past deadline.
```bash
# Trigger manually
curl -X POST http://localhost:3001/api/jobs/check-expirations
```

### Backup Schedule
It is recommended to:
- Take daily database backups
- Keep 7 days of backups
- Test restoration at least once per month

## Recovery Procedures

### Full System Recovery
1. Restore database from latest backup
2. Rebuild frontend: `cd frontend && npm run build`
3. Restart backend: `cd backend && npm start`
4. Verify health endpoints
5. Run integration tests
