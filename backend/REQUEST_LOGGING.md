# Request Logging Middleware

## Summary

The backend now includes request logging middleware that records one log line per request with:

- HTTP method
- Request path (query string removed)
- Response status code
- Request duration
- Request ID (when available)
- Remote IP and user agent

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

## Example development log

```txt
[2026-03-27T22:00:00.000Z] GET /api/health status=200 duration=3.12ms requestId=abc ip=127.0.0.1
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
  "requestId": "abc"
}
```
