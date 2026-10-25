# Structured Logging

## Logger Setup

The backend uses structured JSON logging with the following format:

```json
{
  "level": "info",
  "message": "Request received",
  "timestamp": "2026-05-28T12:00:00Z",
  "requestId": "uuid",
  "method": "GET",
  "path": "/api/campaigns",
  "duration": 42
}
```

## Log Levels

| Level | Usage |
|-------|-------|
| error | Unhandled errors, critical failures |
| warn | Unexpected but handled situations |
| info | Normal operational events |
| debug | Detailed debugging information |

## Request ID Passthrough

All requests should include a unique request ID propagated via the `X-Request-ID` header.
