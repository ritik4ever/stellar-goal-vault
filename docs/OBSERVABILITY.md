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
| `requestId` | string | Echoed in the `X-Request-ID` header and in error bodies |
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

### Health check outcome and retries (issue #1035)

Each health request emits **exactly one** `health_check` line (info) carrying the outcome. Count
health successes and failures from this line only. The `health_check_retry` lines explain what
happened along the way. They never carry an `outcome` field, so a check that recovers after
retries is counted once, as a success with `retry_count > 0`.

`health_check` fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `operation` | string | `health_check_shallow` or `health_check_deep` |
| `outcome` | string | `success` or `failure`, the final result of the whole check |
| `latency_ms` | number | Total check time, including retry backoff |
| `retry_count` | number | Retries performed (always `0` for the shallow check) |
| `retry_reasons` | string[] | Deep only: reason for each failed attempt that was retried, in order |
| `soroban_attempts` | number | Deep only: RPC `getHealth` attempts (`0` when `SOROBAN_RPC_URL` is unset) |
| `soroban_failure_reason` | string \| null | Deep only: why the last attempt failed; `null` if the probe succeeded |
| `db_reachable`, `soroban_healthy`, `indexer_healthy`, `has_contract_id` | boolean | Component states |

`health_check_retry` (warn) is emitted once per failed Soroban RPC attempt that will be retried
by `GET /api/health/deep`:

| Field | Type | Meaning |
| --- | --- | --- |
| `operation` | string | `health_check_deep` |
| `component` | string | `soroban_rpc` |
| `attempt` | number | 1-based attempt that failed |
| `max_attempts` | number | `HEALTH_CHECK_RPC_MAX_ATTEMPTS` (default 3) |
| `reason` | string | Failure reason code (see below) |
| `next_retry_ms` | number | Backoff before the next attempt (`HEALTH_CHECK_RPC_RETRY_DELAY_MS` × 2^(attempt−1), default 100) |

Reason codes are `timeout`, `http_<status>` (5xx only; 4xx counts as reachable), or
`network_error[:<ERRNO>]` such as `network_error:ECONNREFUSED`. The raw error message is never
logged, because fetch errors can echo the RPC URL, and the URL can embed provider credentials or
API keys.

All of these lines carry the request's `requestId` (via the logger's request-context mixin), the
same id as the `http_request` line and the `X-Request-ID` response header. Filtering on that id
reconstructs the whole check: each retry and its reason, then the one final outcome.

Validation failures from `validateBody` middleware are routed through `next(AppError)` so
the central error handler emits the same `request_error` structured log with `code:
VALIDATION_ERROR` and the `details` array of `{ field, message }` issues.  This makes
validation failures filterable by `code == "VALIDATION_ERROR"` without parsing free-form
messages.

## Not covered

Address fields (`address`, `creator`) are redacted by the logger, so the tests do not assert them.
