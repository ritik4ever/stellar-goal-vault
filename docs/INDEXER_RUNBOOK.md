# Soroban Event Indexer Runbook

This guide contains playbooks for responding to operational issues with the Soroban Event Indexer in the Stellar Goal Vault backend.

---

## Normal Signals

When the indexer is healthy, you will see the following behavior:

- **Logs**: `soroban_event_indexer_started` at startup, followed by occasional `soroban_event_ingested` logs when new events are found.
- **Metrics/Health (`GET /api/health`)**:
  - `indexer.isHealthy`: `true`
  - `indexer.consecutiveFailures`: `0`
  - `indexer.freshness`: `"fresh"` or `"idle"`
  - `indexer.lagMs`: Fluctuates but generally remains below `SOROBAN_INDEXER_FRESH_LAG_MS` (default 30s) or `SOROBAN_INDEXER_STALE_LAG_MS` (default 5m).
- **Background operation**: The indexer runs automatically without blocking the HTTP API.

---

## Common Failure Signatures and First Actions

| Signal / Symptom | What it usually means | First diagnostic action | Recovery action |
| ---------------- | --------------------- | ----------------------- | --------------- |
| `freshness: "failing"` or `consecutiveFailures > 0` | The indexer cannot reach the Soroban RPC node or the node is rejecting requests. | Run `curl -X POST $SOROBAN_RPC_URL ...` to manually check RPC health. | Check `$SOROBAN_RPC_URL` config. The indexer will auto-recover via exponential backoff when the RPC node is back online. |
| `freshness: "stale"` | The indexer is running without errors, but `lagMs` has exceeded `STALE_LAG_MS` (default 5 min). Usually means the process was down for a long time or the poll interval is too slow. | Check `lagMs` and `lastKnownLedger` vs the network's current ledger. | Wait for the indexer to catch up automatically, or lower `SOROBAN_POLL_INTERVAL_MS` temporarily to speed it up. |
| Missing campaign events | Events occurred on-chain but do not appear in the database. | Search logs for `soroban_event_handle_error` or `kv_store_write_error`. | Restart the backend service. If `CONTRACT_ID` changed, a re-sync or manual database intervention may be needed. |

---

## Diagnostic Commands

**Check current indexer health:**
```bash
curl -s http://localhost:8000/api/health | jq '.indexer'
```

**Check recent indexer errors and backoff logs:**
```bash
journalctl -u stellar-goal-vault-backend --since "1 hour ago" | grep -E "soroban_event_index_error|soroban_indexer_backoff"
```

**Verify RPC connectivity directly:**
```bash
curl -s -X POST "$SOROBAN_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq '.'
```

**Check the last processed ledger in the database:**
```bash
sqlite3 backend/data/campaigns.db "SELECT value FROM kv_store WHERE key = 'soroban_indexer_last_ledger';"
```

---

## Recovery Actions

### 1. Indexer Stuck in Backoff (Failing)

If `consecutiveFailures` is climbing and the RPC is actually healthy:
1.  **Restart the backend** to reset the exponential backoff immediately:
    ```bash
    sudo systemctl restart stellar-goal-vault-backend
    ```
2.  Verify the indexer resumes polling and `consecutiveFailures` stays at `0`.

### 2. High Lag (Stale)

If `freshness` is `"stale"` but `consecutiveFailures` is `0`, the indexer is actively processing a backlog.
1.  **Monitor catch-up**: Query the health endpoint every minute to ensure `lagMs` is decreasing and `lastKnownLedger` is increasing.
2.  **Increase poll frequency**: If catch-up is too slow, adjust the interval:
    ```bash
    echo "SOROBAN_POLL_INTERVAL_MS=5000" >> backend/.env
    sudo systemctl restart stellar-goal-vault-backend
    ```

### 3. Missing Events / Database Errors

If events are not being ingested despite a healthy indexer (e.g., SQLite `SQLITE_BUSY` errors):
1.  Check the database file permissions and ensure the backend can write to it.
    ```bash
    chmod 644 backend/data/campaigns.db
    ```
2.  Restart the backend to clear any dangling connections and force a retry of the current ledger.

## Related Documents
- [HEALTH_RUNBOOK.md](HEALTH_RUNBOOK.md) — Overall service health and DB playbooks
- [OBSERVABILITY.md](OBSERVABILITY.md) — Definitions for indexer metrics and logs
