# Request Logging Middleware

## Summary

The backend now includes request logging middleware that records one log line per request with:

- HTTP method
- Request path (query string removed)
- Response status code
- Request duration
- Request ID (`X-Request-Id`; incoming IDs are propagated, otherwise a UUID is generated)
- Remote IP and user agent

## Structured fields

In addition to the base fields above, each request log line carries stable,
machine-readable fields so logs and metrics can be filtered without parsing
free-form messages:

- `requestId` — correlation ID for the request (`X-Request-Id`)
- `campaignId` — campaign identifier when the request is scoped to a campaign
- `operation` — operation name (e.g. `campaign.create`, `campaign.update`)
- `outcome` — normalized result (`success`, `client_error`, `server_error`)
- `latencyMs` — request latency in milliseconds (numeric)

These fields are emitted as top-level keys in production JSON logs and as
`key=value` pairs in development text logs, so both can be filtered by
`operation` and `requestId` directly.

## Safety

Request and response payloads are intentionally not logged. This prevents accidental exposure of sensitive data in logs.

## Output format

- Development (`NODE_ENV != production`): readable single-line text logs
- Production (`NODE_ENV = production`): JSON logs suitable for Render log streams and structured parsing

## Integration

Middleware is registered in `backend/src/index.ts` after request ID assignment:

```ts
app.use(requestLoggingMiddleware);
```

For operator troubleshooting guidance and runbook actions, see `OPERATOR_REQUEST_LOGGING_RUNBOOK.md` in the same directory.

## Example development log

```txt
[2026-03-27T22:00:00.000Z] GET /api/health status=200 duration=3.12ms requestId=abc operation=health.check outcome=success latencyMs=3.12 ip=127.0.0.1
```

## Example production log

```json
{
  "level": "info",
  "timestamp": "2026-03-27T22:00:00.000Z",
  "method": "GET",
  "path": "/api/health",
  "statusCode": 200,
  "durationMs": 3.12,
  "duration": "3.12ms",
  "requestId": "abc",
  "campaignId": "cmp_123",
  "operation": "campaign.update",
  "outcome": "success",
  "latencyMs": 3.12
}
```
