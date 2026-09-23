# Health Check Runbook

Operator reference for the two health endpoints exposed by the Stellar Goal Vault backend.
Each section maps a documented signal to a concrete diagnostic command and a recovery action.

---

## Endpoints

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /api/health` | Shallow check — DB reachability + indexer liveness | None |
| `GET /api/health/deep` | Deep check — DB + Soroban RPC + CONTRACT_ID + indexer | None |

Both endpoints return HTTP **200** when healthy and **503** when degraded.

---

## Shallow Health Response (`GET /api/health`)

```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "2026-09-23T21:54:05.678Z",
  "uptimeSeconds": 3600.123,
  "database": {
    "status": "up",
    "reachable": true
  },
  "indexer": {
    "lastSuccessfulPollTime": 1727128400000,
    "lastKnownLedger": 54321,
    "isHealthy": true,
    "consecutiveFailures": 0,
    "lagMs": 8500
  },
  "memory": {
    "rss": 75497472,
    "heapUsed": 42598400,
    "heapTotal": 67108864,
    "external": 2097152
  }
}
```

### Normal signal ranges

| Field | Normal | Investigate |
|-------|--------|-------------|
| `status` | `"ok"` | `"degraded"` → HTTP 503 |
| `database.status` | `"up"` | `"down"` |
| `indexer.isHealthy` | `true` | `false` |
| `indexer.consecutiveFailures` | `0` | `≥ 3` |
| `indexer.lagMs` | `< 60 000` (< 1 min) | `> 300 000` (> 5 min) |
| `memory.heapUsed` | `< 200 MB` | `> 400 MB` → potential leak |
| `memory.rss` | `< 300 MB` | `> 600 MB` → investigate |

---

## Deep Health Response (`GET /api/health/deep`)

```json
{
  "overall": "up",
  "timestamp": "2026-09-23T21:54:05.678Z",
  "uptimeSeconds": 3600.123,
  "memory": {
    "rss": 75497472,
    "heapUsed": 42598400,
    "heapTotal": 67108864,
    "external": 2097152
  },
  "components": {
    "db":       { "status": "up",   "details": "SQLite database reachable" },
    "soroban":  { "status": "up",   "details": "Soroban RPC reachable" },
    "contract": { "status": "up",   "details": "CONTRACT_ID configured" },
    "indexer":  { "status": "up",   "details": { ... } }
  }
}
```

---

## Signal → Diagnostic → Recovery Playbooks

### 1. `database.status: "down"` / `database.reachable: false`

**What it means:** The SQLite probe (`SELECT 1`) threw an exception. The database file is either missing, locked, or the process lost its handle.

**Diagnosis**

```bash
# Check the error field returned by the health endpoint
curl -s http://localhost:3001/api/health | jq '.database.error'

# Verify the file exists and is writable
ls -lah backend/data/campaigns.db

# Look for lock-holder processes
lsof | grep campaigns.db

# Check recent backend logs for SQLITE_CANTOPEN / SQLITE_BUSY
journalctl -u stellar-goal-vault-backend --since "10 minutes ago" | grep -i sqlite
```

**Recovery**

```bash
# 1. Fix permissions (most common cause)
chmod 755 backend/data
chmod 644 backend/data/campaigns.db

# 2. If the file is missing (first run / volume not mounted)
mkdir -p backend/data
# Then restart — initDb() will recreate it on startup

# 3. Restart the service to drop dangling connections
sudo systemctl restart stellar-goal-vault-backend

# 4. If the WAL file is corrupted
sqlite3 backend/data/campaigns.db "PRAGMA integrity_check;"
# If corruption is confirmed, restore from backup and restart
```

See also: [RUNBOOK.md — SQLite Lock Contention](../RUNBOOK.md#1-sqlite-lock-contention)

---

### 2. `indexer.isHealthy: false` / `indexer.consecutiveFailures ≥ 1`

**What it means:** One or more Soroban RPC poll cycles have failed. The indexer applies exponential backoff so the next poll could be delayed up to 5 minutes.

**Diagnosis**

```bash
# Check current indexer status snapshot
curl -s http://localhost:3001/api/health | jq '.indexer'

# Review log lines emitted on each backoff
journalctl -u stellar-goal-vault-backend --since "30 minutes ago" \
  | grep -E "soroban_event_index_error|soroban_indexer_backoff"

# Manually probe the Soroban RPC endpoint
curl -s -X POST "$SOROBAN_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq '.'
```

**Recovery**

```bash
# 1. If the RPC URL is misconfigured, correct it and restart
#    Edit backend/.env: SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443
sudo systemctl restart stellar-goal-vault-backend

# 2. If the RPC is temporarily unavailable (testnet outage):
#    Wait — the indexer will recover automatically once the RPC is reachable.
#    Monitor consecutiveFailures going back to 0 via the health endpoint.

# 3. If the indexer is stuck and consecutiveFailures keeps climbing:
#    Restart the service to force an immediate retry
sudo systemctl restart stellar-goal-vault-backend

# 4. Check the Stellar testnet status page
curl -s https://status.stellar.org/api/v2/status.json | jq '.status.description'
```

**Normal-but-elevated lag:** `lagMs > 60 000` after a pod restart is expected while the indexer catches up from the last-known ledger. Confirm `consecutiveFailures` is `0` and the lag is decreasing.

---

### 3. `indexer.lagMs` is very high (> 5 minutes)

**What it means:** The indexer is running (no errors) but is far behind the chain. This can mean the process was down for an extended period, or the poll interval is too aggressive relative to RPC throttling.

**Diagnosis**

```bash
# Check how far behind we are
curl -s http://localhost:3001/api/health | jq '{lagMs: .indexer.lagMs, lastKnownLedger: .indexer.lastKnownLedger}'

