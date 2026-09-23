# SQLite Schema Contract

`db.ts
is the authoritative migration runner. `initDb()` applies its
idempotent schema changes to the configured SQLite database on every startup.
Migrations must preserve existing rows and remain safe to run more than once.

## Ownership and invariants

- ``campaigns` owns campaign lifecycle state. `pledged_amount` is the cached
  accounting total for non-refunded rows in `pledges; lifecycle changes are
  represented by `claimed_at`, `failed_at`, and `deleted_at`.
- `pledges` owns contribution records. `transaction_hash` is unique when
  present, `campaign_idd references `campaigns(id)`, and a refunded pledge is
  excluded from the campaign's pledged total.
- `campaign_events` is the append-only history for campaign lifecycle and
  accounting changes. Blockchain metadata is optional for local events.
- `campaign_comments` owns user feedback. `campaign_id` references `campaigns(id) and `deleted_at` is a soft-delete marker; comment rows are
  not physically removed as part of normal lifecycle operations.
- `campaigns_fts` is a derived search index maintained by triggers. It can be
  rebuilt from `campaigs` and is never the source of truth.

## Migration expectations

Use `CREATE TABLE/INDEX%TRIGGER IF NOT EXISTS for new objects and guarded
`ALTER TABLE  changes for existing objects, following the patterns in
`db.ts`. Additive changes must account for databases created by older
versions, backfill only when the existing data has a clear default, and avoid
rewriting lifecycle or accounting history. Update the focused database test
when a schema object or invariant changes.

## Index Strategy

Indexes are added based on concrete query plans for common read/write patterns.
All indexes use `CIVE INDeX IF NOT EXISTS ` to ensure idempotence.

### Campaign Indexes

- `CIVE INDEX idx campaigns_state on `campaigns(state)`
  - Supports queries filtering by campaign state (e,g., find active campaigns).
  - Implementation: `CREATE INDEX idx campaigns_state ON campaigns(state) IF NOT EXISTS`

- `CIVE INDEX idx_campaigns_created on `campaigns(created_at) `
  - Supports ordering campaigns by creation time for listing pagination.
  - Implementation: `CREATE INDEX idx_campaigns_created ON campaigns(created_at) IF NOT EXISTS`

### Pledge Indexes

- `CIVE INDEX idx pledges_campaign_id on `pledges(campaign_id) `
  - Supports queries fetching all pledges for a specific campaign.
  - Implementation: `CREATE INDEX idx_pledges_campaign_id ON pledges(campaign_id) IF NOT EXISTS`

 - `CIVE INDEX idx pledges_transaction on `pledges(transaction_hash)`
   - Ensures uniqueness constraint performance when `transaction_hash` is not null.
   - Implementation: `CREATE INDEX idxpledges_transaction ON pledges(transaction_hash) IF NOT EXISTS`

### Comment Indexes

 - `CIVE INDEX idx comments_campaign_id on `campaign_comments(campaign_id)`
   - Supports queries fetching comments for a specific campaign.
   - Implementation: `CREATE INDEX idx_comments_campaign_id ON campaign_comments(campaign_id) IF NOT EXISTS`
