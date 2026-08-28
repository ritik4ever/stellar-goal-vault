//! # Property-Based Tests for Stellar Goal Vault Funding Invariants
//!
//! These tests use the `proptest` framework to verify critical funding invariants
//! with 10,000 random inputs per property. Run with:
//!
//! ```bash
//! cargo test --features proptest
//! ```
//!
//! ## Properties Tested
//!
//! 1. **Non-negative pledged amount**: `pledged_amount` is always ≥ 0, regardless of
//!    the sequence of contributions and refunds applied.
//!
//! 2. **Status validity**: A campaign's status — derived from `(claimed, canceled)` —
//!    is always one of exactly 4 legal states: Active, Funded, Claimed, or Canceled.
//!    The pair `(claimed=true, canceled=true)` is unreachable.
//!
//! 3. **Funded-only-when-target-met**: A campaign can only be successfully claimed
//!    (transition to Funded/Claimed) when `pledged_amount ≥ target_amount` and the
//!    deadline has passed.
//!
//! 4. **Refund conservation**: For a failed campaign (underfunded past deadline or
//!    canceled), the total amount refunded to all contributors equals the total
//!    amount that was pledged.

use proptest::prelude::*;

extern crate std;
extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

use crate::{Campaign, StellarGoalVaultContract, StellarGoalVaultContractClient};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Deploy the contract and return a client.
fn deploy_contract(env: &Env) -> StellarGoalVaultContractClient<'_> {
    let contract_id = env.register_contract(None, StellarGoalVaultContract);
    StellarGoalVaultContractClient::new(env, &contract_id)
}

/// Deploy a Stellar asset contract, mint `amount` to `recipient`, and return
/// the token address.
fn deploy_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let asset_client = StellarAssetClient::new(env, &token_id);
    asset_client.mint(recipient, &amount);
    token_id
}

/// Advance the ledger timestamp by `seconds`.
fn advance_time(env: &Env, seconds: u64) {
    env.ledger().with_mut(|info| {
        info.timestamp += seconds;
    });
}

