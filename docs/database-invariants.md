# Campaign persistence invariants

`backend/src/services/db.ts` is the authoritative SQLite schema and migration
entry point. `backend/src/services/campaignStore.ts` owns campaign lifecycle
operations; the database guardrails below are the final protection against
invalid persisted state.

## Ownership and keys

- `campaigns.id` is the stable text primary key.
- `campaigns.creator` is the Stellar account that owns the campaign.
- `pledges.campaign_id` references `campaigns.id`; foreign keys are enabled at
  connection initialization.
- `pledges.transaction_hash` is unique when present, which makes on-chain
  reconciliation idempotent.

## Campaign invariants

- IDs, creator addresses, titles, descriptions, and accepted-token JSON are
  non-empty.
- Accepted tokens are a non-empty JSON array.
- Target and pledged amounts are non-negative, with pledged amount never above
  the target amount.
- Deadline and creation timestamps are positive.
- A campaign cannot be both claimed and failed.
- The lifecycle status is derived from `claimed_at`, `failed_at`, funding, and
  the deadline; callers must use `calculateProgress` rather than persisting a
  second status column.

## Pledge invariants

- Pledge amount, contributor, asset code, and creation timestamp are valid.
- A refund timestamp cannot precede pledge creation.
- Application-level checks enforce accepted assets, campaign state, per-user
  limits, and the funding cap; the database triggers enforce the safe subset
  even when a write bypasses the service layer.

## Migration and seed expectations

The integrity triggers are idempotent and are installed during normal database
initialization, so existing valid databases migrate without data rewriting.
The deterministic seed runs in one transaction, validates its campaign totals,
and is safe to rerun because it clears dependent events and pledges first.
Any future schema change must preserve existing valid campaign rows or include
an explicit data migration before enabling a stricter invariant.
