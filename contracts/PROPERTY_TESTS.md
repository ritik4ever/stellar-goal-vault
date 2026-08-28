# Property-Based Tests for Funding Invariants

## Overview

This document describes the property-based test suite located at `contracts/src/tests/property_tests.rs` for the Stellar Goal Vault contract. These tests use the `proptest` framework to automatically verify critical funding invariants with 10,000 random inputs per property.

The tests run with the `proptest` Cargo feature:
```bash
cargo test --features proptest
```

---

## Core Invariants (10,000 Runs Per Property)

### Property 1: Non-Negative Pledged Amount
**Test Function:** `prop_pledged_amount_non_negative()`

- **Invariant:** `pledged_amount >= 0` always holds after any valid sequence of contributions and refund operations.
- **Why it matters:** Prevents negative balances, balance underflow, or accounting discrepancies after complex multi-contributor pledge and refund cycles.
- **Test Strategy:** Generates random target amounts (1,000–100,000), 1–5 distinct contributors with random contribution amounts (min 100 stroops), and optional full refund cycles. Verifies non-negativity after each operation.

---

### Property 2: Status Validity (Exactly 4 States)
**Test Function:** `prop_status_always_valid()`

- **Invariant:** A campaign's effective status — derived from `(claimed, canceled)` flags and deadline/target conditions — is always one of exactly 4 legal states: `"active"`, `"funded"`, `"claimed"`, or `"canceled"`.
- **Why it matters:** Guarantees that the invalid state `(claimed=true, canceled=true)` is completely unreachable across arbitrary lifecycles.
- **Test Strategy:** Generates random targets, contributions, and random action branches (contribute-only, cancel, or claim attempt). Asserts the status is valid and never in an illegal state.

---

### Property 3: Funded Only When Target Met Before Deadline
**Test Function:** `prop_funded_only_when_target_met()`

- **Invariant:** A campaign can only be claimed (`try_claim` succeeds) if and only if `pledged_amount >= target_amount` AND `current_time >= deadline`. Claims under any other conditions are rejected.
- **Why it matters:** Protects backers' funds from being claimed prematurely before the deadline or when a campaign fails to reach its funding target.
- **Test Strategy:** Generates random targets (1,000–50,000), contribution percentages (10% to 150% of target), and time offsets (before vs after deadline). Asserts that `try_claim` succeeds exactly when target is met past deadline, and fails otherwise.

---

### Property 4: Refund Conservation for Failed Campaigns
**Test Function:** `prop_refund_sum_equals_total_pledged()`

- **Invariant:** For any failed campaign (underfunded past deadline or canceled), the total amount refunded across all contributors equals the total amount that was pledged: `sum(refunds) == total_pledged`.
- **Why it matters:** Ensures complete fund conservation with zero leakage, no orphaned tokens, and no balance creation or destruction during refund processing.
- **Test Strategy:** Generates 1–3 contributors pledging random amounts to a campaign, transitions the campaign to failed (canceled or expired underfunded), invokes refunds, and validates that `total_refunded == total_pledged` and `campaign.pledged_amount == 0`.

---

## Running the Tests

### 1. Run All Property Tests
```bash
cargo test --features proptest tests::property_tests
```

### 2. Run a Specific Property Test
```bash
cargo test --features proptest prop_pledged_amount_non_negative
cargo test --features proptest prop_status_always_valid
cargo test --features proptest prop_funded_only_when_target_met
cargo test --features proptest prop_refund_sum_equals_total_pledged
```

### 3. Run Standard Unit Tests (Without proptest)
```bash
cargo test --lib test::tests
```

### 4. Adjust Test Cases (e.g. for Fast CI)
```bash
PROPTEST_CASES=1000 cargo test --features proptest tests::property_tests
```

---

## Acceptance Criteria Checklist

- [x] **pledged_amount always ≥ 0** (`prop_pledged_amount_non_negative`)
- [x] **status always one of 4 values** (`prop_status_always_valid`)
- [x] **funded only when pledged ≥ target before deadline** (`prop_funded_only_when_target_met`)
- [x] **refund sum = total pledged for failed campaigns** (`prop_refund_sum_equals_total_pledged`)
- [x] **10,000 random inputs per property** (configured via `ProptestConfig::with_cases(10_000)`)
- [x] **Tests run with `cargo test --features proptest`**
- [x] **Properties documented** in `contracts/PROPERTY_TESTS.md` and inline docstrings

