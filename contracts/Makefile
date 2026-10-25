.PHONY: build optimize size test bench all clean

WASM_TARGET := wasm32-unknown-unknown
RELEASE_DIR := target/$(WASM_TARGET)/release
WASM_FILE   := $(RELEASE_DIR)/stellar_goal_vault.wasm
OPT_FILE    := $(RELEASE_DIR)/stellar_goal_vault_opt.wasm
MAX_SIZE_KB := 100

## build: compile the release WASM binary
build:
	cargo build --target $(WASM_TARGET) --release

## optimize: run wasm-opt -Oz on the release binary
optimize: build
	wasm-opt -Oz --enable-bulk-memory $(WASM_FILE) -o $(OPT_FILE)

## size: print sizes and fail if the optimized binary exceeds MAX_SIZE_KB
size: optimize
	@raw_bytes=$$(stat -c%s $(WASM_FILE) 2>/dev/null || stat -f%z $(WASM_FILE)); \
	opt_bytes=$$(stat -c%s $(OPT_FILE) 2>/dev/null || stat -f%z $(OPT_FILE)); \
	opt_kb=$$(( opt_bytes / 1024 )); \
	echo "Raw build:      $$raw_bytes bytes"; \
	echo "After wasm-opt: $$opt_bytes bytes ($${opt_kb} KB)"; \
	if [ $$opt_kb -ge $(MAX_SIZE_KB) ]; then \
		echo "FAIL: optimized WASM is $${opt_kb}KB, exceeds $(MAX_SIZE_KB)KB limit"; \
		exit 1; \
	else \
		echo "PASS: optimized WASM is under $(MAX_SIZE_KB)KB"; \
	fi

## test: run the full test suite against the workspace
test:
	cargo test --release

## bench: run cargo test then print instruction-count guidance
bench: test
	@echo "See CONTRACT_ABI.md 'Gas Estimates' table for per-function instruction counts."
	@echo "Re-run scripts/benchmark.sh against a deployed contract for live on-chain figures."

## all: full pipeline used in CI - build, optimize, verify size, run tests
all: size test
	@echo "Build, optimization, size check, and tests all passed."

## clean: remove build artifacts
clean:
	cargo clean