# Operator Runbook — Request Logging

This runbook helps operators diagnose and recover issues related to the backend request logging subsystem.

Scope
- Applies to the request logging middleware described in `REQUEST_LOGGING.md`.
- Covers signal interpretation, diagnostics, and recovery steps.

Structured Fields
- Request logs and service metrics emit stable, machine-readable fields so operators can filter by operation and correlation ID without parsing free-form messages.
- Field reference:
  - `requestId` — correlation ID assigned per request; use to trace a single request across logs and metrics.
  - `campaignId` — campaign identifier when the request is scoped to a campaign.
  - `operation` — stable operation name (e.g. `campaign.create`, `campaign.update`, `accounting.post`).
  - `outcome` — terminal result of the operation (e.g. `success`, `error`, `rejected`).
  - `latencyMs` — operation latency in milliseconds, measured from request start to response finish.
- These fields are emitted as structured attributes on both log lines and service metrics; do not rely on message text for filtering.

Signals and Actions

1) Signal: No request logs appear for incoming requests
   - Likely causes:
     - Middleware not registered (app startup path changed)
     - ENV prevents logging (e.g. logs redirected or filtered)
     - Application crash or 500 before middleware runs
   - Diagnostics:
     - Check app startup logs for `requestLoggingMiddleware` registration lines.
     - Hit a known health endpoint (e.g. `/api/health`) and tail logs:
       - `docker-compose logs -f backend` (or the platform-specific logs)
     - Confirm `NODE_ENV` and logging level:
       - `printenv NODE_ENV` or check service environment variables.
     - Verify process is healthy and receiving traffic (check metrics, readiness probes).
   - Recovery:
     - If middleware not registered, redeploy the version that contains `requestLoggingMiddleware` registration.
     - If logging level filters messages, adjust config to include `info` for request logs.
     - If service crashes before middleware runs, inspect stack traces and fix upstream errors.

2) Signal: Logs appear but missing structured fields (no `requestId`, `operation`, `outcome`, or `latencyMs`)
   - Likely causes:
     - Upstream middleware that assigns `requestId` removed or reordered.
     - Reverse proxy strips or alters `X-Forwarded-For` or headers.
     - Timing measurement failed due to early response/end handling.
     - Operation name or outcome not set on the request context before logging.
   - Diagnostics:
     - Confirm request ID middleware is present and runs before request logging. Look in `backend/src/index.ts` for `requestId` middleware ordering.
     - Send a request with a test header and inspect logs for header propagation.
     - Verify reverse proxy (nginx / load balancer) is configured to forward client IPs via `X-Forwarded-For`.
     - Filter logs/metrics by `operation` and `requestId` to confirm the fields are populated rather than embedded in the message.
   - Recovery:
     - Re-order middleware so the `requestId` assignment occurs before logging.
     - Configure proxy to forward `X-Forwarded-For` and set `app.set('trust proxy', true)` if needed.
     - Ensure the operation name and outcome are attached to the request context before the log/metric is emitted.

3) Signal: Request logs contain sensitive data
   - Likely causes:
     - Middleware was modified to include request or response bodies.
   - Diagnostics:
     - Search commit history for changes to request logging implementation.
     - Inspect current middleware code for any `body` or `req.rawBody` logging.
   - Recovery:
     - Revert or patch middleware to remove payload logging. Ensure only metadata (method, path, status, requestId, campaignId, operation, outcome, latencyMs, ip, user-agent) are logged.
     - Rotate any secrets that may have been exposed (follow security runbook).

4) Signal: High latency reported but request logs show short durations
   - Likely causes:
     - Logs are produced before the entire request work completes (e.g. asynchronous background work)
     - Instrumentation measures only server response time, not downstream or queue delays
   - Diagnostics:
     - Verify where the logging measurement starts and stops in the middleware — it should capture time from request start to response finish.
     - Correlate logs with traces/metrics (if present) to identify downstream delays.
     - Compare `latencyMs` across logs and metrics for the same `requestId` to confirm they agree.
   - Recovery:
     - Update middleware to measure until `res.on('finish')` or `res.on('close')` to capture full response time.
     - Add additional instrumentation for long-running background jobs.

5) Signal: JSON logs are malformed in production
   - Likely causes:
     - Unescaped values or non-serializable fields included in the JSON payload.
     - Multiple processes writing mixed-format logs (some text, some JSON) into the same stream.
   - Diagnostics:
     - Inspect raw log stream for broken JSON lines and look back at the corresponding request context.
     - Confirm process environment `NODE_ENV=production` and logger configuration.
   - Recovery:
     - Ensure logger uses a JSON formatter in production and only serializable fields are passed.
     - Standardize logging across processes and ensure no other logger writes freeform text to the same stream.

Quick Checks
- Tail backend logs while making a request:

```bash
docker-compose logs -f backend
# or platform specific, e.g. `kubectl logs -f deployment/backend`
curl -v http://localhost:PORT/api/health
```

- Inspect `backend/src/index.ts` to confirm middleware order.

- Filter by operation and correlation ID without parsing messages:

```bash
# Logs: filter by operation and requestId
docker-compose logs backend | grep '"operation":"campaign.create"' | grep '"requestId":"<id>"'

# Metrics: query by operation and outcome labels
# e.g. service_operation_latency_ms{operation="campaign.create",outcome="success"}
```

Notes for Operators
- This runbook intentionally avoids any steps that require secrets or private credentials.
- If logs indicate data leakage, follow the project's security incident response runbook in `SECURITY.md`.

Authors: ops + backend team
Last updated: 2026-09-23
