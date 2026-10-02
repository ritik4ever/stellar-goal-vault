# Background Job Health

`GET /api/health` reports a `jobs` object with one entry per background or
derived-state process. It lets you tell a **healthy but idle** service apart from
one that is **stale** or **failing**.

```bash
curl -s localhost:3001/api/health | jq '.jobs | map_values({state, freshness_lag_seconds, consecutive_failures})'
```

`jobs` is informational. It does not change `status` or the HTTP status code, so a
flaky Soroban RPC will not make an orchestrator restart an otherwise healthy API.
Alert on `jobs.<name>.state` instead.

## Tracked jobs

| Job | What it does | Cadence |
| --- | --- | --- |
| `event_indexer` | Polls Soroban `getEvents` and reconciles on-chain events into local state | Every `SOROBAN_POLL_INTERVAL_MS` (default 15s), with backoff after failures |
| `webhook_delivery` | Delivers campaign status-change webhooks (one run = one delivery, retries included) | Event-driven, so it is never `stale` |

Campaign status and accounting are computed on read from stored data. There is no
background recomputation to lag behind, so nothing is tracked for them.
`/api/stats` is cached for 60s, which would hide freshness, so job health lives
only on `/api/health`.

## Fields

| Field | Unit | Meaning |
| --- | --- | --- |
| `state` | enum | `healthy`, `idle`, `stale`, `failing`, `starting` or `disabled` (see below) |
| `last_success_timestamp_seconds` | Unix seconds | Last run that succeeded. Only moves on a real success. `null` before the first one |
| `last_attempt_timestamp_seconds` | Unix seconds | Last run, successful or not |
| `last_failure_timestamp_seconds` | Unix seconds | Last failed run. `null` if none yet |
| `freshness_lag_seconds` | seconds | Time since the last success (or since start if none yet). Clamped to `[0, JOB_MAX_REPORTED_LAG_SECONDS]`, so it is never negative and cannot grow without bound. `null` when `disabled` |
| `stale_after_seconds` | seconds | Threshold for `stale`. `null` for event-driven jobs |
| `consecutive_failures` | count | Failed runs since the last success. Resets to 0 on success |
| `total_failures` / `total_successes` | count | Since process start (reset on restart) |
| `last_error` | string | Message of the most recent failure, truncated to 200 characters. Kept after recovery so you can see what last went wrong |
| `last_run_processed` | count | Units of work in the last successful run. `0` means it ran fine with nothing to do. `null` before the first success |
| `details` | numbers | Job-specific signals, replaced on each success (see below) |

### `event_indexer` details

| Field | Unit | Meaning |
| --- | --- | --- |
| `latest_network_ledger` | ledger | Newest ledger the RPC reported on the last successful poll |
| `synced_through_ledger` | ledger | Ledger the indexer has fully covered: the RPC's latest ledger after a short page, or the highest event ledger after a full 200-event page |
| `ledger_lag` | ledgers | `latest_network_ledger - synced_through_ledger`, clamped to `[0, 1000000]`. `0` when caught up, greater than `0` while draining a backlog |

The three values are `null` if the RPC response has no `latestLedger`. They describe the
last successful poll; they do not age. `freshness_lag_seconds` is the value that keeps
growing when polls stop succeeding.

## Reading the state

| State | Meaning | What to do |
| --- | --- | --- |
| `healthy` | Last run succeeded within the threshold and handled work | Nothing |
| `idle` | Last run succeeded within the threshold and had nothing to do. This is normal on a quiet contract | Nothing. A success with no work is not stale |
| `starting` | Started, no run yet, still within the threshold | Wait. If it lasts beyond `stale_after_seconds` it becomes `stale` |
| `stale` | No success within `stale_after_seconds` and not enough consecutive failures to be `failing`. Usually the scheduler stopped or a run is hanging | Check the process and its logs |
| `failing` | `consecutive_failures` has reached `JOB_FAILING_AFTER_FAILURES`. Runs are happening and erroring | Read `last_error` (RPC down, bad URL, receiver returning 5xx) |
| `disabled` | Not configured to run, for example `CONTRACT_ID` is unset for the indexer | Set the configuration if the job should run |

`failing` takes priority over `stale`, because it names the cause. A job that has
been failing long enough to be stale still reports `failing`. Fewer failures than
the threshold do not change `state`, but `consecutive_failures` and `last_error`
still show them.

Quick triage:

- `idle` with a small `freshness_lag_seconds`: the service is fine and just has no events.
- `stale` with `consecutive_failures: 0`: nothing is even attempting. Look at the process, not the RPC.
- `failing`: attempts are happening and erroring. `last_success_timestamp_seconds` shows when it last worked.
- `healthy` with `ledger_lag` above 0 that keeps growing: the indexer is busy but not keeping up.

## Configuration

Set in the environment; documented in `.env.example`. All values are seconds or counts.

| Variable | Default | Effect |
| --- | --- | --- |
| `INDEXER_STALE_AFTER_SECONDS` | `max(120, 4 x SOROBAN_POLL_INTERVAL_MS / 1000)` | Seconds without a successful indexer poll before `stale`. Keep it above the poll interval, and above the backoff (up to 300s) if you want failures to surface as `stale` before `failing` |
| `JOB_FAILING_AFTER_FAILURES` | `3` | Consecutive failures before `failing` |
| `JOB_MAX_REPORTED_LAG_SECONDS` | `86400` | Upper bound for `freshness_lag_seconds` |

Invalid, zero or negative values fall back to the default.

## Adding a job

Register a tracker with `registerJob` in `backend/src/services/jobHealth.ts`, call
`recordSuccess({ processed })` only when the work actually succeeded (use
`processed: 0` for a run with nothing to do) and `recordFailure(err)` when it
errors. Pass `staleAfterSeconds: null` for event-driven work.
