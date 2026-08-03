#!/usr/bin/env bash
# Verify every external <link> and <script> tag in index.html carries integrity + crossorigin attributes.
# Exits non-zero if any CDN resource lacks an integrity hash.

set -euo pipefail

HTML_FILE="${1:-frontend/index.html}"

if [ ! -f "$HTML_FILE" ]; then
  echo "ERROR: $HTML_FILE not found"
  exit 1
fi

ERRORS=0

while IFS= read -r line; do
  # Match <link> or <script> tags that load from an external URL (http/https)
  if echo "$line" | grep -qiE '<(link|script)[^>]+(href|src)="https?://'; then
    if ! echo "$line" | grep -q 'integrity='; then
      echo "MISSING integrity: $line"
      ERRORS=$((ERRORS + 1))
    fi
    if ! echo "$line" | grep -q 'crossorigin='; then
      echo "MISSING crossorigin: $line"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done < "$HTML_FILE"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "SRI check FAILED: $ERRORS attribute(s) missing."
  echo "Generate a hash with: openssl dgst -sha384 -binary <file> | openssl base64 -A"
  exit 1
fi

echo "SRI check passed — all CDN resources carry integrity and crossorigin attributes."
