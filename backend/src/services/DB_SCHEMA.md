# SQLite Schema Contract

The schema is defined by versioned SQL migrations in `backend/migrations/`.
`initDb()` runs `migrate()`, which applies any pending migrations in version
order and records each one in the `schema_migrations` table. Already-applied
migrations are skipped. Migrations must preserve existing rows.

The deterministic seed workflow in `seedDeterministic.ts` is a development
reset, not a migration. It atomically clears campaign-owned notifications,
comments, events, pledges, and campaigns (plus `campaigns_fts`) before
inserting its fixed fixtures. It must delete dependent rows before campaigns
and must not be used against production data.

## Ownership and invariants

- `campaigns` owns campaign lifecycle state. `pledged_amount` is the cached
  accounting total for non-refunded rows in `pledges`; lifecycle changes are
  represented by `claimed_at`, `failed_at`, and `deleted_at`.
- `pledges` owns contribution records. `transaction_hash` is unique when
  present, `campaign_id` references `campaigns(id)`, and a refunded pledge is
  excluded from the campaign's pledged total.
- `campaign_events` is the append-only history for campaign lifecycle and
  accounting changes. Blockchain metadata is optional for local events.
- `campaign_comments` owns user feedback. `campaign_id` references
  `campaigns(id)` and `deleted_at` is a soft-delete marker; comment rows are
  not physically removed as part of normal lifecycle operations.
- `notifications` references `campaigns(id)` and is cleared by the seed wipe.
- `campaigns_fts` is a derived search index maintained by triggers. It can be
  rebuilt from `campaigns` and is never the source of truth.


## Pledges persistence integrity constraints (#873)

`pledges` is the source of truth for individual contributions. A safe subset of
application invariants is enforced at the database layer so invalid rows cannot
be persisted even if application validation is bypassed:

| Constraint | Rule |
| --- | --- |
| Amount | `amount > 0` |
| Identity fields | non-empty `contributor` and `asset_code` (after trim) |
| Timestamps | positive `created_at`; `refunded_at > 0` when NOT NULL |

Fresh databases receive these as `BEFORE INSERT / BEFORE UPDATE` triggers
(`pledges_persistence_integrity_*`, migration 005). Legacy databases receive the
same triggers via `ensurePledgesIntegrityConstraints()` on every startup.
No historical data repair is needed because all valid data already satisfies
these rules — the triggers only block future invalid inserts or updates.

## Campaigns persistence integrity constraints (#868)

`campaigns` is the source of truth for lifecycle and cached accounting. A safe
subset of application invariants is enforced at the database layer so invalid
rows cannot be persisted even if application validation is bypassed:

| Constraint | Rule |
| --- | --- |
| Identity fields | non-empty `creator`, `title`, `description`, `accepted_tokens_json` |
| Amounts | `target_amount > 0`; `pledged_amount >= 0` |
| Timestamps | positive `deadline` and `created_at` |
| Lifecycle | `claimed_at` and `failed_at` are mutually exclusive |
| Cap | `max_per_contributor` is null or `>= 0` |

Fresh databases receive these as `CHECK` constraints (migrations 001 and 002).
All databases also receive equivalent `BEFORE INSERT/UPDATE` triggers
(`campaigns_persistence_integrity_*`) because SQLite cannot add `CHECK` via
`ALTER TABLE`. The migration runner invokes the guard after schema upgrades so
legacy datasets are cleaned only where the invariant is safe to repair, while
invalid inserts and updates remain rejected at the database boundary. On
migrate, negative `pledged_amount` values are soft-cleaned to `0` so valid
accounting updates continue; other historical rows are left unchanged. Invalid
inserts/updates are aborted.

## Migrations

Each migration is a pair of files:

- `NNN_name.sql` — the up script, applied once.
- `NNN_name.down.sql` — the rollback script, which must restore the schema of
  version `NNN - 1`.

Versions are contiguous from `001`. The runner (`src/db/migrator.ts`) refuses
to start if a version is missing, duplicated, or lacks a rollback script, or if
an applied migration's file has been edited since it ran (its checksum is
stored in `schema_migrations`). To change the schema, add a new migration; never
edit one that has shipped.

