#!/usr/bin/env bash
#
# Installs the Stellar CLI into ./bin (or $STELLAR_CLI_INSTALL_DIR).
#
# soroban-sdk >= 28 refuses to build a contract with a plain `cargo build`
# because the contract spec has to be "shaken" by the build system. The
# Stellar CLI is that build system, so CI has to use `stellar contract build`
# instead of `cargo build --target wasm32v1-none`.
#
# Usage:
#   ./scripts/install-stellar-cli.sh [version]
#
# Environment:
#   STELLAR_CLI_INSTALL_DIR  Directory the binary is written to (default: ./bin)
#   STELLAR_CLI_VERSION      Release tag to install (default: v25.2.0)

set -euo pipefail

VERSION="${1:-${STELLAR_CLI_VERSION:-v25.2.0}}"
INSTALL_DIR="${STELLAR_CLI_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bin}"

case "$(uname -s)" in
  Linux) OS="unknown-linux-gnu" ;;
  Darwin) OS="apple-darwin" ;;
  *)
    echo "Unsupported operating system: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) ARCH="x86_64" ;;
  aarch64 | arm64) ARCH="aarch64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

TARBALL="stellar-cli-${VERSION#v}-${ARCH}-${OS}.tar.gz"
URL="https://github.com/stellar/stellar-cli/releases/download/${VERSION}/${TARBALL}"

mkdir -p "$INSTALL_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading ${URL}"
curl -fsSL "$URL" -o "${TMP_DIR}/${TARBALL}"
tar -xzf "${TMP_DIR}/${TARBALL}" -C "$TMP_DIR"

mv "$TMP_DIR/stellar" "${INSTALL_DIR}/stellar"
chmod +x "${INSTALL_DIR}/stellar"

echo "Installed $("${INSTALL_DIR}/stellar" --version | head -n 1) to ${INSTALL_DIR}/stellar"
