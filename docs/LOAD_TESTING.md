# Load Testing and Tuning Guide

The backend includes an `autocannon` based load testing script to validate performance and identify bottlenecks under high traffic conditions.

## Running the Load Test

To run the load test, you need to have `autocannon` installed globally or run it via `npx`:

```bash
npx autocannon -c 100 -d 30 http://localhost:3001/api/campaigns
```

### CLI Flags

Here are the essential CLI flags used for tuning the tests:

- `-c, --connections <NUM>`: The number of concurrent connections to use. Default is `10`.
- `-d, --duration <SEC>`: The number of seconds to run the load test. Default is `10`.
- `-p, --pipelining <NUM>`: The number of pipelined requests to use. Default is `1`.
- `-m, --method <METHOD>`: The HTTP method to use. Default is `GET`.
- `-b, --body <STRING>`: The body of the request (useful for POST/PUT requests).
- `-H, --headers <ARRAY>`: Custom headers to include (e.g., `-H "Authorization: Bearer <TOKEN>"`).
- `--latency`: Output latency statistics (min, max, p50, p95, p99).

## Tuning Guide & Scenarios

Depending on the expected real-world load, you should adjust the connections and duration. Below are three common scenarios.

### Scenario 1: Base Load (Smoke Test)
Used to verify that the application handles a normal baseline traffic volume without errors.

```bash
npx autocannon -c 50 -d 10 --latency http://localhost:3001/api/campaigns
```
**Goal**: Zero errors, fast response times (p99 < 50ms).

### Scenario 2: Spike Traffic (Campaign Launch)
Simulates a sudden influx of users when a highly anticipated campaign goes live.

```bash
npx autocannon -c 500 -d 30 --latency http://localhost:3001/api/campaigns
```
**Goal**: Verify the system doesn't crash (no OOM), handles connection queuing, and degrades gracefully.

### Scenario 3: High Write Throughput (Pledging)
Simulates many users concurrently submitting pledges (requires an auth token).

```bash
npx autocannon -m POST -c 100 -d 20 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -b '{"amount": 50}' \
  --latency http://localhost:3001/api/campaigns/<CAMPAIGN_ID>/pledge
```
**Goal**: Check for SQLite lock contention (`SQLITE_BUSY`) or database timeouts under concurrent writes.

## Interpreting Results & Thresholds

When you pass the `--latency` flag, `autocannon` provides percentile metrics:

- **p50 (Median)**: 50% of requests were faster than this value.
- **p95**: 95% of requests were faster than this value. Important for assessing typical user experience.
- **p99**: 99% of requests were faster than this value. Critical for identifying long tail latencies and outliers.

### Recommended Thresholds

| Metric | Acceptable Threshold | Warning | Critical |
| --- | --- | --- | --- |
| **p95 Latency (Reads)** | < 100ms | > 200ms | > 500ms |
| **p99 Latency (Reads)** | < 250ms | > 500ms | > 1000ms |
| **p95 Latency (Writes)** | < 300ms | > 600ms | > 1500ms |
| **Error Rate** | 0% | > 0.1% | > 1% |

## Common Failure Modes and Fixes

1. **High p99 Latency with Low Error Rate**
   - *Cause*: Event loop blocking or slow external API calls (e.g., Soroban RPC).
   - *Fix*: Cache RPC results, use background workers, or avoid synchronous heavy compute in request handlers.
2. **`SQLITE_BUSY` Errors (500s on Writes)**
   - *Cause*: Too many concurrent write transactions causing lock timeouts.
   - *Fix*: Enable WAL mode in SQLite, increase the `busy_timeout` PRAGMA, or batch writes.
3. **Connection Timeouts / ECONNRESET**
   - *Cause*: Node.js process is overloaded, or Render/Vercel rate limits are kicking in.
   - *Fix*: Scale up the backend instance size, increase the Node.js max sockets, or implement a rate limiter.
4. **Out of Memory (OOM) Crashes**
   - *Cause*: High concurrent connections retaining too much memory per request.
   - *Fix*: Profile for memory leaks, reduce memory overhead per request, and scale memory limits on the hosting provider.
