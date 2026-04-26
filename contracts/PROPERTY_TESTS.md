# Property-Based Tests for Funding Invariants

## Overview

This document describes the property-based test suite for the Stellar Goal Vault contract. These tests verify that core funding invariants hold after any sequence of operations, including campaign creation, contributions, claims, and refunds.

The test suite uses the `proptest` framework to automatically generate random sequences of operations and verify that key invariants are maintained throughout.

## Key Invariants

### Invariant 1: Pledged Sum Consistency
**Test:** `prop_invariant_pledged_sum()`

**Description:** The `pledged_amount` stored on a campaign must always equal the sum of all active (non-refunded) contributions from individual contributors.

**Why it matters:**
- Prevents accounting errors or double-counting of contributions
- Ensures the contract state accurately reflects the total funding
- Critical for determining if a campaign is funded or failed

**Mathematical property:**
```
campaign.pledged_amount == sum(contributor_contribution[i] for all i)
```

**Coverage:**
- Tests multiple contributions from different contributors
- Tests refund operations that reduce pledged amounts
- Verifies accounting after partial and full contributions
- Validates claims and deadline transitions

---

### Invariant 2: Non-Negative Amounts
**Test:** `prop_invariant_nonnegativity()`

**Description:** All financial amounts in the system (`target_amount`, `pledged_amount`) must remain non-negative after any sequence of operations.

**Why it matters:**
- Prevents negative balances or underflow conditions
- Ensures the contract cannot enter an invalid financial state
- Protects against integer underflow vulnerabilities
- Maintains system integrity

**Mathematical property:**
```
campaign.target_amount > 0  (always, set at creation)
campaign.pledged_amount >= 0  (after any operation)
```

**Coverage:**
- Verifies initial state after campaign creation
- Checks after each contribute operation
- Validates after each refund operation
- Confirms after claim operations
- Tests edge cases with minimal amounts

---

### Invariant 3: No Overflow in Pledged Amount
**Test:** `prop_invariant_no_overflow()`

**Description:** The `pledged_amount` can never exceed the total sum of all attempted contributions. This prevents accounting inconsistencies and overflow conditions.

**Why it matters:**
- Prevents impossible states where more was claimed than was contributed
- Detects bugs in contribution accounting
- Ensures refunds don't create negative contributions
- Guards against exploits that could drain the contract

**Mathematical property:**
```
campaign.pledged_amount <= sum(all_contributions_attempted)
campaign.pledged_amount >= 0
```

**Coverage:**
- Tracks all contribute attempts and captures the total
- Verifies actual pledged amount never exceeds running total
- Tests multiple sequential contributions
- Validates after refunds reduce totals

---

### Invariant 4: Claim Immutability
**Test:** `prop_invariant_claim_immutability()`

**Description:** Once a campaign is claimed (marked as `claimed: true`), it becomes immutable. No new contributions can be accepted, and the state cannot be modified further.

**Why it matters:**
- Prevents double-claiming and fund theft
- Ensures creator receives exactly what was pledged at claim time
- Eliminates race conditions around claim operations
- Protects against contributors trying to drain claimed funds

**Mathematical property:**
```
if campaign.claimed == true, then:
  - no new contributions accepted
  - campaign state is frozen
  - refunds are rejected
```

**Coverage:**
- Creates a campaign and funds it
- Executes claim operation
- Verifies `claimed` flag is set to true
- Attempts to add contributions after claim (should fail)
- Validates claim idempotency (second claim fails)

---

### Invariant 5: Refund State Consistency
**Test:** `prop_invariant_refund_funding_state()`

**Description:** Refunds are only allowed on campaigns that:
1. Have passed their deadline (time-gated)
2. Failed to reach their target amount (state-gated)
3. Are not already claimed (immutability-gated)

**Why it matters:**
- Prevents refunds from being abused to drain funded campaigns
- Ensures refunds only occur in legitimate failure scenarios
- Maintains the contract's financial model
- Protects creator's claimed funds from being refunded

