#!/usr/bin/env bash
# ------------------------------------------------------------------
# Pledge-path resource benchmark (offline, deterministic)
# ------------------------------------------------------------------
# Builds the release WASM, meters each pledge-path scenario in the Soroban
# test host (contracts/src/test_pledge_bench.rs), and compares the result
# with the committed baseline. No network, account or secret is needed.
#
# Usage:
#   ./scripts/bench-pledge.sh [--native] [--update-baseline] [--threshold PCT]
#
# Options:
#   --native            Skip the WASM build and meter the native Rust contract.
#                       Faster, but under-counts VM costs; the baseline is
#                       recorded in wasm mode, so comparisons are skipped.
#   --update-baseline   Overwrite contracts/benchmarks/pledge_baseline.tsv
#                       with this run (commit it together with the change).
#   --threshold PCT     Allowed increase per metric before failing (default 10).
#
# Output:
#   contracts/target/bench/pledge_current.tsv (git-ignored) and a markdown
#   comparison table on stdout. Exits 1 if any metric grows by more than
#   the threshold, or if a baseline scenario is missing.
# ------------------------------------------------------------------

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS="$(cd "$HERE/../contracts" && pwd)"
BASELINE="$CONTRACTS/benchmarks/pledge_baseline.tsv"
OUT_DIR="$CONTRACTS/target/bench"
CURRENT="$OUT_DIR/pledge_current.tsv"
WASM="$CONTRACTS/target/wasm32v1-none/release/stellar_goal_vault.wasm"
THRESHOLD=10
NATIVE=false
UPDATE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --native) NATIVE=true; shift ;;
    --update-baseline) UPDATE=true; shift ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$OUT_DIR"
cd "$CONTRACTS"

if [ "$NATIVE" = false ]; then
  if ! command -v stellar >/dev/null 2>&1; then
    echo "ERROR: stellar CLI not found (soroban-sdk 28 requires 'stellar contract build')."
    echo "Install stellar-cli v25.2.0+, or rerun with --native."
    exit 1
  fi
  echo "Building release WASM..."
  stellar contract build >"$OUT_DIR/build.log" 2>&1 || { echo "ERROR: build failed; see $OUT_DIR/build.log"; exit 1; }
  export GOAL_VAULT_BENCH_WASM="$WASM"
  WASM_BYTES=$(wc -c < "$WASM" | tr -d ' ')
else
  unset GOAL_VAULT_BENCH_WASM
  WASM_BYTES=0
fi

echo "Running pledge benchmarks..."
LOG="$OUT_DIR/pledge_bench.log"
if ! cargo test --features testutils test_pledge_bench::bench_ \
      -- --ignored --nocapture --test-threads=1 >"$LOG" 2>&1; then
  echo "ERROR: benchmark run failed; see $LOG"
  exit 1
fi

{
  printf '# wasm_bytes\t%s\n' "$WASM_BYTES"
  printf 'scenario\tmode\tinstructions\tmem_bytes\tread_entries\twrite_entries\twrite_bytes\tevents_bytes\tfee_stroops\n'
  # The first line of each test shares its line with libtest's "test ... "
  # prefix, so match the marker anywhere rather than at line start.
  grep -oE $'BENCH\t.*' "$LOG" | cut -f2- | LC_ALL=C sort
} > "$CURRENT"
echo "Wrote $CURRENT"

if [ "$UPDATE" = true ]; then
  if [ "$NATIVE" = true ]; then
    echo "ERROR: the baseline is recorded in wasm mode; rerun without --native."
    exit 1
  fi
  cp "$CURRENT" "$BASELINE"
  echo "Updated $BASELINE"
  exit 0
fi

if [ ! -f "$BASELINE" ]; then
  echo "No baseline at $BASELINE; run with --update-baseline to create one."
  exit 0
fi

awk -F'\t' -v threshold="$THRESHOLD" '
  function pct(old, new) { return old == 0 ? (new == 0 ? 0 : 100) : (new - old) * 100 / old }
  FNR == 1 && /^# wasm_bytes/ { if (NR == FNR) base_wasm = $2; else cur_wasm = $2; next }
  $1 == "scenario" { for (i = 3; i <= NF; i++) col[i] = $i; ncol = NF; next }
  NR == FNR { base_mode[$1] = $2; for (i = 3; i <= NF; i++) base[$1, i] = $i; order[++n] = $1; next }
  { cur_mode[$1] = $2; for (i = 3; i <= NF; i++) cur[$1, i] = $i; if (!($1 in base_mode)) extra[$1] = 1 }
  END {
    fail = 0
    printf "## Pledge path: baseline vs current (threshold +%s%%)\n\n", threshold
    if (cur_wasm > 0) {
      d = pct(base_wasm, cur_wasm)
      printf "WASM size: %d -> %d bytes (%+.1f%%)\n\n", base_wasm, cur_wasm, d
      if (d > threshold) fail = 1
    }
    rows = ""
    for (k = 1; k <= n; k++) {
      s = order[k]
      if (!(s in cur_mode)) { rows = rows sprintf("| `%s` | — | — | missing | ❌ |\n", s); fail = 1; continue }
      if (cur_mode[s] != base_mode[s]) { rows = rows sprintf("| `%s` | mode | %s | %s | skipped |\n", s, base_mode[s], cur_mode[s]); continue }
      for (i = 3; i <= ncol; i++) {
        if (base[s, i] == cur[s, i]) continue
        d = pct(base[s, i], cur[s, i])
        mark = d > threshold ? " ❌" : ""
        if (d > threshold) fail = 1
        rows = rows sprintf("| `%s` | %s | %s | %s | %+.1f%%%s |\n", s, col[i], base[s, i], cur[s, i], d, mark)
      }
    }
    for (s in extra) rows = rows sprintf("| `%s` | — | — | new | add to baseline |\n", s)
    if (rows == "") print "All scenarios match the baseline exactly."
    else printf "| Scenario | Metric | Baseline | Current | Delta |\n|---|---|---:|---:|---:|\n%s", rows
    print ""
    if (fail) { print "❌ Regression above threshold (or missing scenario)."; exit 1 }
    print "✅ No metric grew by more than " threshold "%. Unchanged metrics are omitted."
  }
' "$BASELINE" "$CURRENT"
