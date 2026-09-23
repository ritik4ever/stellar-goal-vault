# Production Incident Runbook

This runbook contains playbooks for responding to common production incidents in the Stellar Goal Vault environment. It is designed to allow on-call engineers to diagnose and remediate issues quickly.

---

## 1. SQLite Lock Contention

### Symptoms

- High latency or timeouts on API endpoints requiring write access.
- Backend logs showing `database is locked` or `SQLITE_BUSY` errors.
- Increased HTTP 500 errors.

### Diagnosis Commands

Check the backend logs for SQLite lock errors:

```bash
journalctl -u stellar-goal-vault-backend --since "1 hour ago" | grep "database is locked"
```

Check for long-running transactions by inspecting active connections (if using a specialized tool) or by monitoring disk I/O on the database file:

```bash
lsof | grep stellar_vault.db
```

Monitor CPU and wait times:

```bash
iostat -x 1 10
```

### Remediation Steps

1.  **Restart Backend (Mitigation):** If the application is completely stuck, a restart can drop dangling connections holding the lock.
    ```bash
    sudo systemctl restart stellar-goal-vault-backend
    ```
2.  **Optimize WAL / Busy Timeout:** Ensure that the application connects to SQLite with WAL mode enabled and an appropriate busy timeout (e.g., `5000` ms).
3.  **Identify Offending Query:** Review the logs preceding the lock errors to identify the long-running transaction or report generation query and kill or optimize it.

---

## 2. Backend OOM (Out Of Memory)

### Symptoms

- The backend service restarts unexpectedly.
- Uptime metrics drop intermittently.
- Alerts triggered for high memory usage on the backend node.

### Diagnosis Commands

Check system logs for OOM killer invocations:

```bash
dmesg -T | grep -i oom
```

Or check the syslog:

```bash
grep -i "killed process" /var/log/syslog
```

Check current memory usage and top memory-consuming processes:

```bash
free -h
top -o %MEM -b -n 1 | head -n 15
```

### Remediation Steps

1.  **Restart Backend:** If the service is thrashing or in a degraded state, restart it to clear memory.
    ```bash
    sudo systemctl restart stellar-goal-vault-backend
    ```
2.  **Temporary Swap:** If the instance is critically low on memory, add a temporary swap file to prevent immediate recurring OOMs.
    ```bash
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    ```
3.  **Scale Up:** If memory exhaustion is due to legitimate increased load rather than a leak, provision a larger instance size for the backend.
4.  **Investigate Leaks:** Extract a heap dump (if applicable to the runtime) and analyze it offline to find memory leaks.

---

## 3. Campaign Status Inconsistency

### Symptoms

- Users report discrepancies in campaign funding status.
- The API returns a campaign as "Active", but the on-chain contract considers it "Closed" or "Failed".
- Mismatch between local database state and blockchain state.

### Diagnosis Commands

Query the local database state for a specific campaign ID:

```bash
sqlite3 /var/lib/stellar-goal-vault/stellar_vault.db "SELECT id, status, on_chain_id FROM campaigns WHERE id = '<CAMPAIGN_ID>';"
```

Query the blockchain state for the same campaign (replace `<CONTRACT_ADDRESS>` and `<NETWORK>` accordingly):

```bash
stellar contract invoke --id <CONTRACT_ADDRESS> --network <NETWORK> -- get_campaign --id <ON_CHAIN_ID>
```

### Remediation Steps

1.  **Trigger State Sync:** Manually invoke the backend's admin endpoint to resync the campaign state with the blockchain.
    ```bash
    curl -X POST http://localhost:8080/admin/api/campaigns/<CAMPAIGN_ID>/sync \
         -H "Authorization: Bearer $ADMIN_TOKEN"
    ```
2.  **Manual Database Override (Emergency Only):** If the sync endpoint fails and the discrepancy is blocking critical flows, manually update the local DB (ensure you backup the DB first).
    ```bash
    cp /var/lib/stellar-goal-vault/stellar_vault.db /var/lib/stellar-goal-vault/stellar_vault.db.bak
    sqlite3 /var/lib/stellar-goal-vault/stellar_vault.db "UPDATE campaigns SET status = 'Closed' WHERE id = '<CAMPAIGN_ID>';"
    ```
3.  **Investigate Indexer:** Check if the background worker/indexer responsible for catching blockchain events is running and healthy.
    ```bash
    journalctl -u stellar-goal-vault-indexer --since "1 hour ago"
    ```

---

## 4. Contract Invocation Failure

### Symptoms

- Users are unable to pledge, create campaigns, or claim funds.
- Transactions are failing or being rejected by the Stellar network.
- Backend logs show `tx_failed`, `insufficient_fee`, or `op_bad_auth`.

### Diagnosis Commands

Check the backend logs for transaction submission errors:

```bash
journalctl -u stellar-goal-vault-backend --since "30 minutes ago" | grep -i "transaction failed"
```

Check the Soroban RPC health and sequence number of the submitter account (if the backend signs transactions):

