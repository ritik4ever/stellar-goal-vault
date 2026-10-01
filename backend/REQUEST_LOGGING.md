# Request Logging

Every HTTP request produces exactly one structured log entry with `event: "http_request"`, written by `requestIdMiddleware` (`src/middleware/requestId.ts`) through the pino logger in `src/logger.ts`.

The middleware is registered **first** in `src/index.ts`, so requests rejected by CORS, API-key auth, the response cache, or the rate limiter still get an `X-Request-Id` response header and a log entry.

## Base fields

- HTTP method
- Request path (query string removed)
- Response status code
- Request duration
- Request ID (`X-Request-Id`; incoming IDs are propagated, otherwise a UUID is generated)
- Remote IP and user agent

## Structured fields

All fields are stable and machine-readable, so logs can be filtered without parsing the free-form `message`.

| Field | Example | Notes |
|---|---|---|
| `event` | `http_request` | Constant for request logs. |
| `requestId` | `3f2b…` | Correlation ID. Taken from the incoming `X-Request-Id` header or generated (UUID v4), and echoed back in the response header. Every other log line written during the request also carries it (pino `mixin`). |
| `operation` | `POST /api/campaigns/:id/pledges` | `<METHOD> <route pattern>`. Low-cardinality: IDs never appear in it. `unmatched` when no route matched (e.g. 404s, or requests rejected before routing). |
| `route` | `/api/campaigns/:id/pledges` | Matched Express route pattern. Omitted for `unmatched`. |
| `campaignId` | `42` | Present for `/api/campaigns/:id` and its sub-routes only. |
| `method` | `POST` | |
| `path` | `/api/campaigns/42/pledges` | Actual path, **without the query string**. |
| `status` | `400` | HTTP status code. |
| `outcome` | `client_error` | `success` (< 400), `client_error` (4xx), `server_error` (5xx), or `aborted` (the client disconnected before the response finished). |
| `errorCode` | `VALIDATION_ERROR` | Application error code from the error handler, for failed requests only. |
| `duration_ms` | `18.57` | Latency in milliseconds, rounded to two decimals. |
| `message` | `POST /api/campaigns/42/pledges 400 18.57ms` | Human-readable summary. Don't filter on it. |
| `ip` | `203.0.113.7` | Remote address, when available. |
| `userAgent` | `Mozilla/5.0 …` | `User-Agent` header, when present. |
| `retryCount` | `2` | Present only when the client/proxy sent an `x-retry-count` header. |
| `retryReason` | `timeout` | Present only when an `x-retry-reason` header was sent (redacted). |
| `finalOutcome` | `failure` | Request-level outcome (`success`/`failure`); defaults from the status code. |

Unhandled errors also produce a separate `event: "request_error"` entry (with `err.message` / `err.stack`) sharing the same `requestId`.

## Filtering examples

With JSON logs (`NODE_ENV=production`), for example with `jq`:

```sh
# Everything that happened during one request
jq 'select(.requestId == "3f2b…")'

# Failed pledges
jq 'select(.event == "http_request" and .operation == "POST /api/campaigns/:id/pledges" and .outcome != "success")'

# All requests touching campaign 42
jq 'select(.event == "http_request" and .campaignId == "42")'

# Slow requests by operation
jq 'select(.event == "http_request" and .duration_ms > 500) | {operation, duration_ms}'
```

## Safety

- Request and response bodies are never logged.
- Query strings are stripped from `path`.
- Sensitive headers (`Authorization`, cookies, API keys, wallet/webhook secrets) are redacted, and Stellar addresses in `address` / `creator` fields are truncated (see `redact` in `src/logger.ts`).

## Output format

- Development (`NODE_ENV != production`): pretty-printed via `pino-pretty`.
- Production (`NODE_ENV = production`): one JSON object per line.

## Integration

Middleware is registered in `backend/src/index.ts` before every other middleware:

```ts
app.use(requestIdMiddleware);
```

For operator troubleshooting guidance and runbook actions, see `OPERATOR_REQUEST_LOGGING_RUNBOOK.md` in the same directory.

## Example development log

```txt
[2026-03-27T22:00:00.000Z] POST /api/campaigns/42/pledges status=400 duration=3.2ms requestId=3f2b8c1e-1d2a-4c4b-9f1e-6a7b8c9d0e1f operation="POST /api/campaigns/:id/pledges" outcome=client_error errorCode=VALIDATION_ERROR
```

## Example production entry

```json
{
  "level": "info",
  "time": 1790000000000,
  "event": "http_request",
  "message": "POST /api/campaigns/42/pledges 400 3.2ms",
  "requestId": "3f2b8c1e-1d2a-4c4b-9f1e-6a7b8c9d0e1f",
  "operation": "POST /api/campaigns/:id/pledges",
  "route": "/api/campaigns/:id/pledges",
  "campaignId": "42",
  "method": "POST",
  "path": "/api/campaigns/42/pledges",
  "status": 400,
  "outcome": "client_error",
  "errorCode": "VALIDATION_ERROR",
  "duration_ms": 3.2
}
```
