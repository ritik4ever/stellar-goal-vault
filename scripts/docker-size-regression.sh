#!/usr/bin/env bash
# ------------------------------------------------------------------
# Docker image size regression check
# ------------------------------------------------------------------
# Large-dataset regression coverage for the Docker image build.
#
# Builds the backend and frontend production images and compares their
# compressed-on-disk size (a stable performance signal) against the recorded
# baseline in scripts/docker-size-baseline.json. Image size is deterministic
# enough to act as a regression gate without any flaky micro-timing assertions.
#
# Usage:
#   ./scripts/docker-size-regression.sh            # build and check
#   ./scripts/docker-size-regression.sh --no-build  # check existing images only
#
# Environment:
#   TOLERANCE_PCT   Warn threshold for growth vs baseline (default 10)
#
# Exits non-zero when an image exceeds its hard `maxBytes` ceiling.
# ------------------------------------------------------------------

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/.." && pwd)"
BASELINE="$PROJECT_ROOT/scripts/docker-size-baseline.json"
TOLERANCE_PCT="${TOLERANCE_PCT:-10}"
SKIP_BUILD=false
[[ "${1:-}" == "--no-build" ]] && SKIP_BUILD=true

cd "$PROJECT_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read $BASELINE" >&2
  exit 1
fi

if [[ "$SKIP_BUILD" == false ]] && ! command -v docker >/dev/null 2>&1; then
  echo "docker is not available; re-run with --no-build to measure existing images." >&2
  exit 1
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "Baseline file not found: $BASELINE" >&2
  exit 1
fi

to_mb() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1048576 }'; }
delta_pct() { awk -v s="$1" -v b="$2" 'BEGIN { if (b == 0) { print "0.0" } else { printf "%.1f", (s - b) / b * 100 } }'; }

rows=()
failed=0

while IFS=$'\t' read -r service context baseline_bytes max_bytes; do
  [[ -z "$service" ]] && continue
  image="stellar-goal-vault-$service"

  if [[ "$SKIP_BUILD" == false ]]; then
    echo "Building $service image ($context)..."
    if ! docker build -q -t "$image" "$context" >/dev/null; then
      echo "❌ docker build failed for $service" >&2
      exit 1
    fi
  fi

  size_bytes="$(docker image inspect --format '{{.Size}}' "$image" 2>/dev/null || echo "")"
  if [[ -z "$size_bytes" ]]; then
    echo "❌ could not measure image size for $service ($image)" >&2
    exit 1
  fi

  size_mb="$(to_mb "$size_bytes")"
  baseline_mb="$(to_mb "$baseline_bytes")"
  max_mb="$(to_mb "$max_bytes")"
  delta="$(delta_pct "$size_bytes" "$baseline_bytes")"

  status="✅"
  if (( size_bytes > max_bytes )); then
    status="❌ over limit"
    failed=1
  elif awk -v d="$delta" -v t="$TOLERANCE_PCT" 'BEGIN { exit !(d > t) }'; then
    status="⚠️  grew >${TOLERANCE_PCT}%"
  fi

  rows+=("| \`$service\` | $size_mb MB | $baseline_mb MB | ${delta}% | $max_mb MB | $status |")
done < <(node -e '
const report = require(process.argv[1]);
for (const image of report.images) {
  console.log([image.service, image.context, image.baselineBytes, image.maxBytes].join("\t"));
}
' "$BASELINE")

{
  echo ""
  echo "## Docker image size regression"
  echo ""
  echo "| Service | Size | Baseline | Δ vs baseline | Limit | Status |"
  echo "| --- | --- | --- | --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
  echo ""
  echo "Signal: production image size (bytes). No timing assertions; see \`DOCKER_PERFORMANCE.md\`."
  echo ""
} | tee /tmp/docker-size-report.md

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat /tmp/docker-size-report.md >> "$GITHUB_STEP_SUMMARY"
fi

if (( failed )); then
  echo "❌ One or more images exceed the recommended size limit." >&2
  exit 1
fi

echo "✅ All Docker images are within their size limits."
