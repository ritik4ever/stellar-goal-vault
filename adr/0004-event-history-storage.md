# 0004 - Event History Storage: SQLite vs Append-Only Log vs Redis Streams

Status: Accepted

## Context

The backend records every significant campaign lifecycle event (campaign created, pledge received,
pledge reconciled, vault claimed, refund issued, metadata updated, deadline extension voted on)
so that the frontend history panel and the `/api/campaigns/:id/history` endpoint can replay the
audit trail for a campaign.

Three storage strategies were evaluated:

1. **SQLite table (current approach)** — events are rows in an `event_history` table alongside the
   existing `campaigns` and `pledges` tables in the same database file.
2. **Append-only log file** — events are serialised (e.g. as newline-delimited JSON) and appended to
   a flat file on disk. Reads scan or tail the file; compaction or rotation is handled out-of-band.
3. **Redis Streams** — events are published to a Redis stream keyed by campaign ID. Consumers
   read the stream via `XREAD` / `XRANGE`; retention is controlled by `MAXLEN`.

The project is an open-source MVP intended for local development and testnet demos. Any event
storage decision must account for:

- **Query flexibility** — filtering and joining events with campaign/pledge state
- **Durability** — surviving process restarts without a separate infrastructure dependency
- **Simplicity** — low setup friction for contributors and CI

## Decision

Use **SQLite** to store event history in the same database file as campaigns and pledges.

Each event is a row in `event_history` with columns for `campaign_id`, `event_type`, `payload`
(JSON), and `created_at`. The `eventHistory` service (`backend/src/services/eventHistory.ts`)
handles inserts and queries; mutation tests live in
`backend/src/services/__tests__/mutation.test.ts`.

## Evaluation of Alternatives

### Option 1 — SQLite (chosen)

Advantages:
- Zero additional infrastructure: the same SQLite file already holds campaigns and pledges.
- Full SQL query power: events can be filtered by type, joined to campaigns or pledges, ordered,
  paginated, and aggregated without custom parsing logic.
- Transactional writes: inserting an event in the same transaction as the state change it records
  eliminates the class of bugs where a pledge is saved but its event is lost (or vice versa).
- Durable by default: SQLite WAL mode survives crashes; the file is portable and easy to back up
  or snapshot.
- Consistent with ADR-0001: keeps all persistent state co-located, simplifying backup and restore.

Disadvantages:
- Write throughput is bounded by SQLite's single-writer model. At high pledge volume, event inserts
  could contend with campaign and pledge writes.
- Not a natural fit for streaming consumers or fan-out to multiple downstream services.

### Option 2 — Append-Only Log File

Advantages:
- Conceptually simple write path: `fs.appendFileSync` is hard to get wrong.
- Log files are easy to tail, ship to an aggregator, or feed into a stream processor later.
- No schema migrations needed.

Disadvantages:
- No built-in query capability. Filtering by campaign ID or event type requires scanning the entire
  file or maintaining a secondary index, adding significant complexity as the log grows.
- Transactional consistency with the SQLite state is not guaranteed. A crash between the SQLite
  commit and the file append leaves state and log out of sync with no automatic recovery.
- File rotation, compaction, and concurrent-write safety (multiple processes) require additional
  tooling that does not exist in the MVP.
- Debugging and ad-hoc inspection are harder than running a SQL query.

### Option 3 — Redis Streams

Advantages:
- Purpose-built for ordered event streams with consumer groups and replay from an offset.
- Natural fan-out: multiple consumers (indexer, websocket push, analytics) can read the same stream
  independently.
- High write throughput with sub-millisecond append latency.

Disadvantages:
- Requires running and operating a Redis instance, adding infrastructure overhead for contributors
  who only want to run `npm run dev`.
- In-memory by default: without `appendonly yes` + persistence configuration, events are lost on
  restart. Configuring durable Redis correctly is non-trivial.
- No relational query capability: fetching "all refund events for campaign 7 joined with pledge
  amounts" requires either a secondary SQLite store or application-level joins.
- Significantly increases the setup surface for CI and Docker Compose.
- Premature for an MVP where event volume is low and there are no streaming consumers yet.

## Consequences

- Contributors can run the full stack with a single `npm run dev:backend` command and zero
  additional services.
- Event records and campaign/pledge state are always consistent because they share the same
  SQLite transaction boundary.
- The history panel and `/api/campaigns/:id/history` endpoint can use parameterised SQL queries
  with `WHERE`, `ORDER BY`, and `LIMIT` without custom parsing.
- The mutation test suite (`mutation.test.ts`) validates event insert and query logic at the
  boundary conditions that coverage alone would miss.
- Scaling beyond a single SQLite writer will eventually require rethinking this design (see
  migration path below).

## Migration Path to Append-Only Log

If event volume grows to the point where SQLite write contention becomes measurable — a practical
signal would be p99 pledge latency exceeding ~100 ms under load testing — the recommended
migration path is:

1. **Add a write abstraction.** Introduce an `EventStore` interface with `append(event)` and
   `query(filter)` methods. The current `eventHistory.ts` service becomes the SQLite
   implementation. This boundary can be added before any migration is necessary and costs nothing
   at runtime.

2. **Implement a log-backed store.** Write a second implementation that appends newline-delimited
   JSON to a configurable file path and builds a lightweight in-memory index (campaign ID →
   byte offsets) on startup. The index enables O(1) campaign lookups without full scans.

3. **Dual-write for validation.** Before cutting over, run both implementations in parallel for a
   release cycle. Compare query results to catch discrepancies before removing the SQLite path.

4. **Ship and decouple.** Once confidence is established, remove the SQLite `event_history` table.
   The `campaigns` and `pledges` tables remain in SQLite; only the event stream moves to the log.

5. **Redis Streams as a further step.** If fan-out to multiple consumers (on-chain event indexer,
   real-time WebSocket push) becomes a requirement, Redis Streams can replace the log-backed store
   by implementing the same `EventStore` interface. The application layer does not change.

This staged approach avoids a big-bang migration and keeps the system functional throughout.

## References

- `backend/src/services/eventHistory.ts` — current SQLite implementation
- `backend/src/services/__tests__/mutation.test.ts` — mutation-killing tests for event history
- `adr/0001-sqlite-off-chain-mvp.md` — SQLite off-chain persistence decision
- `adr/0002-react-express-mvp.md` — overall backend architecture
- [Stryker Mutator](https://stryker-mutator.io/) — mutation testing framework used in CI
