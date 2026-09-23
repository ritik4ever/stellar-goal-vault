# Request Logging

Every HTTP request produces exactly one structured log entry with `event: "http_request"`, written by `requestIdMiddleware` (`src/middleware/requestId.ts`) through the pino logger in `src/logger.ts`.

The middleware is registered **first** in `src/index.ts`, so requests rejected by CORS, API-key auth, the response cache, or the rate limiter still get an `X-Request-ID` response header and a log entry.

## Fields

All fields are stable and machine-readable, so logs can be filtered without parsing the free-form `message`.

| Field | Example | Notes |
|---|---|---|
| `event` | `http_request` | Constant for request logs. |
| `requestId` | `3f2b…` | Correlation ID. Taken from the incoming `X-Request-ID` header or generated (UUID v4), and echoed back in the response header. Every other log line written during the request also carries it (pino `mixin`). |
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
- `Authorization` headers are redacted, and Stellar addresses in `address` / `creator` fields are truncated (see `redact` in `src/logger.ts`).

## Output format

- Development (`NODE_ENV != production`): pretty-printed via `pino-pretty`.
- Production (`NODE_ENV = production`): one JSON object per line.

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