# Check current ledger from RPC
curl -s -X POST "$SOROBAN_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq '.result.sequence'
```

**Recovery**

```bash
# The indexer will catch up automatically. If you want to speed up catch-up,
# increase poll frequency (lower value = more frequent polling):
#   SOROBAN_POLL_INTERVAL_MS=5000 in backend/.env
# Restart to apply:
sudo systemctl restart stellar-goal-vault-backend
```

---

### 4. `components.soroban.status: "down"` (deep check only)

**What it means:** The `getHealth` JSON-RPC call to `SOROBAN_RPC_URL` timed out or returned HTTP 5xx.

**Diagnosis**

```bash
# Direct probe — look at the raw response
curl -v -X POST "$SOROBAN_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Check if the env variable is set correctly
grep SOROBAN_RPC_URL backend/.env
```

**Recovery**

```bash
# 1. If SOROBAN_RPC_URL is empty or wrong, set it and restart
#    Testnet default: https://soroban-testnet.stellar.org:443
echo "SOROBAN_RPC_URL=https://soroban-testnet.stellar.org:443" >> backend/.env
sudo systemctl restart stellar-goal-vault-backend

# 2. If testnet is having an outage, this is informational only.
#    The API continues to serve local data. Monitor status.stellar.org.
```

---

### 5. `components.contract.status: "down"` (deep check only)

**What it means:** `CONTRACT_ID` environment variable is not set. Freighter-backed pledge signing will not work, but the REST API continues to operate.

**Diagnosis**

```bash
curl -s http://localhost:3001/api/health/deep | jq '.components.contract'

# Verify the env var
grep CONTRACT_ID backend/.env
```

**Recovery**

```bash
# Deploy the contract (see DEPLOYMENT.md) and set the output ID
export SECRET_KEY="S..."
npm run deploy:contract

# Copy the printed contract ID into backend/.env
echo "CONTRACT_ID=<printed_contract_id>" >> backend/.env
sudo systemctl restart stellar-goal-vault-backend
```

---

### 6. `memory.heapUsed` growing over time

**What it means:** The Node.js heap is not being garbage-collected efficiently. Sustained growth without stabilization suggests a memory leak.

**Diagnosis**

```bash
# Poll the health endpoint every 30s and watch heapUsed
watch -n 30 "curl -s http://localhost:3001/api/health | jq '.memory.heapUsed / 1048576 | . * 100 | round / 100 | tostring + \" MB\"'"

# Check if the OOM killer has already acted
dmesg -T | grep -i oom | tail -5

# Inspect top consumers on the host
top -o %MEM -b -n 1 | head -20
```

**Recovery**

```bash
# 1. Restart to reclaim memory immediately
sudo systemctl restart stellar-goal-vault-backend

# 2. If OOM kills are frequent, add temporary swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 3. Capture a heap snapshot for offline analysis (requires --inspect flag)
#    Connect Chrome DevTools to the running process for a live heap snapshot.
```

See also: [RUNBOOK.md — Backend OOM](../RUNBOOK.md#2-backend-oom-out-of-memory)

---

### 7. `status: "degraded"` / HTTP 503 from shallow endpoint

**What it means:** At least one of `database.reachable` or `indexer.isHealthy` is false. The API is still running but in a degraded state.

**Diagnosis**

```bash
# Check which component is failing
curl -s http://localhost:3001/api/health | jq '{status, database, indexer: {isHealthy: .indexer.isHealthy, consecutiveFailures: .indexer.consecutiveFailures}}'
```

Follow the appropriate playbook above depending on which component shows failure:
- Database → [Playbook 1](#1-databasestatus-down--databasereachable-false)
- Indexer → [Playbook 2](#2-indexerashealthy-false--indexerconsecutivefailures--1)

---

### 8. `overall: "down"` from deep endpoint when shallow reports `"ok"`

**What it means:** The DB and indexer are healthy, but either `CONTRACT_ID` is unset or the Soroban RPC is unreachable. The API and campaign operations continue normally; only on-chain features are affected.

**Diagnosis**

```bash
curl -s http://localhost:3001/api/health/deep | jq '.components'
```

Follow [Playbook 4](#4-componentsssorobanstatus-down-deep-check-only) or [Playbook 5](#5-componentscontractstatus-down-deep-check-only) as applicable.

---

## Quick Reference

```bash
# One-liner for shallow health with key signals
curl -s http://localhost:3001/api/health \
  | jq '{status, dbUp: .database.reachable, indexerOk: .indexer.isHealthy, failures: .indexer.consecutiveFailures, lagMs: .indexer.lagMs, heapMB: (.memory.heapUsed / 1048576 | round)}'

# One-liner for deep health component summary
curl -s http://localhost:3001/api/health/deep \
  | jq '{overall, db: .components.db.status, soroban: .components.soroban.status, contract: .components.contract.status, indexer: .components.indexer.status}'
```

---

## Related Documents

- [RUNBOOK.md](../RUNBOOK.md) — SQLite lock contention, OOM, campaign status sync, contract failures
- [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) — SQLite permissions, Soroban CLI, CORS, env vars
- [docs/SECURE_CONFIGURATION.md](SECURE_CONFIGURATION.md) — Production environment variable reference
- [DEPLOYMENT.md](../DEPLOYMENT.md) — Deploying the contract and backend to testnet/production
