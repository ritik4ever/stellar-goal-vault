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

To roll back, call `rollbackMigrations(db, targetVersion)`. It runs the down
scripts newest first and removes their `schema_migrations` rows.

### Databases created before versioned migrations

Databases created before the runner existed have tables but no
`schema_migrations` rows. On first startup, `upgradeLegacySchema()`
(`src/db/legacySchema.ts`) idempotently brings them to the schema of
`LEGACY_BASELINE_VERSION` (004). It adds missing columns, derives
`accepted_tokens_json` from a legacy `asset_code`, removes duplicate
transaction hashes, and backfills `campaigns_fts`. Migrations 001–004 are then
recorded as applied. That module is frozen, so new schema work goes in
migration files.

### Startup invariants

After migrations, `applyStartupInvariants()` runs on every startup. It
backfills `pledges.token_id` and rebuilds the cached `campaigns.pledged_amount`.
It also re-asserts the query-plan indexes and campaign integrity triggers with
`IF NOT EXISTS`. It does not change the schema.

Update the focused database tests (`src/db/versionedMigrations.test.ts`) when a
schema object or invariant changes.

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

### Seed-workflow / FK child indexes

- `idx_notifications_campaign_id` on `notifications(campaign_id)` — speeds
  foreign-key child discovery when the seed wipe deletes campaigns (and any
  campaign-scoped notification lookups).
- `idx_campaign_comments_campaign_id` on `campaign_comments(campaign_id)`.
- `idx_campaign_events_campaign_id` on `campaign_events(campaign_id)`.
- `idx_webhook_dlq_campaign_id` on `webhook_dead_letter_queue(campaign_id)`.

### Query-layer composite indexes (#889)

Installed by `ensureQueryLayerIndexes()` for concrete application read plans:

- `idx_pledges_campaign_contributor` on `pledges(campaign_id, contributor, refunded_at)` —
  contributor totals and refund lookups (`WHERE campaign_id AND contributor AND refunded_at IS NULL`).
- `idx_campaign_events_campaign_timestamp` on `campaign_events(campaign_id, timestamp, id)` —
  ordered campaign history pages.
- `idx_campaign_comments_campaign_created` on `campaign_comments(campaign_id, deleted_at, created_at DESC)` —
  soft-deleted comment lists per campaign.
- `idx_campaign_events_source` on `json_extract(blockchain_metadata, '$.source')` —
  filtering local vs soroban history events.

### Migration-runner query indexes

Created by migration 004 and re-asserted by `ensureMigrationRunnerIndexes()` to accelerate backfill, deduplication, and cached accounting query plans during schema upgrades:

- `idx_pledges_token_id_null` partial index on `pledges(token_id)` where `token_id IS NULL` — speeds legacy `token_id` backfill (`UPDATE pledges SET token_id = asset_code WHERE token_id IS NULL`).
- `idx_pledges_campaign_refunded` covering index on `pledges(campaign_id, refunded_at)` — accelerates campaign `pledged_amount` recomputation (`UPDATE campaigns SET pledged_amount = ...`).
- `idx_pledges_tx_hash_migration` partial index on `pledges(transaction_hash)` where `transaction_hash IS NOT NULL` — accelerates `transaction_hash` deduplication (`GROUP BY transaction_hash`).

### Pledge query invariants (#891)

Pledge writes use an SQLite `IMMEDIATE` transaction before reading contributor
totals or campaign accounting. This reserves the writer before the cap checks,
then re-reads campaign lifecycle and cap data inside the transaction. A second
writer therefore cannot validate against the same stale pledged total. Pledge
amounts must be finite, positive, and remain at least `0.01` after currency
rounding. Rejected writes leave the pledge row, cached campaign total, and event
history unchanged. Contributor summaries break equal-total ties by contributor
address so query results are deterministic.