```bash
curl -X POST http://localhost:8000/soroban/rpc -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

### Remediation Steps

1.  **Fund Submitter Account:** If the error is related to insufficient balances or fees for the backend's fee-paying account, fund the account.
2.  **Increase Base Fee:** If the network is congested, update the backend configuration to use a higher base fee and restart.
    ```bash
    sed -i 's/BASE_FEE=100/BASE_FEE=1000/g' /etc/stellar-goal-vault/.env
    sudo systemctl restart stellar-goal-vault-backend
    ```
3.  **Check Contract Upgrades:** Verify if the contract was recently upgraded and if the backend is using the correct, up-to-date contract ID and SDK.
4.  **Network Outage:** Check the Stellar status page (status.stellar.org) for broader network issues.

---

## 5. Service Metrics Troubleshooting

Service metrics should be interpreted alongside the backend health endpoints. A healthy service usually reports `status: "ok"`, `database.reachable === true`, `indexer.isHealthy === true`, and an `uptimeSeconds` value that continues to rise over time. When a metric drifts outside that pattern, the goal is to verify the signal, isolate the failing dependency, and recover quickly with the smallest possible change.

### Normal Signals

- `GET /api/health` returns `200` with `status: "ok"` and an `uptimeSeconds` value that keeps increasing.
- `GET /api/health/deep` returns `overall: "up"` and marks `db`, `soroban`, `contract`, and `indexer` as `up`.
- CPU, memory, and request latency remain within the normal baseline for the current deployment size.

### Common Failure Signatures and First Actions

| Signal                                                                    | What it usually means                                                                                                   | First diagnostic action                                                                                                                                    | Recovery action                                                                                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health` returns `503` while `uptimeSeconds` is still increasing | The backend process is alive but a dependency is degraded; the most common issue is a failed database or indexer check. | Run `curl -fsS http://localhost:8080/api/health/deep` and read the `components` section.                                                                   | Restore the failed dependency before restarting the API if possible; if the DB or indexer is unhealthy, investigate logs and recover the service in that order. |
| `GET /api/health/deep` shows `db: "down"`                                 | SQLite is unreachable or the database file is locked or unreadable.                                                     | Run `sqlite3 <DB_PATH> 'PRAGMA integrity_check;'` and check `journalctl -u stellar-goal-vault-backend --since "30 minutes ago"                             | grep -i "database\|sqlite"`.                                                                                                                                    | Repair the database file, clear stale locks, or restart the backend service after confirming the database path and file permissions are correct. |
| `soroban: "down"` or RPC timeouts in `/api/health/deep`                   | The backend cannot reach the configured Soroban RPC endpoint or the RPC node is degraded.                               | `curl -X POST "$SOROBAN_RPC_URL" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'` and check the configured RPC URL. | Fail over to a healthy RPC node or restore connectivity; verify that the RPC URL and credentials are correct before restarting the backend.                     |
| `contract: "down"`                                                        | The backend is running without a valid contract ID in configuration.                                                    | Check `echo $CONTRACT_ID` or the backend environment file for a configured contract ID.                                                                    | Reuse the active contract ID from the deployment artifact or redeploy the contract and update the backend configuration.                                        |
| `indexer: "down"`                                                         | The background event indexer is failing or has stopped polling.                                                         | Inspect `journalctl -u stellar-goal-vault-indexer --since "1 hour ago"` and compare the last successful sync time in the app logs.                         | Restart the indexer, confirm the poller is running, and verify the worker can reach the network and database again.                                             |
| Sustained high CPU or memory while request latency increases              | The service is under load or the process is leaking memory.                                                             | Run `top -o %CPU -b -n 1`, `free -h`, and `ps -o pid,pcpu,pmem,comm -C node` while capturing the `request` latency from the health or load-test metrics.   | Scale the backend, reduce the burst rate, and inspect for memory leaks or runaway background work before re-enabling normal traffic.                            |
| p99 latency or error rate rises without a full outage                     | Traffic is spiking or a dependency is slowing down responses.                                                           | Compare current latency percentiles against the normal baseline and check the failing route in the application logs.                                       | Reduce traffic, identify the slow path, and confirm the DB/RPC dependency is healthy before returning to the previous capacity.                                 |

### Diagnosis Commands

Check the live health view first:

```bash
curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/api/health/deep
```

Watch the service while it is degraded:

```bash
watch -n 5 'curl -fsS http://localhost:8080/api/health/deep | jq'
```

Inspect the node resource usage that corresponds to the metric drift:

```bash
free -h
top -o %CPU -b -n 1 | head -n 20
ps -o pid,pcpu,pmem,comm -C node
```

Review the service and dependency logs:

```bash
journalctl -u stellar-goal-vault-backend --since "30 minutes ago" | tail -n 200
journalctl -u stellar-goal-vault-indexer --since "30 minutes ago" | tail -n 200
```

### Remediation Steps

1.  **Confirm the service state:** Always start with the health endpoints and identify which component is degraded before changing anything.
2.  **Isolate the failing dependency:** Triage `db`, `soroban`, `contract`, and `indexer` in order; each one maps to a different recovery path.
3.  **Recover in the narrowest scope:** If the issue is isolated to the indexer or RPC dependency, restart just that component instead of restarting unrelated services.
4.  **Validate the fix:** Re-run the health endpoints and confirm that `status` returns `ok` or the `overall` status returns `up` before returning traffic to normal.

This guide should be used with the service-level alarms already defined in the deployment stack: sustained `503` responses, rising `p99` latency, and degraded component checks are all actionable signals and should trigger an immediate operator review.
