# Observability contract

The backend has no Prometheus-style metrics registry. Its observable signals are the aggregate
metrics served by `GET /api/stats`, the health payloads, and structured JSON logs (pino) written by
`backend/src/logger.ts` and `backend/src/middleware/requestId.ts`.

The fields below are relied on for debugging and dashboards. They are enforced by
[`backend/src/observabilityContract.test.ts`](../backend/src/observabilityContract.test.ts): renaming
or removing one fails the test with a message naming the field. If you change one deliberately,
update the constants at the top of that test and this page in the same PR.

The tests check presence and type only, never exact timestamps, durations or ids.

## Aggregate metrics: `GET /api/stats` (`data.*`)

| Field | Type | Meaning |
| --- | --- | --- |
| `total_campaigns` / `totalCampaigns` | number | All campaigns |
| `open_campaigns` / `openCampaigns` | number | Unfunded, deadline not passed |
| `funded_campaigns` / `fundedCampaigns` | number | Target reached, not yet claimed |
| `failed_campaigns` / `failedCampaigns` | number | Deadline passed below target |
| `claimedCampaigns` | number | Campaigns whose funds were claimed |
| `total_pledged_usdc`, `total_pledged_xlm` | number | Un-refunded pledge volume per asset |
| `totalPledgeVolume` | number | Sum of `pledged_amount` across campaigns |
| `total_contributors` / `uniqueContributors` | number | Distinct contributors |
| `avg_funding_rate_pct` | number | Mean funding percentage |

## Health: `GET /api/health`

`service` (string), `status` (`ok` or `degraded`), `timestamp` (ISO string), `uptimeSeconds`
(number), `database` (object: `status`, `reachable`, optional `error`), `indexer` (object —
Soroban event indexer lag/freshness). Returns 503 when the database is unreachable or the
indexer is failing/stale.

### `indexer` fields (issue #1024)

For operational guidelines and playbooks, refer to the [Indexer Runbook](INDEXER_RUNBOOK.md).

| Field | Type | Meaning |
| --- | --- | --- |
| `lastSuccessfulPollTime` | number \| null | Epoch ms of last successful RPC poll |
| `lastKnownLedger` | number | Last ledger observed / resumed from |
| `isHealthy` | boolean | Running, no failures, and not stale |
| `consecutiveFailures` | number | RPC failures since last success |
| `lagMs` | number \| null | Ms since last successful poll |
| `freshness` | string | `fresh` \| `idle` \| `stale` \| `failing` \| `never` |
| `staleLagMs` | number | Lag threshold for `stale` (env `SOROBAN_INDEXER_STALE_LAG_MS`) |
| `freshLagMs` | number | Lag threshold for `fresh` (env `SOROBAN_INDEXER_FRESH_LAG_MS`) |

`freshness` lets operators distinguish **healthy-but-idle** (`idle`) from **stale** (`stale`)
and **failing** (`failing`).

## Structured logs

Every request emits one `http_request` line when the response finishes, success or failure.
The `http_request` event is **always emitted at `info` level** regardless of status code.
The `status` field carries sufficient information to derive severity programmatically
(e.g. `status >= 500` → error, `status >= 400` → warn), which keeps log queries simple:
operators can filter by `event == "http_request"` in one stream without cross-correlating
`warn` and `error` outputs.

| Field | Type | Meaning |
| --- | --- | --- |
| `event` | string | Always `http_request` |
| `message` | string | `"<METHOD> <path> <status> <ms>ms"` |
| `requestId` | string | Returned in the `X-Request-Id` response header and error bodies; generated per request when no inbound ID is supplied |
| `method`, `path` | string | Request method and original URL |
| `status` | number | HTTP status code (use this to determine severity) |
| `duration_ms` | number | Non-negative, two decimals |

Requests that fail in a route or middleware also emit a `request_error` line from the central error
handler in `backend/src/index.ts`:

| Field | Type | Meaning |
| --- | --- | --- |
| `event` | string | `request_error` |
| `requestId`, `method`, `path` | string | Same as above |
| `status` | number | Status returned to the client |
| `code` | string | Machine code, e.g. `NOT_FOUND`, `VALIDATION_ERROR` |
| `err.message`, `err.name`, `err.stack` | string | Serialized error |
| `indexer` | object | Background indexer freshness state (see `GET /api/health`) |

Failing API responses carry the matching envelope:
`{ success: false, error: { code, message, requestId, details? } }`,
so a `requestId` from a client report can be found in the logs.

Validation failures from `validateBody` middleware are routed through `next(AppError)` so
the central error handler emits the same `request_error` structured log with `code:
VALIDATION_ERROR` and the `details` array of `{ field, message }` issues.  This makes
validation failures filterable by `code == "VALIDATION_ERROR"` without parsing free-form
messages.

## Not covered

Address fields (`address`, `creator`) are redacted by the logger, so the tests do not assert them.

For operator diagnostics and recovery steps, see the [Service Metrics Troubleshooting Runbook](SERVICE_METRICS_RUNBOOK.md).