`migrate()` runs everything in one SQLite transaction, with each migration in
its own savepoint, so a failure leaves the database at its previous version.
Column additions must precede dependent partial and composite indexes.
Backfill only when the existing data has a clear default, and avoid rewriting
lifecycle or accounting history.

### Interrupted upgrades

A migration is applied inside a single transaction, and the `schema_migrations`
row for that version is written in the same transaction. The version therefore
advances only if the migration's DDL and bookkeeping both commit. If the process
is killed, the power fails, or a statement fails before commit, SQLite rolls the
whole transaction back: the schema stays at the previous version, the migration
has no `schema_migrations` row, and no committed campaign, pledge, or event data
is dropped or duplicated.

Rerunning `migrate()` after an interruption is safe. Migrations already recorded
are skipped, and the interrupted one is applied again from its start. Because its
prior attempt rolled back, the rerun begins from a clean state and does not stack
duplicate columns, indexes, or triggers. Migrations that create objects use
`IF NOT EXISTS`, and column additions run only when the column is absent. The
legacy upgrade (`upgradeLegacySchema()`) follows the same rule: it is idempotent,
so an interruption part-way through it can be recovered by rerunning startup.

Regression coverage for this behaviour lives in
`src/db/versionedMigrations.test.ts` (interrupted migration recovery) and must
stay green when migrations change.

### Databases created before versioned migrations

Databases created before the runner existed have tables but no
`schema_migrations` rows. On first startup, `upgradeLegacySchema()`
(`src/db/legacySchema.ts`) idempotently brings them to the schema of
`LEGACY_BASELINE_VERSION` (004). It adds missing columns, derives
`accepted_tokens_json` from a legacy `asset_code`, removes duplicate
transaction hashes, and backfills `campaigns_fts`. Migrations 001–004 are then
recorded as applied. That module is frozen, so new schema work goes in
migration files.

To roll back, call `rollbackMigrations(db, targetVersion)`. It runs the down
scripts newest first and removes their `schema_migrations` rows.

### Startup invariants

After migrations, `applyStartupInvariants()` runs on every startup. It
backfills `pledges.token_id` and rebuilds the cached `campaigns.pledged_amount`.
It also re-asserts the query-plan indexes and campaign integrity triggers with
`IF NOT EXISTS`. It does not change the schema.

Update the focused database tests (`src/db/versionedMigrations.test.ts`) when a
schema object or invariant changes.

## Event indexer cursor (`kv_store`)

Migration 006 creates `kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)`.
The Soroban event indexer keeps its resume position there, in two keys:

| Key | Value | Meaning |
|-----|-------|---------|
| `soroban_indexer_cursor` | `{"ledger": N, "eventIndex": I}` | Position of the last event fully processed. |
| `soroban_indexer_last_ledger` | `N` | Kept in sync for older readers. On a database that has only this key, `N` is the next ledger to fetch. |

An event's position is its ledger plus its index within that ledger, so several
events that share a ledger or a transaction hash each get their own position and
are indexed once, in chain order. When the RPC omits `event_index`, the indexer
uses the event's ordinal within the ledger.

`processSorobanEvents()` writes each event and the cursor advance in one
transaction. A restart therefore cannot leave an event recorded with the cursor
still behind it, or the cursor past an event that was never recorded. If an
event cannot be stored, the batch stops, the cursor stays on the last committed
event, and the next poll resumes from there. Each poll fetches from the cursor's
own ledger and skips events at or before the cursor, so a batch that stopped
part-way through a ledger loses nothing.

A database that has only the legacy key has not recorded which events inside
its ledger were consumed, so the indexer processes that ledger in full; events
already recorded are recognised by `(txHash, eventIndex)` and skipped.

Known limit: the RPC returns at most 200 events per request. If one ledger holds
more than 200 events for the contract, polling from that ledger cannot reach the
rest, because the request has no pagination token yet.

## Pledge write boundary

`addPledge()` (`campaignStore.ts`) writes three things in one
`db.transaction(...).immediate()`:

