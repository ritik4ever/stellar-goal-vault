# Chaos tests

Fault-injection scripts that verify the backend keeps pledge accounting correct
when it dies without warning.

## Kill backend mid-pledge

```bash
npm run test:chaos
```

What it does:

1. Boots the backend against a throwaway SQLite file in `scripts/chaos/.chaos-data/`
   (never your dev database).
2. Creates a campaign and fires concurrent pledges, each with a unique amount so
   individual pledges are traceable in the database.
3. `SIGKILL`s the backend 200ms in (`taskkill /F /T` on Windows) — no graceful
   shutdown, no WAL checkpoint.
4. Asserts a non-empty `chaos.db-wal` was left behind, i.e. the shutdown really
   was unclean and there are frames to recover.
5. Restarts the backend so SQLite replays the WAL on open.
6. Asserts, against both the API and the database file:
   - no pledge amount appears more than once (nothing double-counted),
   - every pledge that got a `201` before the kill is present exactly once
     (nothing lost),
   - `campaigns.pledged_amount == SUM(pledges.amount)`,
   - `PRAGMA journal_mode` is still `wal` and `PRAGMA integrity_check` is `ok`.

Pledges still in flight when the process died may be present or absent — either
is correct — but they must never be half-applied or duplicated.

Exit code is `0` on pass, `1` on any failed assertion (with a summary).

### Configuration

| Env var                | Default | Purpose                              |
| ---------------------- | ------- | ------------------------------------ |
| `CHAOS_PORT`           | `4599`  | Port the backend under test binds to |
| `CHAOS_PLEDGES`        | `12`    | Concurrent pledges to fire           |
| `CHAOS_KILL_AFTER_MS`  | `200`   | Delay before the kill                |

The script runs `backend/dist/index.js` when it exists, otherwise
`ts-node --transpile-only backend/src/index.ts`, so `npm install` in `backend/`
is enough — no extra dependencies.

### Why the backend survives this

`addPledge` commits the pledge row, the campaign total and the emitted events in
a single `db.transaction(...)`. Before that, a kill landing between the `INSERT`
and the `UPDATE` left `campaigns.pledged_amount` permanently out of sync with
the pledge rows — which is exactly what this test reproduces.
