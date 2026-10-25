#!/usr/bin/env bash
# ------------------------------------------------------------------
# Benchmark the refund contract path (refund / refund_all)
# ------------------------------------------------------------------
# Usage:
#   ./scripts/bench-refund.sh [--update-baseline]
#
# Builds the release WASM, then runs the ignored `bench_refund_path` test,
# which deploys that WASM in the Soroban test host, meters each refund
# scenario and compares the results with
# contracts/benchmarks/refund-costs.tsv. No network or account is needed,
# and results are deterministic for a given contract build and SDK version.
#
# Options:
#   --update-baseline   Overwrite the committed baseline with this run.
#
# Requires:
#   - stellar CLI (for `stellar contract build`)
#
# Output:
#   - Markdown table of every metric that differs from the baseline
#   - Full results in contracts/target/bench/refund-costs.tsv
#   - Exits non-zero if any metric regressed by more than 10%.
# ------------------------------------------------------------------

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS_DIR="$(cd "$HERE/../contracts" && pwd)"

UPDATE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-baseline) UPDATE=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

cd "$CONTRACTS_DIR"

mkdir -p target/bench
LOG="target/bench/refund-bench.log"

echo "Building release WASM..."
if ! stellar contract build >target/bench/build.log 2>&1; then
  cat target/bench/build.log
  exit 1
fi
grep -E 'Wasm (File|Size)' target/bench/build.log || true

echo "Running refund benchmark..."
rm -f target/bench/refund-costs.tsv

# The capacity search deliberately drives refund_all past the network
# limits and the host logs each rejected attempt, so the full output goes to
# $LOG and only the results are printed.
status=0
BENCH_UPDATE="$UPDATE" cargo test --release --lib bench_refund_path \
  -- --ignored --nocapture >"$LOG" 2>&1 || status=$?

grep -E '^\||^scenario|^wasm_size|^refund|^baseline|^no baseline|regressed|^test result' "$LOG" || true

if [ "$status" != 0 ]; then
  echo "❌ refund benchmark failed; full output in contracts/$LOG"
  exit "$status"
fi
echo "✅ Results written to contracts/target/bench/refund-costs.tsv"
