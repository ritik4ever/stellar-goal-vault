# Health Check Endpoints

## GET /api/health

Basic health check. Returns 200 if the server is running.

Response:
```json
{
  "status": "ok",
  "uptime": 12345
}
```

## GET /api/health/deep

Deep health check with component-level status.

Response:
```json
{
  "status": "ok",
  "components": {
    "database": { "status": "ok", "latency_ms": 5 },
    "soroban_rpc": { "status": "ok", "latency_ms": 120 },
    "horizon": { "status": "ok", "latency_ms": 80 }
  }
}
```

## GET /api/health/ready

Readiness check for load balancers.