/// Derive a human-readable status from the campaign's boolean flags.
/// Returns one of: "active", "claimed", "canceled", or "funded" (reached
/// target but not yet claimed).
fn campaign_status(campaign: &Campaign, now: u64) -> &'static str {
    match (campaign.claimed, campaign.canceled) {
        (true, false) => "claimed",
        (false, true) => "canceled",
        (true, true) => "invalid", // must never happen
        (false, false) => {
            if now >= campaign.deadline && campaign.pledged_amount >= campaign.target_amount {
                "funded"
            } else {
                "active"
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Property 1 — pledged_amount always ≥ 0
// ---------------------------------------------------------------------------
//
// We create a campaign, apply a random number of contributions (each a random
// amount within bounds), then—if the campaign is eligible—refund all of them.
// After every operation the invariant `pledged_amount >= 0` must hold.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// **Property**: `pledged_amount >= 0` after any sequence of contribute +
    /// refund operations.
    ///
    /// **Strategy**: Random target (1_000–100_000), 1–5 contributions each
    /// between the minimum (100) and target, optional full-refund cycle.
    #[test]
    fn prop_pledged_amount_non_negative(
        target in 1_000_i128..=100_000,
        num_contributions in 1_usize..=5,
        contribution_seed in prop::collection::vec(100_i128..=20_000, 1..=5),
        do_refund in proptest::bool::ANY,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);

        // Create `num_contributions` distinct contributors with enough funds.
        let contributors: std::vec::Vec<Address> = (0..num_contributions)
            .map(|_| Address::generate(&env))
            .collect();

        // Deploy token and mint to each contributor.
        let mint_amount: i128 = target; // each gets enough
        let token_addresses: std::vec::Vec<Address> = contributors
            .iter()
            .map(|c| deploy_token(&env, &admin, c, mint_amount))
            .collect();

        // All contributions use the first token.
        let token = token_addresses[0].clone();
        // Mint extra to other contributors on the same token.
        let asset_client = StellarAssetClient::new(&env, &token);
        for c in &contributors[1..] {
            asset_client.mint(c, &mint_amount);
        }

        let client = deploy_contract(&env);
        let deadline_offset: u64 = 10_000;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "proptest campaign"),
            &0_i128,
        );

        // Apply contributions — clamp each so we never exceed target.
        let mut total_pledged: i128 = 0;
        for (i, c) in contributors.iter().enumerate() {
            let seed_idx = i % contribution_seed.len();
            let mut amount = contribution_seed[seed_idx];
            // Ensure amount ≥ 100 (min contribution).
            if amount < 100 {
                amount = 100;
            }
            // Clamp to remaining room.
            let room = target - total_pledged;
            if room < 100 {
                break;
            }
            if amount > room {
                amount = room;
            }
            client.contribute(&campaign_id, c, &token, &amount);
            total_pledged += amount;

            let campaign = client.get_campaign(&campaign_id);
            prop_assert!(
                campaign.pledged_amount >= 0,
                "pledged_amount went negative after contribution: {}",
                campaign.pledged_amount
            );
        }

        // Optionally refund everyone (cancel first, since deadline hasn't passed).
        if do_refund && total_pledged > 0 {
            client.cancel_campaign(&campaign_id, &creator);
            for c in &contributors {
                let contribution = client.get_contribution(&campaign_id, c, &token);
                if contribution > 0 {
                    client.refund(&campaign_id, c);
                }
            }
            let campaign = client.get_campaign(&campaign_id);
            prop_assert!(
                campaign.pledged_amount >= 0,
                "pledged_amount went negative after refunds: {}",
                campaign.pledged_amount
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Property 2 — status is always one of 4 valid values
// ---------------------------------------------------------------------------
//
// A campaign's effective status is derived from the `(claimed, canceled)` pair
// and the funding/deadline state. The combination `(claimed=true, canceled=true)`
// is invalid and should never be reachable.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// **Property**: campaign status is always one of {active, funded, claimed,
    /// canceled} — never the invalid `(claimed=true, canceled=true)` state.
    ///
    /// **Strategy**: Random target, random contribution amounts, and random
    /// lifecycle actions (contribute, cancel, or claim).
    #[test]
    fn prop_status_always_valid(
        target in 1_000_i128..=50_000,
        contrib_amount in 100_i128..=50_000,
        action in 0u8..=2,  // 0 = contribute only, 1 = cancel, 2 = claim attempt
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, target * 2);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 5_000;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "status test"),
            &0_i128,
        );

        // Contribute — clamp to target.
        let amount = contrib_amount.min(target);
        let amount = amount.max(100);
        client.contribute(&campaign_id, &contributor, &token, &amount);

        let campaign = client.get_campaign(&campaign_id);
        let now = env.ledger().timestamp();
        let status = campaign_status(&campaign, now);
        prop_assert!(
            status != "invalid",
            "status was invalid after contribute (claimed={}, canceled={})",
            campaign.claimed,
            campaign.canceled
        );

        match action {
            1 => {
                // Cancel the campaign.
                client.cancel_campaign(&campaign_id, &creator);
                let campaign = client.get_campaign(&campaign_id);
                let now = env.ledger().timestamp();
                let status = campaign_status(&campaign, now);
                prop_assert!(
                    status == "canceled",
                    "expected canceled, got {} (claimed={}, canceled={})",
                    status, campaign.claimed, campaign.canceled
                );
                // After cancel, (claimed, canceled) must not both be true.
                prop_assert!(
                    !(campaign.claimed && campaign.canceled),
                    "claimed AND canceled both true — invalid state"
                );
            }
            2 => {
                // Attempt claim (only valid when fully funded and past deadline).
                if amount >= target {
                    advance_time(&env, deadline_offset + 1);
                    client.claim(&campaign_id, &creator);
                    let campaign = client.get_campaign(&campaign_id);
                    let now = env.ledger().timestamp();
                    let status = campaign_status(&campaign, now);
                    prop_assert!(
                        status == "claimed",
                        "expected claimed, got {} (claimed={}, canceled={})",
                        status, campaign.claimed, campaign.canceled
                    );
                    prop_assert!(
                        !(campaign.claimed && campaign.canceled),
                        "claimed AND canceled both true — invalid state"
                    );
                }
            }
            _ => {
                // Just contribute — already checked above.
            }
        }

        // Final status check.
        let campaign = client.get_campaign(&campaign_id);
        let now = env.ledger().timestamp();
        let status = campaign_status(&campaign, now);
        let valid_statuses = ["active", "funded", "claimed", "canceled"];
        prop_assert!(
            valid_statuses.contains(&status),
            "unexpected status '{}' — campaign state is (claimed={}, canceled={})",
            status, campaign.claimed, campaign.canceled
        );
    }
}

