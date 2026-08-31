# 0004 - SQLite for MVP with PostgreSQL Migration Path

## Context

The MVP needs a persistence layer for campaigns, pledges, and event history. Several database options were evaluated:

1. **SQLite** — Embedded, zero-configuration relational database. Data is stored in a single file on disk. No separate server process required.

2. **PostgreSQL** — Full-featured production relational database with connection pooling, role-based access control, and strong consistency guarantees. Requires a dedicated server or container.

3. **MongoDB** — Document-oriented NoSQL database. Schema-less design allows rapid iteration but trades away relational integrity and transactional guarantees.

4. **In-memory storage** — Data held in process memory only. Fastest option but entirely ephemeral; no durability across restarts.

The project is a community MVP built by contributors who may not have infrastructure experience. The database needs to be:

- Trivial to set up — clone, install, and run with zero configuration
- Reliable enough for local development and demos
- Able to hold campaign, pledge, and event data with referential integrity
- Backward-compatible with a future production database migration

## Decision

Use **SQLite** for the MVP persistence layer, with an abstracted data access layer designed to ease a future migration to PostgreSQL.

The backend (`backend/src/services/campaignStore.ts` and `backend/src/services/eventHistory.ts`) uses `better-sqlite3` — a synchronous, native Node.js binding. The data access layer is encapsulated behind a `Database` class so that swapping the underlying engine does not require rewriting every consumer.

The migration path to PostgreSQL is preserved by:

- Using standard SQL (CREATE TABLE, INSERT, SELECT, JOIN) without SQLite-specific extensions
- Keeping transaction logic in the service layer rather than in database-specific triggers or stored procedures
- Storing dates as UNIX epoch integers (which both SQLite and PostgreSQL handle natively)
- Limiting PRAGMA usage to migration-safe schema introspection (column existence checks via `PRAGMA table_info`) rather than core application logic

## Consequences

- **Zero setup for contributors** — running `npm run dev:backend` automatically creates the database file at `backend/data/campaigns.db`. No server install, no user creation, no connection string configuration.
- **Fast CI and test runs** — SQLite's in-memory mode (`:memory:`) is used for test suites, making tests self-contained and fast without a separate test database.
- **Portability** — the entire database is a single file. Contributors can share snapshots for debugging.
- **Migration effort** — switching to PostgreSQL later will require: swapping `better-sqlite3` for `pg` or `node-postgres`, adding connection pooling configuration, updating any deployment scripts, and running a schema migration. The data access abstraction reduces this to a contained change.
- **Concurrency limits** — SQLite serializes writes at the file level. This is acceptable for an MVP with few concurrent users but will become a bottleneck under load, which is the primary motivator for the PostgreSQL migration path.

## References

- `backend/src/database.ts` — database connection and schema initialization
- `backend/src/services/campaignStore.ts` — campaign CRUD operations
- `backend/src/services/eventHistory.ts` — event log persistence
- `adr/0001-sqlite-off-chain-mvp.md` — original SQLite off-chain decision
- `adr/0002-react-express-mvp.md` — overall architecture context
