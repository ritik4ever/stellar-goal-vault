# Contract integration tests

Tests in this directory link the contract as a normal Rust library
(`crate-type = ["cdylib", "rlib"]`) and drive it through the generated client,
so they see the same authorization, storage, and event behaviour an external
caller sees. Unit tests that need private helpers stay in `src/test.rs`.

## `deadline_extension_regression.rs` (issue #1510)

An isolated regression for the deadline-extension vote. The fixture deploys
its own vault, token, campaign, and four distinct contributors; nothing is
shared with `src/test.rs`, so the suite can run on its own:

```text
cargo test --test deadline_extension_regression
```

Covered properties:

| Test | Asserts |
|---|---|
| `one_valid_extension_commits_with_auditable_unique_votes` | One `ExtReq` then one auto-approval `ExtAppr{1}`; a second distinct vote is still not a majority; the third commits exactly one `Extended{old,new}` after the approval; the request is cleared; the next round starts again at one vote; no balances move |
| `extension_requires_signatures_and_contributor_status` | No signature rejects the request/approval before any write; creator, admin, and outsiders cannot request or approve without pledging; rejected votes do not change the tally or deadline |
| `duplicate_votes_and_invalid_deadlines_are_rejected_without_state_change` | A duplicate vote is rejected with no event and an unchanged tally; a second pending request is rejected; stale and over-maximum deadlines are rejected; the round still commits afterwards; `claim` and `refund` cannot release funds around the change |
| `extension_is_rejected_once_the_campaign_is_settled` | After cancellation, further votes/requests fail, the deadline stays put, and contributors can still refund their own pledge |

Notes for extending this file:

- `env.events().all()` only retains the **most recent invocation**, so capture
  the events immediately after the action under test and before any follow-up
  client read.
- Expected events are compared as `ScVal` values built with `IntoVal`, which is
  stricter than inspecting fields and catches topic or ordering regressions.
- Snapshot files under `test_snapshots/` are generated artifacts; regenerate
  them locally if needed but do not mix them into focused PRs.
