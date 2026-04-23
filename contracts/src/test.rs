#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, String,
    };

    use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};

    /// Helper: deploy the contract and return a client.
    fn deploy_contract(env: &Env) -> StellarGoalVaultContractClient {
        let contract_id = env.register_contract(None, StellarGoalVaultContract);
        StellarGoalVaultContractClient::new(env, &contract_id)
    }

    /// Helper: deploy a Stellar asset contract and mint `amount` to `recipient`.
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

    // -------------------------------------------------------------------------
    // claim: success path
    // -------------------------------------------------------------------------
    #[test]
    fn test_claim_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let now = env.ledger().timestamp();
        let deadline = now + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        // Create campaign
        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "test campaign"),
        );

        // Contribute enough to fund it
        client.contribute(&campaign_id, &contributor, &target);

        // Advance past deadline
        advance_time(&env, deadline_offset + 1);

        // Claim — should succeed and transfer tokens to creator
        client.claim(&campaign_id, &creator);

        // Verify on-chain state: campaign is now marked claimed
        let campaign = client.get_campaign(&campaign_id);
        assert!(campaign.claimed, "campaign should be marked claimed");
        assert_eq!(campaign.pledged_amount, target);
    }

    // -------------------------------------------------------------------------
    // claim: creator mismatch
    // -------------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_claim_creator_mismatch() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let attacker = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 50;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "mismatch test"),
        );

        client.contribute(&campaign_id, &contributor, &target);
        advance_time(&env, deadline_offset + 1);

        // Attacker tries to claim — must panic
        client.claim(&campaign_id, &attacker);
    }

    // -------------------------------------------------------------------------
    // claim: campaign still active (deadline not reached)
    // -------------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "campaign is still active")]
    fn test_claim_before_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline = env.ledger().timestamp() + 1_000;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "early claim test"),
        );

        client.contribute(&campaign_id, &contributor, &target);

        // Do NOT advance time — deadline not reached
        client.claim(&campaign_id, &creator);
    }

    // -------------------------------------------------------------------------
    // claim: campaign not funded
    // -------------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "campaign is not funded")]
    fn test_claim_underfunded() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 50;
        let deadline = env.ledger().timestamp() + deadline_offset;

        // Only mint half the target
        let token = deploy_token(&env, &admin, &contributor, target / 2);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "underfunded test"),
        );

        client.contribute(&campaign_id, &contributor, &(target / 2));
        advance_time(&env, deadline_offset + 1);

        client.claim(&campaign_id, &creator);
    }

    // -------------------------------------------------------------------------
    // claim: double-claim rejected
    // -------------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_claim_double_claim() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 200;
        let deadline_offset: u64 = 50;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "double claim test"),
        );

        client.contribute(&campaign_id, &contributor, &target);
        advance_time(&env, deadline_offset + 1);

        client.claim(&campaign_id, &creator);
        // Second claim must panic
        client.claim(&campaign_id, &creator);
    }

    // =========================================================================
    // PROPERTY-BASED TESTS FOR FUNDING INVARIANTS
    // =========================================================================
    // These tests verify core invariants that must hold after any sequence
    // of operations: create, contribute, claim, and refund.

    #[cfg(test)]
    mod property_tests {
        use super::*;
        use proptest::prelude::*;

        /// Represents a sequence of operations executed on a campaign.
        #[derive(Debug, Clone)]
        enum CampaignOp {
            Contribute {
                amount: i128,
                contributor_id: u32,
            },
            Refund {
                contributor_id: u32,
            },
        }

        /// Generate valid amounts for contributions (1 to 10,000 units)
        fn amount_strategy() -> impl Strategy<Value = i128> {
            1i128..=10_000i128
        }

        /// Generate contributor IDs (0 to 9) for deterministic testing
        fn contributor_id_strategy() -> impl Strategy<Value = u32> {
            0u32..=9u32
        }

        /// Generate sequences of operations (up to 15 ops per campaign)
        fn operations_strategy() -> impl Strategy<Value = Vec<CampaignOp>> {
            prop::collection::vec(
                prop_oneof![
                    (amount_strategy(), contributor_id_strategy())
                        .prop_map(|(amount, contributor_id)| CampaignOp::Contribute {
                            amount,
                            contributor_id,
                        }),
                    contributor_id_strategy().prop_map(|contributor_id| CampaignOp::Refund {
                        contributor_id,
                    }),
                ],
                0..=15,
            )
        }

        /// INVARIANT 1: Pledged amount must be sum of all contributions
        /// After any sequence of operations, pledged_amount == sum of active contributions.
        #[test]
        fn prop_invariant_pledged_sum() {
            proptest!(|(
                target in 100i128..50_000i128,
                operations in operations_strategy()
            )| {
                let env = Env::default();
                env.mock_all_auths();

                let creator = Address::generate(&env);
                let admin = Address::generate(&env);

                let deadline = env.ledger().timestamp() + 10_000;
                let mut total_initial_balance = 0i128;

                // Calculate required balance for all potential contributions
                for op in &operations {
                    if let CampaignOp::Contribute { amount, .. } = op {
                        total_initial_balance += amount;
                    }
                }

                // Add buffer for safety
                let total_balance = total_initial_balance + target;

                let token = deploy_token(&env, &admin, &creator, total_balance);
                let client = deploy_contract(&env);

                let campaign_id = client.create_campaign(
                    &creator,
                    &token,
                    &target,
                    &deadline,
                    &String::from_str(&env, "test campaign"),
                );

                // Track contributions per contributor
                let mut expected_contributions: std::collections::HashMap<u32, i128> =
                    std::collections::HashMap::new();
                let mut expected_pledged = 0i128;

                // Execute operations
                for op in operations {
                    match op {
                        CampaignOp::Contribute {
                            amount,
                            contributor_id,
                        } => {
                            let contributor = Address::generate(&env);
                            // Mint tokens to contributor
                            let token_client = StellarAssetClient::new(&env, &token);
                            token_client.mint(&contributor, &amount);

                            // Contribute if campaign is still active
                            let campaign_check = client.get_campaign(&campaign_id);
                            if env.ledger().timestamp() < campaign_check.deadline
                                && !campaign_check.claimed
                            {
                                client.contribute(&campaign_id, &contributor, &amount);
                                *expected_contributions.entry(contributor_id).or_insert(0) +=
                                    amount;
                                expected_pledged += amount;
                            }
                        }
                        CampaignOp::Refund { contributor_id } => {
                            // Refund only works after deadline and if underfunded
                            let contributor = Address::generate(&env);
                            let campaign_check = client.get_campaign(&campaign_id);

                            if env.ledger().timestamp() >= campaign_check.deadline
                                && campaign_check.pledged_amount < campaign_check.target_amount
                                && campaign_check.pledged_amount > 0
                            {
                                if let Ok(_) =
                                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                                        || {
                                            client.refund(&campaign_id, &contributor);
                                        },
                                    ))
                                {
                                    if let Some(contribution) =
                                        expected_contributions.get_mut(&contributor_id)
                                    {
                                        expected_pledged -= *contribution;
                                        *contribution = 0;
                                    }
                                }
                            }
                        }
                    }
                }

                // VERIFY INVARIANT: pledged_amount == sum of all active contributions
                let final_campaign = client.get_campaign(&campaign_id);
                let actual_pledged = final_campaign.pledged_amount;

                // Calculate expected pledged from tracking
                let calculated_pledged: i128 =
                    expected_contributions.values().sum::<i128>();

                prop_assert_eq!(
                    actual_pledged,
                    calculated_pledged,
                    "INVARIANT VIOLATION: pledged_amount ({}) does not equal sum of contributions ({})",
                    actual_pledged,
                    calculated_pledged
                );
            });
        }

        /// INVARIANT 2: All amounts must remain non-negative
        /// After any sequence of operations, all financial amounts stay >= 0.
        #[test]
        fn prop_invariant_nonnegativity() {
            proptest!(|(
                target in 100i128..50_000i128,
                operations in operations_strategy()
            )| {
                let env = Env::default();
                env.mock_all_auths();

                let creator = Address::generate(&env);
                let admin = Address::generate(&env);

                let deadline = env.ledger().timestamp() + 10_000;
                let mut total_initial_balance = 0i128;

                for op in &operations {
                    if let CampaignOp::Contribute { amount, .. } = op {
                        total_initial_balance += amount;
                    }
                }

                let total_balance = total_initial_balance + target;
                let token = deploy_token(&env, &admin, &creator, total_balance);
                let client = deploy_contract(&env);

                let campaign_id = client.create_campaign(
                    &creator,
                    &token,
                    &target,
                    &deadline,
                    &String::from_str(&env, "test campaign"),
                );

                // Verify initial campaign state
                let campaign = client.get_campaign(&campaign_id);
                prop_assert!(
                    campaign.target_amount > 0,
                    "target_amount must be positive after creation"
                );
                prop_assert!(
                    campaign.pledged_amount >= 0,
                    "pledged_amount must be non-negative after creation"
                );

                // Execute operations
                for op in operations {
                    match op {
                        CampaignOp::Contribute {
                            amount,
                            contributor_id: _,
                        } => {
                            let contributor = Address::generate(&env);
                            let token_client = StellarAssetClient::new(&env, &token);
                            token_client.mint(&contributor, &amount);

                            let campaign_check = client.get_campaign(&campaign_id);
                            if env.ledger().timestamp() < campaign_check.deadline
                                && !campaign_check.claimed
                            {
                                let _ = std::panic::catch_unwind(
                                    std::panic::AssertUnwindSafe(|| {
                                        client.contribute(&campaign_id, &contributor, &amount);
                                    }),
                                );
                            }
                        }
                        CampaignOp::Refund { contributor_id: _ } => {
                            let contributor = Address::generate(&env);
                            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                                || {
                                    client.refund(&campaign_id, &contributor);
                                },
                            ));
                        }
                    }
                }

                // VERIFY INVARIANT: All amounts are non-negative
                let final_campaign = client.get_campaign(&campaign_id);
                prop_assert!(
                    final_campaign.target_amount > 0,
                    "target_amount must remain positive: {}",
                    final_campaign.target_amount
                );
                prop_assert!(
                    final_campaign.pledged_amount >= 0,
                    "pledged_amount must remain non-negative: {}",
                    final_campaign.pledged_amount
                );
            });
        }

        /// INVARIANT 3: Pledged amount never exceeds sum of all possible contributions
        /// This prevents overflow and invariant violations in accounting.
        #[test]
        fn prop_invariant_no_overflow() {
            proptest!(|(
                target in 100i128..50_000i128,
                operations in operations_strategy()
            )| {
                let env = Env::default();
                env.mock_all_auths();

                let creator = Address::generate(&env);
                let admin = Address::generate(&env);

                let deadline = env.ledger().timestamp() + 10_000;
                let mut total_initial_balance = 0i128;

                for op in &operations {
                    if let CampaignOp::Contribute { amount, .. } = op {
                        total_initial_balance += amount;
                    }
                }

                let total_balance = total_initial_balance + target;
                let token = deploy_token(&env, &admin, &creator, total_balance);
                let client = deploy_contract(&env);

                let campaign_id = client.create_campaign(
                    &creator,
                    &token,
                    &target,
                    &deadline,
                    &String::from_str(&env, "test campaign"),
                );

                let mut total_contributions_attempted = 0i128;

                // Execute operations
                for op in operations {
                    match op {
                        CampaignOp::Contribute { amount, contributor_id: _ } => {
                            let contributor = Address::generate(&env);
                            let token_client = StellarAssetClient::new(&env, &token);
                            token_client.mint(&contributor, &amount);

                            let campaign_check = client.get_campaign(&campaign_id);
                            if env.ledger().timestamp() < campaign_check.deadline
                                && !campaign_check.claimed
                            {
                                let _ = std::panic::catch_unwind(
                                    std::panic::AssertUnwindSafe(|| {
                                        client.contribute(&campaign_id, &contributor, &amount);
                                    }),
                                );
                                total_contributions_attempted += amount;
                            }
                        }
                        CampaignOp::Refund { contributor_id: _ } => {
                            let contributor = Address::generate(&env);
                            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                                || {
                                    client.refund(&campaign_id, &contributor);
                                },
                            ));
                        }
                    }
                }

                // VERIFY INVARIANT: pledged_amount <= total attempted contributions
                let final_campaign = client.get_campaign(&campaign_id);
                prop_assert!(
                    final_campaign.pledged_amount <= total_contributions_attempted,
                    "INVARIANT VIOLATION: pledged_amount ({}) exceeds total contributions ({})",
                    final_campaign.pledged_amount,
                    total_contributions_attempted
                );

                // Also verify it's within reasonable bounds
                prop_assert!(
                    final_campaign.pledged_amount >= 0,
                    "pledged_amount must be non-negative: {}",
                    final_campaign.pledged_amount
                );
            });
        }

        /// INVARIANT 4: Claimed campaigns remain immutable
        /// Once claimed, a campaign cannot accept new contributions or be refunded.
        #[test]
        fn prop_invariant_claim_immutability() {
            proptest!(|(
                target in 100i128..50_000i128
            )| {
                let env = Env::default();
                env.mock_all_auths();

                let creator = Address::generate(&env);
                let contributor = Address::generate(&env);
                let admin = Address::generate(&env);

                let deadline = env.ledger().timestamp() + 100;
                let token = deploy_token(&env, &admin, &contributor, target + 1000);
                let client = deploy_contract(&env);

                let campaign_id = client.create_campaign(
                    &creator,
                    &token,
                    &target,
                    &deadline,
                    &String::from_str(&env, "test campaign"),
                );

                // Contribute enough to fund
                client.contribute(&campaign_id, &contributor, &target);

                // Verify state before claim
                let campaign_before = client.get_campaign(&campaign_id);
                prop_assert!(
                    !campaign_before.claimed,
                    "Campaign should not be claimed before claim()"
                );

                // Advance past deadline and claim
                advance_time(&env, 101);
                client.claim(&campaign_id, &creator);

                // VERIFY INVARIANT: campaign is now marked as claimed
                let campaign_after = client.get_campaign(&campaign_id);
                prop_assert!(
                    campaign_after.claimed,
                    "Campaign should be marked claimed after claim()"
                );

                // Verify that further contributions fail (with error handling)
                let attacker = Address::generate(&env);
                let token_client = StellarAssetClient::new(&env, &token);
                token_client.mint(&attacker, &10);

                let result = std::panic::catch_unwind(
                    std::panic::AssertUnwindSafe(|| {
                        client.contribute(&campaign_id, &attacker, &10);
                    }),
                );

                prop_assert!(
                    result.is_err() || {
                        let campaign_final = client.get_campaign(&campaign_id);
                        campaign_final.pledged_amount == target
                    },
                    "Claimed campaign should reject contributions"
                );
            });
        }

        /// INVARIANT 5: Refund-after-deadline only on underfunded campaigns
        /// If a campaign fails to fund, refunds are allowed after deadline.
        /// If a campaign is funded, no refunds are allowed.
        #[test]
        fn prop_invariant_refund_funding_state() {
            proptest!(|(
                target in 100i128..50_000i128,
                partial_amount in 10i128..100i128
            )| {
                let env = Env::default();
                env.mock_all_auths();

                let creator = Address::generate(&env);
                let contributor = Address::generate(&env);
                let admin = Address::generate(&env);

                let deadline = env.ledger().timestamp() + 100;
                let refund_amount = if partial_amount < target {
                    partial_amount
                } else {
                    target / 2
                };

                let total_tokens = target + refund_amount + 100;
                let token = deploy_token(&env, &admin, &contributor, total_tokens);
                let client = deploy_contract(&env);

                let campaign_id = client.create_campaign(
                    &creator,
                    &token,
                    &target,
                    &deadline,
                    &String::from_str(&env, "test campaign"),
                );

                // Contribute only partial amount (underfunded)
                client.contribute(&campaign_id, &contributor, &refund_amount);

                // Verify it's underfunded
                let campaign_before = client.get_campaign(&campaign_id);
                prop_assert!(
                    campaign_before.pledged_amount < campaign_before.target_amount,
                    "Campaign should be underfunded"
                );

                // Advance past deadline
                advance_time(&env, 101);

                // Try to refund — should succeed for underfunded
                let result = std::panic::catch_unwind(
                    std::panic::AssertUnwindSafe(|| {
                        client.refund(&campaign_id, &contributor);
                    }),
                );

                // VERIFY INVARIANT: underfunded campaign allows refund after deadline
                prop_assert!(
                    result.is_ok() || {
                        // If panic, verify it's not due to funding state
                        let campaign = client.get_campaign(&campaign_id);
                        campaign.pledged_amount >= campaign.target_amount
                    },
                    "Underfunded campaign should allow refunds after deadline"
                );
            });
        }
    }
}
