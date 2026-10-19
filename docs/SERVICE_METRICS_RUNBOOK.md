# Service Metrics Troubleshooting Runbook

Operator reference for diagnosing missing, stale, or unexpected backend service metrics.

## Signals and limits

The backend does not expose a Prometheus-compatible `/metrics` endpoint or an in-process
metrics registry. Its campaign aggregates are available as JSON from `GET /api/stats` in
the `data` object. This endpoint is public and does not require an API key.

`GET /api/stats` reports campaign and pledge totals, contributor counts, and average funding
rate. These are database aggregates, not request-rate or latency measurements. Pledge volume
is reported separately for USDC and XLM; `totalPledgeVolume` sums stored pledge amounts and
should not be treated as a currency-normalized value.

Use `GET /api/health` for database and indexer state, and structured request logs for HTTP
status and duration. The `/api/stats` route uses a 60-second cache when the application cache
is available. Cached responses include `X-Cache: HIT`; freshly computed responses include
`X-Cache: MISS`. When caching is unavailable, the response may have neither header.

## Quick checks

Set `BASE_URL` to the backend origin (the local default port is `3001`):

```bash
BASE_URL=${BASE_URL:-http://localhost:3001}

# Inspect the HTTP status, cache header, and response body
curl -sS -i "$BASE_URL/api/stats"

# Print the aggregate metric payload
curl -fsS "$BASE_URL/api/stats" | jq '.data'

# Check database, indexer, and overall service health
curl -sS -i "$BASE_URL/api/health"
curl -fsS "$BASE_URL/api/health" \
  | jq '{status, database, indexer: {isHealthy, freshness, lagMs, consecutiveFailures}}'
```

The expected stats response is HTTP 200 with numeric values under `data`. The complete field
list and meanings are documented in [Observability Contract](OBSERVABILITY.md#aggregate-metrics-get-apistats-data).

## Troubleshooting

### Stats request fails or returns a non-200 response

**Check:** Confirm `BASE_URL` points to the backend and inspect the response status and body.
`/api/stats` is public, so an API key is not required. A 404 usually indicates an incorrect
base path; a 429 indicates the configured rate limit was reached. For a 5xx response, check
the database and backend logs:

```bash
curl -sS "$BASE_URL/api/health" | jq '{status, database}'
journalctl -u stellar-goal-vault-backend --since "10 minutes ago" --output=cat
```

If health reports `database.reachable: false`, follow the database steps in the
[Health Check Runbook](HEALTH_RUNBOOK.md#1-databasestatus-down--databasereachable-false).
For container deployments, inspect the backend container's logs instead of using `journalctl`.

### Values appear stale after campaign or pledge changes

**Check:** Look for `X-Cache: HIT` in the stats response. With the cache available, a response
may reflect values from up to 60 seconds earlier. Retry after the cache period and check for
`X-Cache: MISS`; a miss is computed from the database. If values remain stale after that,
verify that requests reach the expected backend instance and that it uses the expected database.

### Values are zero or do not match expected campaign activity

**Check:** Confirm the service's database is reachable and that the running instance is using
the intended `DB_PATH`. `/api/stats` aggregates the backend's campaign store; it is not an
independent chain-wide counter. Compare the response fields individually:

| Field | Interpretation |
| --- | --- |
| `total_campaigns` / `totalCampaigns` | All campaigns |
| `open_campaigns` / `openCampaigns` | Open campaigns |
| `funded_campaigns` / `fundedCampaigns` | Funded, not yet claimed |
| `claimedCampaigns` | Claimed campaigns |
| `failed_campaigns` / `failedCampaigns` | Failed campaigns |
| `total_pledged_usdc`, `total_pledged_xlm` | Un-refunded pledge volume per asset |
| `total_contributors` / `uniqueContributors` | Distinct contributors |
| `avg_funding_rate_pct` | Mean campaign funding percentage |
| `totalPledgeVolume` | Sum of stored pledge amounts, without currency normalization |

If on-chain events are missing from the local campaign state, inspect indexer health and use the
[Indexer Runbook](INDEXER_RUNBOOK.md). Healthy database status alone does not confirm that the
indexer is current.

### Health is degraded while aggregate stats still respond

`GET /api/health` also checks indexer freshness, while `/api/stats` returns campaign-store
aggregates. An indexer failure can therefore make health return HTTP 503 even when the stats
route still responds. Inspect `database` and `indexer` separately and follow the matching
[Health Check Runbook](HEALTH_RUNBOOK.md).

### Request errors or latency need investigation

Each completed request emits an `http_request` structured log with `requestId`, `method`,
`path`, `status`, and `duration_ms`. Failed requests also emit `request_error` with an error
code and details. Filter logs by the request ID returned in the `X-Request-Id` response header;
use the `status` field to distinguish client errors (4xx) from server errors (5xx). These logs
are per-request diagnostics and do not form a time-series metrics endpoint.

For the full signal contract and log field definitions, see [Observability Contract](OBSERVABILITY.md).