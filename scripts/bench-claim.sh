#!/usr/bin/env bash
# Claim-path resource benchmark. See scripts/bench-contract.sh for options.
exec "$(dirname "$0")/bench-contract.sh" claim "$@"