**Mathematical property:**
```
refund(contributor, campaign) is_allowed_if:
  - now >= campaign.deadline  (deadline passed)
  - campaign.pledged_amount < campaign.target_amount  (underfunded)
  - campaign.claimed == false  (not claimed)
```

**Coverage:**
- Creates underfunded campaigns (pledged < target)
- Advances time past deadline
- Attempts refunds (should succeed)
- Validates error handling and state consistency

---

## Test Harness Architecture

### Operation Generation
The tests use proptest to generate random sequences of two operation types:

**Contribute Operation:**
- Randomly chosen amount: 1 to 10,000 units
- Randomly chosen contributor ID: 0 to 9
- Generates new `Address` for each operation
- Mints tokens to the contributor
- Executes contribution if campaign state permits

**Refund Operation:**
- Randomly chosen contributor ID: 0 to 9
- Generates new `Address` for each operation
- Attempts refund if campaign state permits
- Wrapped in error handling to gracefully handle expected failures

### Configuration
- **Operations per test case:** 0 to 15 random operations
- **Target amounts:** 100 to 50,000 units
- **Contribution amounts:** 1 to 10,000 units
- **Default test count:** 256 cases per invariant (configurable via environment)

### State Tracking
Tests maintain local tracking:
- `expected_contributions`: HashMap of contributor_id → accumulated amount
- `expected_pledged`: Running total of active contributions
- Compared against on-chain state after all operations

## Clear Diagnostic Output

When an invariant violation is detected, the tests provide detailed diagnostic information:

**Pledged Sum Invariant:**
```
INVARIANT VIOLATION: pledged_amount (X) does not equal sum of contributions (Y)
Test seed: [seed value]
Campaign ID: [id]
Operations executed: [count]
```

**Non-Negative Invariant:**
```
pledged_amount must remain non-negative: [negative value]
Test seed: [seed value]
Campaign ID: [id]
Operation sequence: [description]
```

**Overflow Invariant:**
```
INVARIANT VIOLATION: pledged_amount (X) exceeds total contributions (Y)
Test seed: [seed value]
Total attempted: Y
Total refunded: Z
Net pledged: X
```

**Claim Immutability Invariant:**
```
Claimed campaign should reject contributions
Test seed: [seed value]
Campaign state after claim: claimed=true
Attempted post-claim contribution: [amount]
Result: [success/failure]
```

**Refund State Invariant:**
```
Underfunded campaign should allow refunds after deadline
Test seed: [seed value]
Campaign state: pledged=X, target=Y (underfunded: X < Y)
Current time: [timestamp]
Deadline: [deadline]
Refund result: [success/failure]
```

## Running the Tests

### Prerequisites
- **Rust:** 1.70 or later
- **Soroban SDK:** 21.0.0
- **proptest:** 1.4 (automatically fetched by Cargo)

### Setup
```bash
cd contracts
```

### Run All Tests
```bash
cargo test --lib
```

### Run Property Tests Only
```bash
cargo test --lib property_tests
```

### Run Specific Invariant Tests
```bash
# Pledged sum invariant
cargo test --lib prop_invariant_pledged_sum

# Non-negative amounts invariant
cargo test --lib prop_invariant_nonnegativity

# No overflow invariant
cargo test --lib prop_invariant_no_overflow

# Claim immutability invariant
cargo test --lib prop_invariant_claim_immutability

# Refund state consistency invariant
cargo test --lib prop_invariant_refund_funding_state
```

### Run with Verbose Output
```bash
cargo test --lib property_tests -- --nocapture
```

### Run with Custom Number of Test Cases
```bash
PROPTEST_CASES=1000 cargo test --lib property_tests
```

### Run with Specific Seed (Reproduce Failed Test)
```bash
PROPTEST_REGRESSIONS=contracts/proptest-regressions cargo test --lib
```

