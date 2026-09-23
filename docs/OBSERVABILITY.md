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
(number), `database` (object: `status`, `reachable`, optional `error`). Returns 503 when the
database is unreachable.

## Structured logs

Every request emits one `http_request` line when the response finishes, success or failure:

| Field | Type | Meaning |
| --- | --- | --- |
| `event` | string | Always `http_request` |
| `message` | string | `"<METHOD> <path> <status> <ms>ms"` |
| `requestId` | string | Echoed in the `X-Request-ID` header and in error bodies |
| `method`, `path` | string | Request method and original URL |
| `status` | number | HTTP status code |
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

Failing API responses carry the matching envelope: `{ success: false, error: { code, message,
requestId, details? } }`, so a `requestId` from a client report can be found in the logs.

## Not covered

Address fields (`address`, `creator`) are redacted by the logger, so the tests do not assert them.
