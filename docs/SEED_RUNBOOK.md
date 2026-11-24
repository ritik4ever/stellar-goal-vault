# Development seed data runbook

The deterministic seed resets a **local** SQLite database to a known campaign
and pledge layout. It never touches Friendbot, Freighter, or live Stellar
networks.

Implementation: [`backend/src/services/seedDeterministic.ts`](../backend/src/services/seedDeterministic.ts)  
CLI: `cd backend && npm run seed` (optional `--count N`)

## What a successful run looks like

| Signal | Meaning |
| --- | --- |
| Exit code `0` | Seed transaction committed |
| Stdout `Seeded N campaign(s): 1, 2, …` | Inserted IDs in order |
| Default `N = 3` | Fixed open, funded, and claimed fixtures |
| `N > 3` | Extra campaigns cycle open → funded → claimed |

### Fixed fixtures (IDs 1–3)

| ID | Scenario | How to recognize it |
| --- | --- | --- |
| `1` | **Open** | `claimed_at` is null; `pledged_amount` &lt; `target_amount` |
| `2` | **Funded** | `claimed_at` is null; `pledged_amount` ≥ `target_amount` |
| `3` | **Claimed** | `claimed_at` is set |

Running the command **twice on the same database** is guarded: the seed detects
the existing deterministic fixtures and stops with an `already seeded` message
instead of wiping data. Counts and amounts stay identical across reruns.

### Rerun guard and recovery

A second `npm run seed` on an already-seeded local database exits non-zero with
a clear `already seeded` message and makes no changes. To reseed:

- `cd backend && npm run seed:force` — passes `--force` to the seed, which
  wipes notifications, comments, events, pledges, campaigns, and `campaigns_fts`
  inside one transaction, then re-inserts the same rows; or
- delete the local DB file (`rm "${DB_PATH:-./data/campaigns.db}"`) and restart
  the backend, then run `npm run seed` again.

## How to inspect outcomes

```bash
cd backend
npm run seed
# or: npm run seed -- --count 10

sqlite3 "${DB_PATH:-./data/campaigns.db}" \
  "SELECT id, title, target_amount, pledged_amount, claimed_at FROM campaigns ORDER BY CAST(id AS INTEGER);"
```

Focused regression coverage (no live funds):

```bash
cd backend
npm test -- src/services/seedDeterministic.test.ts
```

## Observable failure signals

| Signal | Likely cause | What to do |
| --- | --- | --- |
| `Invalid --count value` / `count must be a positive integer` | `--count` missing, `0`, or non-integer | Pass a positive integer, e.g. `--count 5` |
| `already seeded` (non-zero exit) | Deterministic fixtures already exist in this DB | Reseed with `npm run seed:force`, or delete the DB file and restart the backend |
| `--force` ignored / unknown flag | Older seed build without rerun guard | Update the backend, then use `npm run seed:force` |
| `SQLITE_CANTOPEN` / cannot open DB | `DB_PATH` directory missing or not writable | Create the directory; see [TROUBLESHOOTING](./TROUBLESHOOTING.md) |
| `FOREIGN KEY` / constraint errors mid-seed | Unexpected schema or partial manual edits | Re-run seed (atomic wipe) or delete the DB file and restart the backend |
| Seed IDs or amounts change between two runs | Different `--count`, or not using this seed path | Re-run with the same `--count`; compare against the test file |
| Tests fail only on a dirty shared DB | Concurrent test process holding the file | Stop other vitest processes; clear `test-temp-*.db*` / the seed test DB path |

## Safety

- Development / local QA only — do **not** point `DB_PATH` at production.
- Synthetic `G…` addresses only; no funded accounts.
- Related E2E wallet mocks: [`e2e/README.md`](../e2e/README.md).
