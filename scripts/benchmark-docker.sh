#!/usr/bin/env bash
# ------------------------------------------------------------------
# Benchmark Docker image sizes
# ------------------------------------------------------------------
# Usage:
#   ./scripts/benchmark-docker.sh
# ------------------------------------------------------------------

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/.." && pwd)"

echo "Building Docker images..."
cd "$PROJECT_ROOT"
# Use docker compose if available, otherwise fallback to docker build
if command -v docker-compose &> /dev/null; then
    docker-compose build -q backend frontend || { echo "Docker build failed"; exit 1; }
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    docker compose build -q backend frontend || { echo "Docker build failed"; exit 1; }
else
    # Fallback to direct docker build
    docker build -q -t stellar-goal-vault-backend ./backend || { echo "Backend docker build failed"; exit 1; }
    docker build -q -t stellar-goal-vault-frontend ./frontend || { echo "Frontend docker build failed"; exit 1; }
fi

echo ""
echo "## Current Docker Image Sizes"
echo ""
echo "| Service | Current Size (MB) |"
echo "|---|---|"

backend_size=$(docker images --format "{{.Size}}" stellar-goal-vault-backend | head -n 1 | sed 's/MB//' | xargs || echo "N/A")
frontend_size=$(docker images --format "{{.Size}}" stellar-goal-vault-frontend | head -n 1 | sed 's/MB//' | xargs || echo "N/A")

if [ -z "$backend_size" ]; then backend_size="N/A"; fi
if [ -z "$frontend_size" ]; then frontend_size="N/A"; fi

echo "| \`backend\` | $backend_size |"
echo "| \`frontend\` | $frontend_size |"
echo ""
echo "See DOCKER_PERFORMANCE.md for baseline comparison and recommended limits."
