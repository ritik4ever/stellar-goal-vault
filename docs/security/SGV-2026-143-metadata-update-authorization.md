# SGV-2026-143: Campaign metadata update authorization

This note records the security contract for `update_metadata` and maps issue
[#1523](https://github.com/ritik4ever/stellar-goal-vault/issues/1523) to the
implementation and regression coverage.

## Authorization and lifecycle rules

The Soroban entry point is `update_metadata(env, campaign_id, creator, new_metadata)`
in `contracts/src/lib.rs`. Before changing persistent campaign state, it:

1. Rejects calls while the contract is paused (`require_not_paused`).
2. Requires an authorization signature from the supplied `creator`
   (`creator.require_auth()`).
3. Loads the campaign and verifies that the supplied address is exactly the
   campaign's recorded creator.
4. Rejects campaigns that have already been claimed or canceled.
5. Rejects updates when the ledger timestamp is greater than or equal to the
   campaign deadline. The last permitted timestamp is therefore
   `deadline - 1`; an update at the exact deadline is too late.

Only after all checks pass does the contract persist the new metadata and emit
the `Goal/MetaUpd` event. The event contains the campaign ID, creator, previous
metadata, and new metadata. A rejected call therefore does not write the new
metadata or publish a metadata-update event.

## Regression coverage

The focused regression test is
`update_metadata_at_last_moment_before_deadline_enforces_creator_auth_and_emits_event`
in `contracts/src/test_pledge_auth.rs`. It exercises:

- a non-creator attempting an update at `deadline - 1`;
- an unsigned call claiming to be the creator at `deadline - 1`;
- unchanged campaign metadata, pledge totals, and token balances after rejected calls;
- a valid creator-signed update at `deadline - 1`, including the emitted old/new
  metadata event; and
- rejection of the creator's update at the exact deadline, with metadata unchanged.

The test seeds an active pledge and checks the relevant balances, so the
authorization assertions also guard against side effects on pledged funds.
It uses the Soroban test environment and does not interact with live funds.

## Scope

This is documentation of the existing contract behavior and regression test;
it does not change the contract's authorization policy or settlement logic.
The claim/refund paths remain governed by their own entry-point checks.