// ---------------------------------------------------------------------------
// Property 3 — funded only when pledged ≥ target before deadline
// ---------------------------------------------------------------------------
//
// A campaign can only transition to "claimed" when pledged_amount >= target_amount
// AND the deadline has passed. Any attempt to claim before the deadline or when
// underfunded must fail.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// **Property**: `claim()` succeeds IFF `pledged_amount >= target_amount`
    /// AND `now >= deadline`. Attempts under other conditions must fail.
    ///
    /// **Strategy**: Random target, random contribution, random time offset.
    /// Uses the SDK-generated `try_claim` to avoid panics.
    #[test]
    fn prop_funded_only_when_target_met(
        target in 1_000_i128..=50_000,
        contrib_pct in 10u8..=150,   // percentage of target to contribute
        time_past_deadline in proptest::bool::ANY,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, target * 2);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 5_000;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "funding gate test"),
            &0_i128,
        );

        // Contribute a fraction (or excess) of target.
        let raw_amount = (target as i128) * (contrib_pct as i128) / 100;
        let amount = raw_amount.max(100).min(target); // clamp to [100, target]
        client.contribute(&campaign_id, &contributor, &token, &amount);

        if time_past_deadline {
            advance_time(&env, deadline_offset + 1);
        }

        let campaign = client.get_campaign(&campaign_id);
        let now = env.ledger().timestamp();
        let can_claim = campaign.pledged_amount >= campaign.target_amount
            && now >= campaign.deadline;

        // Use try_claim (SDK-generated) to avoid panicking on expected failures.
        let claim_result = client.try_claim(&campaign_id, &creator);

        if can_claim {
            prop_assert!(
                claim_result.is_ok(),
                "claim should have succeeded: pledged={}, target={}, now={}, deadline={}",
                campaign.pledged_amount,
                campaign.target_amount,
                now,
                campaign.deadline
            );
        } else {
            prop_assert!(
                claim_result.is_err(),
                "claim should have failed: pledged={}, target={}, now={}, deadline={}",
                campaign.pledged_amount,
                campaign.target_amount,
                now,
                campaign.deadline
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Property 4 — refund sum = total pledged for failed campaigns
// ---------------------------------------------------------------------------
//
// When a campaign fails (canceled or underfunded past deadline) and all
// contributors call `refund()`, the sum of all refunds must exactly equal the
// total amount that was pledged. No funds must be created or destroyed.

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// **Property**: for a failed campaign, `sum(refunds) == total_pledged`.
    ///
    /// **Strategy**: 1-3 contributors with random amounts, campaign canceled
    /// or expired while underfunded.
    #[test]
    fn prop_refund_sum_equals_total_pledged(
        target in 5_000_i128..=100_000,
        amounts in prop::collection::vec(100_i128..=4_000, 1..=3),
        cancel_vs_expire in proptest::bool::ANY,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);

        let num_contributors = amounts.len();
        let contributors: std::vec::Vec<Address> = (0..num_contributors)
            .map(|_| Address::generate(&env))
            .collect();

        // Deploy a single token, mint to all contributors.
        let token = deploy_token(&env, &admin, &contributors[0], target * 2);
        let asset_client = StellarAssetClient::new(&env, &token);
        for c in &contributors[1..] {
            asset_client.mint(c, &(target * 2));
        }

        let client = deploy_contract(&env);
        let deadline_offset: u64 = 10_000;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "refund conservation"),
            &0_i128,
        );

        // Contribute — track total. Clamp so we stay under target (ensure failure).
        let mut total_pledged: i128 = 0;
        let mut contributor_balances_before: std::vec::Vec<i128> =
            std::vec::Vec::with_capacity(num_contributors);
        let token_client = TokenClient::new(&env, &token);

        for (i, c) in contributors.iter().enumerate() {
            let mut amount = amounts[i];
            let room = target - total_pledged - 1; // always stay below target
            if room < 100 {
                // Record balance without contributing.
                contributor_balances_before.push(token_client.balance(c));
                continue;
            }
            if amount > room {
                amount = room;
            }
            if amount < 100 {
                amount = 100;
            }
            // Record balance right before contributing.
            let balance_before = token_client.balance(c);
            client.contribute(&campaign_id, c, &token, &amount);
            contributor_balances_before.push(balance_before);
            total_pledged += amount;
        }

        if total_pledged == 0 {
            // Nothing was contributed — property trivially holds.
            return Ok(());
        }

        // Make campaign eligible for refund.
        if cancel_vs_expire {
            client.cancel_campaign(&campaign_id, &creator);
        } else {
            advance_time(&env, deadline_offset + 1);
        }

        // Refund each contributor and sum up actual refunds.
        let mut total_refunded: i128 = 0;
        for (_i, c) in contributors.iter().enumerate() {
            let contribution = client.get_contribution(&campaign_id, c, &token);
            if contribution > 0 {
                let balance_before_refund = token_client.balance(c);
                client.refund(&campaign_id, c);
                let balance_after_refund = token_client.balance(c);
                let actual_refund = balance_after_refund - balance_before_refund;
                total_refunded += actual_refund;
            }
        }

        prop_assert_eq!(
            total_refunded,
            total_pledged,
            "refund conservation violated: refunded={} but pledged={}",
            total_refunded,
            total_pledged
        );

        // Also verify on-chain state: pledged should be 0.
        let campaign = client.get_campaign(&campaign_id);
        prop_assert_eq!(
            campaign.pledged_amount,
            0,
            "pledged_amount should be 0 after full refund, got {}",
            campaign.pledged_amount
        );
    }
}
