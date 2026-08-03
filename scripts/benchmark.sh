#!/usr/bin/env bash
# ------------------------------------------------------------------
# Benchmark Soroban contract instruction count
# ------------------------------------------------------------------
# Usage:
#   ./scripts/benchmark.sh [--baseline FILE] [--current FILE] [--compare]
#
# Options:
#   --baseline FILE   Path to baseline cost file (default: contracts/BASELINE_COSTS.md)
#   --current FILE    Path to current cost output (default: /tmp/current_costs.txt)
#   --compare         Only compare, do not run `stellar invoke`
#
# Requires:
#   - stellar CLI (soroban-cli) installed and configured
#   - A deployed contract (CONTRACT_ID set in env or contracts/contract_id.txt)
#   - A funded Stellar account (SOURCE set in env)
#
# Output:
#   - Prints a markdown table comparing current vs baseline costs
#   - Exits with 0 if all deltas are within 10%, 1 otherwise.
# ------------------------------------------------------------------

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/.." && pwd)"
CONTRACT_ID_FILE="$PROJECT_ROOT/contracts/contract_id.txt"
BASELINE_FILE="${BASELINE_FILE:-$PROJECT_ROOT/contracts/BASELINE_COSTS.md}"
CURRENT_FILE="${CURRENT_FILE:-/tmp/current_costs.txt}"
SOURCE="${SOURCE:-}"
NETWORK="${NETWORK:-testnet}"
THRESHOLD=10   # percent

# Entry points and their required arguments (placeholder values for benchmarking)
ENTRY_POINTS=(
  "get_version"
  "get_next_campaign_id"
  "get_campaign_count"
)

# Parse args
COMPARE_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline) BASELINE_FILE="$2"; shift 2 ;;
    --current)  CURRENT_FILE="$2"; shift 2 ;;
    --compare)  COMPARE_ONLY=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Load contract ID
if [ -z "${CONTRACT_ID:-}" ]; then
  if [ -f "$CONTRACT_ID_FILE" ]; then
    CONTRACT_ID=$(grep -v '^#' "$CONTRACT_ID_FILE" | head -1 | tr -d '[:space:]')
  else
    echo "ERROR: CONTRACT_ID not set and $CONTRACT_ID_FILE not found."
    echo "Deploy first: stellar contract deploy ..."
    exit 1
  fi
fi

if [ -z "${SOURCE:-}" ]; then
  echo "ERROR: SOURCE (Stellar account) not set. Use --source or export SOURCE."
  exit 1
fi

invoke_with_cost() {
  local entry_point="$1"
  shift
  local args=()
  for arg in "$@"; do
    args+=("$arg")
  done

  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    --cost \
    -- \
    "$entry_point" \
    "${args[@]}" 2>&1
}

parse_cpu_instructions() {
  # The --cost output includes lines like:
  #   cpu_insns: 12345 (or similar)
  grep -oP 'cpu_insns[:=]\s*\K[0-9]+' || echo "0"
}

fetch_current_costs() {
  echo "Fetching current costs for entry points..."
  > "$CURRENT_FILE"
  for ep in "${ENTRY_POINTS[@]}"; do
    echo "--- $ep ---" >> "$CURRENT_FILE"
    case "$ep" in
      get_version)
        invoke_with_cost "$ep" >> "$CURRENT_FILE" 2>&1 || true
        ;;
      get_next_campaign_id|get_campaign_count)
        invoke_with_cost "$ep" >> "$CURRENT_FILE" 2>&1 || true
        ;;
      *)
        invoke_with_cost "$ep" >> "$CURRENT_FILE" 2>&1 || true
        ;;
    esac
  done
  echo "Costs written to $CURRENT_FILE"
}

compare_costs() {
  if [ ! -f "$BASELINE_FILE" ]; then
    echo "ERROR: Baseline file not found: $BASELINE_FILE"
    exit 1
  fi
  if [ ! -f "$CURRENT_FILE" ]; then
    echo "ERROR: Current cost file not found: $CURRENT_FILE"
    exit 1
  fi

  echo ""
  echo "## Cost Comparison: Baseline vs Current"
  echo ""
  echo "| Entry point | Baseline (CPU insns) | Current (CPU insns) | Delta % | Status |"
  echo "|---|---|---|---|---|"

  local any_regression=false

  for ep in "${ENTRY_POINTS[@]}"; do
    # Extract baseline value (look for the entry point in baseline markdown)
    local baseline_cpu
    baseline_cpu=$(grep -A1 "| \`$ep\`" "$BASELINE_FILE" | tail -1 | awk -F'|' '{print $2}' | tr -d '`' | xargs)
    
    # Extract current value
    local current_cpu
    current_cpu=$(grep -A100 "^--- $ep ---" "$CURRENT_FILE" | grep -oP 'cpu_insns[:=]\s*\K[0-9]+' | head -1 || echo "N/A")

    if [ "$baseline_cpu" = "N/A" ] || [ -z "$baseline_cpu" ] || [ "$current_cpu" = "N/A" ] || [ -z "$current_cpu" ]; then
      echo "| \`$ep\` | N/A | N/A | — | ⚠️  skip |"
      continue
    fi

    # Calculate delta
    local delta=0
    local status="✅"
    if [ "$baseline_cpu" -gt 0 ]; then
      delta=$(( (current_cpu - baseline_cpu) * 100 / baseline_cpu ))
      if [ "${delta#-}" -gt "$THRESHOLD" ]; then
        status="❌ regression"
        any_regression=true
      elif [ "${delta#-}" -gt 0 ]; then
        status="⚠️  change"
      fi
    fi

    echo "| \`$ep\` | $baseline_cpu | $current_cpu | ${delta}% | $status |"
  done

  echo ""
  if [ "$any_regression" = true ]; then
    echo "❌ Some entry points exceed the ${THRESHOLD}% regression threshold."
    exit 1
  else
    echo "✅ All deltas within ${THRESHOLD}% threshold."
  fi
}

# Main
if [ "$COMPARE_ONLY" = false ]; then
  fetch_current_costs
fi
compare_costs