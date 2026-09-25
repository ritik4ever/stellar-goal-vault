# SQLite Schema Contract

`db.ts` is the authoritative migration runner. `initDb()` applies its
idempotent schema changes to the configured SQLite database on every startup.
Migrations must preserve existing rows and remain safe to run more than once.

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
- `campaigns_fts` is a derived search index maintained by triggers. It can be
  rebuilt from `campaigns` and is never the source of truth.

## Query-layer integrity constraints (#888)

The query layer (`getPledgesByContributor` and related reads) assumes persisted
rows already satisfy a safe subset of application invariants. Those invariants
are enforced at the database layer:

| Table | Constraint (safe subset) |
| --- | --- |
| `campaigns` | non-empty `creator`/`title`/`description`/`accepted_tokens_json`; `target_amount > 0`; `pledged_amount >= 0`; positive `deadline`/`created_at`; mutually exclusive `claimed_at`/`failed_at`; `max_per_contributor` null or `>= 0` |
| `pledges` | non-empty `campaign_id`/`contributor`/`asset_code`; `amount > 0`; positive `created_at`; `refunded_at` null or `>= created_at` |
| `campaign_events` | non-empty `campaign_id`/`event_type`; positive `timestamp`; `amount` null or `>= 0` |
| `campaign_comments` | non-empty `campaign_id`/`author`/`content`; positive `created_at` |

Fresh databases receive these as `CHECK` constraints on `CREATE TABLE`. Existing
databases receive equivalent `BEFORE INSERT/UPDATE` triggers
(`*_query_integrity_*`) because SQLite cannot add `CHECK` via `ALTER TABLE`.
Valid historical rows migrate unchanged; invalid inserts/updates are aborted.

Query helpers also clamp pagination (`page >= 1`, `1 <= limit <= 100`) so
`LIMIT`/`OFFSET` cannot go negative or unbounded.


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

Fresh databases receive these as `CHECK` constraints on `CREATE TABLE`. Existing
databases receive equivalent `BEFORE INSERT/UPDATE` triggers
(`campaigns_persistence_integrity_*`) because SQLite cannot add `CHECK` via
`ALTER TABLE`. On migrate, negative `pledged_amount` values are soft-cleaned to
`0` so valid accounting updates continue; other historical rows are left
unchanged. Invalid inserts/updates are aborted.

## Migration expectations

Use `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS` for new objects and guarded
`ALTER TABLE` changes for existing objects, following the patterns in
`db.ts`. Additive changes must account for databases created by older
versions, backfill only when the existing data has a clear default, and avoid
rewriting lifecycle or accounting history. Update the focused database test
when a schema object or invariant changes.

## Index Strategy

Indexes are added based on concrete query plans for common read/write patterns.
All indexes use `CREATE INDEX IF NOT EXISTS` to ensure idempotence.

### Campaign Indexes

- `idx_campaigns_creator` on `campaigns(creator)`
- `idx_campaigns_deadline` on `campaigns(deadline)`
- `idx_campaigns_status` on `campaigns(claimed_at, failed_at, deleted_at)`

### Pledge Indexes

- `idx_pledges_campaign_id` on `pledges(campaign_id)`
- `idx_pledges_contributor` on `pledges(contributor, created_at, id)`
- `idx_pledges_transaction_hash` unique partial index on `pledges(transaction_hash)` where not null

### Comment Indexes

- `idx_campaign_comments_campaign_id` on `campaign_comments(campaign_id)`
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