1. the `pledges` row,
2. the `campaigns.pledged_amount` total, and
3. the `pledged` row in `campaign_events`, plus a `pledge_limit_reached` row when
   the pledge reaches the contributor limit.

If any write fails, including the second event after the first succeeded, the
whole transaction rolls back: no pledge, no change to the total, no history. The
funding cap, the contributor limit and the campaign state are re-checked inside
the transaction, so a pledge that loses a race writes nothing. A retry after a
failure therefore commits exactly once, and a pledge that was rolled back leaves
nothing to duplicate.

Databases created before versioned migrations keep this behaviour after the
upgrade. Existing pledges and totals are untouched (old pledges keep `NULL`
`transaction_hash`), and the first new pledge on an upgraded database commits the
same three writes together. `schemaUpgradeTransactions.test.ts` covers each
failure point on a fresh database and on one upgraded from the legacy schema.

### Idempotent pledge requests

`POST /api/campaigns/:id/pledges` accepts an `Idempotency-Key` header
(`middleware/idempotencyMiddleware.ts`, `services/idempotencyCache.ts`):

| Situation | Result |
|-----------|--------|
| Same key, same body, after the first succeeded | Original response replayed (`X-Idempotency-Cache: HIT`); no second pledge. |
| Same key, different body | `422 IDEMPOTENCY_KEY_REUSED`; the stored response is not replayed. |
| Same key, same body, first request still running | Waits for it, then replays its response. `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` if it takes longer than 10 s. |
| Same key from a different contributor | Independent request, so it gets its own pledge. |
| First request failed (non-2xx) | Nothing is stored; the retry runs normally. |
| Repeat at 24 h or later | A new request. The age is checked against the stored timestamp, so the boundary is exact (`now - storedAt >= 24 h`). Expired entries encountered in shared storage are actively purged to maintain clean worker boundaries. |

The key is scoped to API key, campaign and contributor. Request bodies are
compared by a hash that ignores field order.

Limits:

- **Restart.** Without Redis the stored keys live in an in-process LRU cache and
  are lost on restart, so a repeat after a restart is a new request. With Redis
  the entry survives and is replayed.
- **Several workers.** Waiting on an in-progress request is per process. Two
  workers that receive the same key at the same moment do not see each other
  unless they share a Redis cache, and even then there is a short window before
  the first response is stored. A durable store written in the same transaction
  as the pledge would close both gaps.
- The cache key format changed when the contributor scope was added, so a key
  stored before the upgrade is not matched afterwards.

## Index Strategy

Indexes are added based on concrete query plans for common read/write patterns.
Indexes are created by migrations 001, 003, and 004. The startup invariants
re-assert them with `CREATE INDEX IF NOT EXISTS`.

### Campaign indexes

- `idx_campaigns_creator` on `campaigns(creator)` — creator-scoped lookups.
- `idx_campaigns_deadline` on `campaigns(deadline)` — deadline filtering.
- `idx_campaigns_status` on `campaigns(claimed_at, failed_at, deleted_at)` —
  lifecycle status filters.
- `idx_campaigns_created_at` on `campaigns(created_at)` — listing / seed
  verification ordered by creation time.

### Pledge indexes (#874)

Indexes for pledges persistence are chosen from concrete query plans (contributor
history, campaign pledge lists, and active-pledge accounting). All use
`CREATE INDEX IF NOT EXISTS` so migrate stays idempotent.

- `idx_pledges_campaign_id` on `pledges(campaign_id)` — pledges for a campaign.
- `idx_pledges_contributor` on `pledges(contributor, created_at, id)` —
  contributor history pagination (`getPledgesByContributor`).
- `idx_pledges_campaign_refunded` on `pledges(campaign_id, refunded_at)` —
  active-pledge accounting (`SUM` where `refunded_at IS NULL`), used by migrate
  recomputation and seed regression checks.
- `idx_pledges_campaign_created_id` on `pledges(campaign_id, created_at DESC, id DESC)` —
  ordered pledge lists after seed / API reads (`listCampaignPledges`).
- `idx_pledges_transaction_hash` unique partial on `pledges(transaction_hash)`
  where `transaction_hash IS NOT NULL`.

### Seed-workflo