## Test Execution and Verification Steps

### Step 1: Ensure Rust and Soroban are Installed
```bash
rustc --version    # Should be 1.70+
cargo --version    # Should be 1.54+
soroban --version  # Optional, for contract deployment
```

### Step 2: Build the Contract
```bash
cd contracts
cargo build --release
```

### Step 3: Run Full Test Suite
```bash
cargo test --lib
```

**Expected output:**
```
running 10 tests
test tests::test_claim_success ... ok
test tests::test_claim_creator_mismatch ... ok
[... other basic tests ...]
test tests::property_tests::prop_invariant_pledged_sum ... ok
test tests::property_tests::prop_invariant_nonnegativity ... ok
test tests::property_tests::prop_invariant_no_overflow ... ok
test tests::property_tests::prop_invariant_claim_immutability ... ok
test tests::property_tests::prop_invariant_refund_funding_state ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured
```

### Step 4: Run Individual Invariant Tests
```bash
cargo test --lib prop_invariant_pledged_sum -- --exact
cargo test --lib prop_invariant_nonnegativity -- --exact
cargo test --lib prop_invariant_no_overflow -- --exact
cargo test --lib prop_invariant_claim_immutability -- --exact
cargo test --lib prop_invariant_refund_funding_state -- --exact
```

### Step 5: Verify Coverage
Each invariant test executes:
- **256 randomly generated test cases** (default)
- **Each case runs 0-15 operations** (randomly determined)
- **Total operations tested**: ~1,000-4,000 per invariant
- **Total combined operations**: ~5,000-20,000 across all five invariants

### Step 6: Check Test Coverage
The property tests cover all four core operations:
1. ✅ **create_campaign**: Called once per test case
2. ✅ **contribute**: Randomly executed 0-15 times per case
3. ✅ **claim**: Tested in `prop_invariant_claim_immutability`
4. ✅ **refund**: Tested in both `prop_invariant_pledged_sum` and `prop_invariant_refund_funding_state`

## Failure Analysis

If a test fails, proptest provides regression data:

### Location
```
proptest-regressions/contracts/src/test.rs
```

### Contents
Contains seed values and operation sequences that trigger the failure. These help reproduce issues deterministically.

### Reproduction
```bash
PROPTEST_REGRESSIONS=contracts/proptest-regressions cargo test --lib
```

This will automatically repeat the failed scenario with the same seed.

## Implementation Quality

The property-based test suite:
- ✅ **Tests 5 core invariants** across create, contribute, claim, and refund paths
- ✅ **Generates 256+ test cases per invariant** automatically
- ✅ **Produces clear diagnostic output** with specific violation details
- ✅ **Integrates cleanly with cargo test** (no special tooling required)
- ✅ **Uses deterministic seeds** for reproducible debugging
- ✅ **Handles panics gracefully** with catch_unwind for error-path testing

## Next Steps

### Local Development
```bash
cd /workspaces/stellar-goal-vault/contracts
cargo test --lib
```

### CI/CD Integration
Add to your GitHub Actions workflow:
```yaml
- name: Run contract tests
  run: |
    cd contracts
    cargo test --lib --verbose
```

### Extending Tests
To add a new invariant:
1. Add a new test function in `property_tests` module
2. Define properties it must maintain
3. Use proptest macros: `proptest!(|(...)|{...})`
4. Call `prop_assert!` or `prop_assert_eq!` for verification
5. Run: `cargo test --lib`

---

## Summary

The property-based test suite provides comprehensive verification of the Stellar Goal Vault contract's funding model. By automatically generating thousands of test sequences and verifying invariants hold, we ensure the contract correctly handles:

- ✅ Accurate contribution accounting
- ✅ Non-negative financial state
- ✅ Prevention of overflow conditions
- ✅ Immutability of claimed campaigns
- ✅ Correct refund state transitions

This approach significantly increases confidence in the correctness of core funding operations.
