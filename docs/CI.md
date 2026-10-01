# CI workflow concurrency

Pushing a new commit to a pull request or feature branch **cancels the superseded run** of the same workflow, so CI doesn't spend runners on commits that are no longer the head.

## The policy

Every workflow triggered by `pull_request` or `push` declares this block right before `jobs:`:

```yaml
# Cancel superseded runs for the same PR or branch. Runs on main get a
# unique group, so they are never cancelled or queued. See docs/CI.md.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && format('run-{0}', github.run_id) || github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

| Event | Concurrency group | Effect |
|---|---|---|
| Pull request | `<workflow>-<PR number>` | A new commit on the PR cancels the older run. |
| Push to a feature branch | `<workflow>-refs/heads/<branch>` | A new push cancels the older run. |
| Push, schedule, or manual run on `main` | `<workflow>-run-<run id>` (unique) | **Never cancelled or queued.** Every commit on `main` is fully verified. |

The group includes `github.workflow`, so different workflows never cancel each other.

## Exempt workflows

These never cancel in-progress runs, because interrupting them could leave a release or deployment half-done:

- `release.yml`: Release Please and the image publish it triggers
- `publish-ghcr.yml`: Docker image publishing
- `contract-deployment.yml`: testnet / staging / mainnet contract deploys
- `load-test.yml`: schedule / manual only
- `fuzz.yml`: no triggers

## Guard

`scripts/check-workflow-concurrency.mjs` enforces the policy and runs in the `Workflow Concurrency Policy` job of `ci.yml`. It fails when:

- a `pull_request`/`push` workflow is missing the block, or its block differs from the standard one
- an exempt release/deploy workflow sets `cancel-in-progress`

When adding a workflow:

```sh
node scripts/check-workflow-concurrency.mjs --fix   # inserts the standard block where missing
node scripts/check-workflow-concurrency.mjs         # check
node --test scripts/check-workflow-concurrency.test.mjs
```

If a new workflow releases, publishes, or deploys, add it to `EXEMPT` in the script instead.
