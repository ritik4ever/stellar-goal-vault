#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Docker Image Build Benchmark
# =============================================================================
# This script provides a repeatable benchmark for Docker image builds.
# It uses a fixed, minimal Dockerfile to ensure deterministic results
# without relying on external mutable data or large dependencies.
#
# Usage:
#   ./scripts/bench-docker-build.sh [build_context_dir]
#
# Metrics reported:
#   - Build time (seconds)
#   - Image size (MB)
#   - Layer count

# Default build context is the current directory
BUILD_CONTEXT="${1:-.}"

# Temporary directory for benchmark artifacts
BENCH_DIR=$(mktemp -d)
trap "rm -rf $BENCH_DIR" EXIT

# Create a minimal, deterministic Dockerfile for benchmarking
# This ensures consistent build times and sizes across runs
BENCH_DOCKERFILE="$BENCH_DIR/Dockerfile"
cat > "$BENCH_DOCKERFILE" << 'EOF'
FROM alpine:3.18
LABEL benchmark="docker-build-perf"
LABEL version="1.0"

# Create a fixed-size dummy file to simulate application payload
RUN mkdir -p /app && \
    dd if=/dev/zero of=/app/data.bin bs=1M count=10 2>/dev/null && \
    echo "Benchmark artifact" > /app/version.txt

WORKDIR /app
CMD ["cat", "version.txt"]
EOF

# Create a minimal .dockerignore to prevent context pollution
BENCH_DOCKERIGNORE="$BENCH_DIR/.dockerignore"
cat > "$BENCH_DOCKERIGNORE" << 'EOF'
.git
.github
node_modules
*.md
*.log
EOF

# Image tag for benchmark
BENCH_IMAGE="bench-docker-build:$(date +%Y%m%d%H%M%S)"

echo "========================================"
echo "Docker Build Benchmark"
echo "========================================"
echo "Build context: $BUILD_CONTEXT"
echo "Benchmark image: $BENCH_IMAGE"
echo "========================================"

# Step 1: Build the image and capture timing
echo ""
echo "[1/3] Building Docker image..."
START_TIME=$(date +%s%N)

if docker build \
    -f "$BENCH_DOCKERFILE" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    -t "$BENCH_IMAGE" \
    "$BENCH_DIR" 2>&1 | tee "$BENCH_DIR/build.log"; then
    
    END_TIME=$(date +%s%N)
    BUILD_TIME_NS=$((END_TIME - START_TIME))
    BUILD_TIME_SEC=$(echo "scale=3; $BUILD_TIME_NS / 1000000000" | bc)
    
    echo ""
    echo "[2/3] Analyzing image metrics..."
    
    # Get image size
    IMAGE_SIZE_BYTES=$(docker image inspect "$BENCH_IMAGE" --format='{{.Size}}')
    IMAGE_SIZE_MB=$(echo "scale=2; $IMAGE_SIZE_BYTES / 1048576" | bc)
    
    # Get layer count
    LAYER_COUNT=$(docker history "$BENCH_IMAGE" --format='{{.CreatedBy}}' | grep -v "<missing>" | wc -l)
    
    # Get image ID for reproducibility
    IMAGE_ID=$(docker image inspect "$BENCH_IMAGE" --format='{{.Id}}')
    
    echo ""
    echo "========================================"
    echo "Benchmark Results"
    echo "========================================"
    echo "Build Time:    ${BUILD_TIME_SEC}s"
    echo "Image Size:    ${IMAGE_SIZE_MB} MB"
    echo "Layer Count:   ${LAYER_COUNT}"
    echo "Image ID:      ${IMAGE_ID}"
    echo "========================================"
    
    # Output metrics in a parseable format for CI
    echo ""
    echo "METRICS:"
    echo "build_time_seconds=${BUILD_TIME_SEC}"
    echo "image_size_mb=${IMAGE_SIZE_MB}"
    echo "layer_count=${LAYER_COUNT}"
    echo "image_id=${IMAGE_ID}"
    
    # Clean up benchmark image
    docker rmi "$BENCH_IMAGE" > /dev/null 2>&1 || true
    
    exit 0
else
    echo ""
    echo "ERROR: Docker build failed"
    cat "$BENCH_DIR/build.log" 2>/dev/null || true
    exit 1
fi