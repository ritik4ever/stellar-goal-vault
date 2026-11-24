# Campaign Metadata Update Boundaries (SGV-2026-141 / issue #1521)

This document specifies the observable behavior of
`StellarGoalVaultContract::update_metadata`. It is the reference for the
contract implementation, the focused tests in `src/test.rs`, the backend event
indexer, and any client that exposes "edit campaign metadata".

Related work: issue #185 introduced the update entry point and the
`MetadataUpdated` event.

## Entry point

```rust
pub fn update_metadata(
    env: Env,
    campaign_id: u64,
    creator: Address,
    new_metadata: String,
)
```

There is no return value. Success is observed through storage and the emitted
event; failure aborts the whole invocation.

## Authorization boundary

| Caller | Result |
| --- | --- |
| Original campaign creator, campaign active | Accepted |
| Any address other than `campaign.creator` | Rejected: `creator mismatch` |
| Creator whose authorization is missing | Rejected by `require_auth()` |

`creator.require_auth()` is called before any state is read or written, and the
provided address must also equal the address stored on the campaign. Knowing
the campaign id is therefore not sufficient: only the address that created the
campaign can change its metadata.

## Campaign-state boundary

An update is a *live-campaign* operation. All of the following must hold:

| Condition | Requirement | Failure message |
| --- | --- | --- |
| Contract not paused | `Paused == false` | `contract is paused` |
| Campaign exists | a `Campaign(campaign_id)` entry is present | `campaign not found` |
| Campaign not claimed | `claimed == false` | `campaign already claimed` |
| Campaign not canceled | `canceled == false` | `campaign canceled` |
| Before the deadline | `ledger.timestamp < deadline` | `campaign deadline reached` |

The deadline comparison is strict: `deadline - 1` is the last accepted ledger
timestamp and the deadline itself (`timestamp == deadline`) is already closed.
The check order is fixed as listed above, so when several conditions fail at
once the first one in the table determines the error. In particular, a claimed
campaign reports `campaign already claimed` even after its deadline, and a
canceled campaign reports `campaign canceled` even though it may still be before
the deadline.

No amounts, balances, or pledged totals are read or written by this entry
point, so there is no amount arithmetic (and no overflow surface) in the update
path.

## Data boundary

- `new_metadata` is an arbitrary `soroban_sdk::String`; the contract does not
  interpret it and does not impose a length limit.
- The empty string is valid and clears the stored metadata; clients should
  treat it as "no metadata" rather than as a malformed request.
- The previous value is replaced as a whole. There is no merge or patch
  semantics.
- Repeated updates are allowed while the campaign remains active. Each update
  is independent and the next update's `old_metadata` is the previous update's
  `new_metadata`.
- The update does not alter `creator`, `accepted_tokens`, `target_amount`,
  `pledged_amount`, `deadline`, `claimed`, `canceled`, `contributor_count`, or
  `created_at`.

## Event contract

A successful update emits exactly one event with:

- Contract: the vault contract address
- Topics: `("Goal", "MetaUpd")` (`symbol_short!` values)
- Data: the `MetadataUpdated` struct

```rust
pub struct MetadataUpdated {
    pub campaign_id: u64,
    pub creator: Address,
    pub old_metadata: String,
    pub new_metadata: String,
}
```

`old_metadata` is the value that was stored immediately before the call and
`new_metadata` is the value that is stored immediately after it. Both values are
captured in the same invocation, so off-chain consumers can reconstruct the
full edit history without reading prior ledger state.

No event is emitted when the call is rejected: `require_auth()` and every
boundary check run before the storage write and before `events().publish`.

## Atomicity

The sequence inside a successful call is:

1. Check pause state and authorization.
2. Read the campaign and enforce creator/claimed/canceled/deadline boundaries.
3. Capture `old_metadata`.
4. Overwrite the campaign's `metadata` field and persist the campaign.
5. Publish `MetadataUpdated`.

A failure in steps 1–2 panics before step 4, so the stored campaign and the
event stream are unchanged. The event is only published after the new value has
been written, therefore an emitted event always describes persisted state.

## Backend consumption

The event indexer maps both `MetadataUpdated` and `Goal:MetaUpd` topics to the
internal `metadata_updated` event type and uses `new_metadata` to update local
campaign state. `old_metadata` is retained in the event payload for audit and
debugging but is not required to apply the update.

## Test coverage

`contracts/src/test.rs` contains focused boundary tests:

| Test | Boundary exercised |
| --- | --- |
| `test_update_metadata_success` | Creator-only update; event carries old and new values; unrelated fields unchanged |
| `test_update_metadata_last_moment_before_deadline_succeeds` | `timestamp == deadline - 1` is accepted |
| `test_update_metadata_rejects_exactly_at_deadline` | `timestamp == deadline` is rejected |
| `test_update_metadata_rejects_after_deadline` | Post-deadline rejection |
| `test_update_metadata_records_chained_old_and_new_values` | Consecutive updates chain `old_metadata` to the previous `new_metadata` |
| `test_update_metadata_allows_empty_string` | Empty metadata is a valid value |
| `test_update_metadata_rejected_call_leaves_metadata_unchanged` | Rejected calls are atomic and emit no state change |
| `test_update_metadata_rejects_non_creator` | Authorization boundary |
| `test_update_metadata_rejects_claimed_campaign` | Claimed campaigns are closed to edits |
| `test_update_metadata_rejects_canceled_campaign` | Canceled campaigns are closed to edits |
| `test_update_metadata_blocked_when_paused` | Emergency pause boundary |

Run them with:

```bash
cd contracts
cargo test --features testutils update_metadata
```
