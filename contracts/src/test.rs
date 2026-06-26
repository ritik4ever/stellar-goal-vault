
#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, String,
    };

    use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};

    fn deploy_contract(env: &Env) -> StellarGoalVaultContractClient<'_> {
        let contract_id = env.register_contract(None, StellarGoalVaultContract);
        StellarGoalVaultContractClient::new(env, &contract_id)
    }

    fn deploy_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(env, &token_id);
        asset_client.mint(recipient, &amount);
        token_id
    }

    fn advance_time(env: &Env, seconds: u64) {
        env.ledger().with_mut(|info| {
            info.timestamp += seconds;
        });
    }


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

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "test campaign"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        let campaign = client.get_campaign(&campaign_id);
        assert!(campaign.claimed, "campaign should be marked claimed");
        assert_eq!(campaign.pledged_amount, target);
    }

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
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "mismatch test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &attacker);
    }

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
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "early claim test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        client.claim(&campaign_id, &creator);
    }

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

        let token = deploy_token(&env, &admin, &contributor, target / 2);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "underfunded test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &(target / 2));
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
    }

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
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "double claim test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    fn test_get_campaign_count_tracks_creates() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 10_000);
        let client = deploy_contract(&env);

        assert_eq!(client.get_campaign_count(), 0);
        assert_eq!(client.get_next_campaign_id(), 0);

        let deadline = env.ledger().timestamp() + 1_000;
        let meta = |s: &str| String::from_str(&env, s);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &100_i128,
            &deadline,
            &meta("c1"),
        );
        assert_eq!(client.get_campaign_count(), 1);
        assert_eq!(client.get_next_campaign_id(), 1);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &200_i128,
            &deadline,
            &meta("c2"),
        );
        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &300_i128,
            &deadline,
            &meta("c3"),
        );
    }

    #[test]
    fn test_contributor_count_zero_on_new_campaign() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "count zero test"),
        );

        assert_eq!(client.get_contributor_count(&campaign_id), 0);
    }

    #[test]
    fn test_contributor_count_single_contributor() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "single contributor test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);
    }

    #[test]
    fn test_contributor_count_multiple_unique_contributors() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor1 = Address::generate(&env);
        let contributor2 = Address::generate(&env);
        let contributor3 = Address::generate(&env);
        let admin = Address::generate(&env);

        // Mint tokens to each contributor separately
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&contributor1, &200);
        asset_client.mint(&contributor2, &200);
        asset_client.mint(&contributor3, &200);

        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token_id.clone()],
            &600_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multi contributor test"),
        );

        client.contribute(&campaign_id, &contributor1, &token_id, &200);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);

        client.contribute(&campaign_id, &contributor2, &token_id, &200);
        assert_eq!(client.get_contributor_count(&campaign_id), 2);

        client.contribute(&campaign_id, &contributor3, &token_id, &200);
        assert_eq!(client.get_contributor_count(&campaign_id), 3);
    }

    #[test]
    #[should_panic(expected = "too many accepted tokens")]
    fn test_max_accepted_tokens_rejects_overflow() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let client = deploy_contract(&env);

        // Build a Vec with 11 tokens (MAX_ACCEPTED_TOKENS + 1)
        let mut tokens = soroban_sdk::vec![&env];
        for _ in 0..11 {
            let token = deploy_token(&env, &admin, &creator, 1_000);
            tokens.push_back(token);
        }

        client.create_campaign(
            &creator,
            &tokens,
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "max tokens test"),
        );
    }

    #[test]
    fn test_max_accepted_tokens_allows_exactly_10() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let client = deploy_contract(&env);

        let mut tokens = soroban_sdk::vec![&env];
        for _ in 0..10 {
            let token = deploy_token(&env, &admin, &creator, 1_000);
            tokens.push_back(token);
        }

        let campaign_id = client.create_campaign(
            &creator,
            &tokens,
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "exactly 10 tokens"),
        );

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.accepted_tokens.len(), 10);
    }

    // ── admin / pause tests (issue #193) ──────────────────────────────────────

    #[test]
    fn test_initialize_sets_admin_and_unpaused() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        client.initialize(&admin, &100_i128);
        assert_eq!(client.get_admin(), admin);
        assert!(!client.get_paused());
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_initialize_panics_if_called_twice() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        client.initialize(&admin, &100_i128);
        client.initialize(&admin, &100_i128);
    }

    #[test]
    fn test_admin_can_pause_and_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        client.initialize(&admin, &100_i128);

        client.set_paused(&admin, &true);
        assert!(client.get_paused());

        client.set_paused(&admin, &false);
        assert!(!client.get_paused());
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_non_admin_cannot_pause() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        client.initialize(&admin, &100_i128);
        client.set_paused(&attacker, &true);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_contribute_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "pause test"),
        );

        client.set_paused(&admin, &true);
        client.contribute(&campaign_id, &contributor, &token, &500);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_claim_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let deadline_offset: u64 = 100;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "pause claim test"),
        );
        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, deadline_offset + 1);

        client.set_paused(&admin, &true);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_refund_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 500);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let deadline_offset: u64 = 50;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "pause refund test"),
        );
        client.contribute(&campaign_id, &contributor, &token, &500);
        advance_time(&env, deadline_offset + 1);

        client.set_paused(&admin, &true);
        client.refund(&campaign_id, &contributor);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_cancel_campaign_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "pause cancel test"),
        );

        client.set_paused(&admin, &true);
        client.cancel_campaign(&campaign_id, &creator);
    }

    #[test]
    fn test_read_only_functions_work_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "read when paused"),
        );
        client.set_paused(&admin, &true);

        // All reads must succeed even when paused
        let _ = client.get_campaign(&campaign_id);
        assert_eq!(client.get_campaign_count(), 1);
        assert!(client.get_paused());
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_cancel_campaign_success() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "cancel test"),
        );
        client.cancel_campaign(&campaign_id, &creator);
        assert!(client.get_campaign(&campaign_id).canceled);
    }

    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_cancel_campaign_non_creator_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let attacker = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "cancel mismatch test"),
        );
        // attacker tries to cancel — must panic with "creator mismatch"
        client.cancel_campaign(&campaign_id, &attacker);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_cancel_campaign_already_claimed_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 100;
        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);
        client.initialize(&admin);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "cancel claimed test"),
        );
        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        // campaign is now claimed — cancel must panic
        client.cancel_campaign(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "campaign already canceled")]
    fn test_cancel_campaign_double_cancel_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "double cancel test"),
        );
        client.cancel_campaign(&campaign_id, &creator);
        // second cancel must panic
        client.cancel_campaign(&campaign_id, &creator);
    }

    #[test]
    fn test_refund_works_on_canceled_campaign_before_deadline() {
        let env = Env::default();
        env.mock_all_auths();
        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let pledge_amount: i128 = 300;
        let target: i128 = 1_000;
        // Long deadline — we will NOT advance time past it
        let deadline_offset: u64 = 10_000;
        let token = deploy_token(&env, &admin, &contributor, pledge_amount);
        let client = deploy_contract(&env);
        client.initialize(&admin);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "cancel refund test"),
        );
        client.contribute(&campaign_id, &contributor, &token, &pledge_amount);

        // Cancel while deadline is still in the future
        client.cancel_campaign(&campaign_id, &creator);

        // Contributor must be able to refund immediately (no time-travel needed)
        client.refund(&campaign_id, &contributor);

        // Contribution should be zeroed out and pledged_amount reduced
        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.pledged_amount, 0);
        let remaining = client.get_contribution(&campaign_id, &contributor, &token);
        assert_eq!(remaining, 0);
    }

    #[test]
    fn test_contributor_count_no_double_count_on_repeat_pledge() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "repeat pledge test"),
        );

        // Same contributor pledges twice — count must stay at 1
        client.contribute(&campaign_id, &contributor, &token, &400);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);

        client.contribute(&campaign_id, &contributor, &token, &300);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);
    }

    // ── #184: minimum contribution tests ──────────────────────────────────────

    #[test]
    fn test_default_min_contribution_is_100() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        assert_eq!(client.get_min_contribution(), 100);
    }

    #[test]
    fn test_initialize_sets_custom_min_contribution() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        client.initialize(&admin, &500_i128);
        assert_eq!(client.get_min_contribution(), 500);
    }

    #[test]
    #[should_panic(expected = "contribution below minimum")]
    fn test_contribute_rejects_99_stroops() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        // mint 99 so the transfer would succeed if the guard weren't there
        let token = deploy_token(&env, &admin, &contributor, 99);
        let client = deploy_contract(&env);
        // deploy with default MIN_CONTRIBUTION = 100

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "boundary test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &99);
    }

    #[test]
    fn test_contribute_accepts_exactly_100_stroops() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "boundary accept test"),
        );

        // Exactly 100 must succeed
        client.contribute(&campaign_id, &contributor, &token, &100);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 100);
    }

    #[test]
    #[should_panic(expected = "contribution below minimum")]
    fn test_contribute_rejects_below_custom_min() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);
        // Set minimum to 500
        client.initialize(&admin, &500_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "custom min test"),
        );

        // 499 is below the custom minimum of 500
        client.contribute(&campaign_id, &contributor, &token, &499);
    }

    #[test]
    fn test_contribute_accepts_at_custom_min() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &500_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "custom min accept test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 500);
    }

    // ── #185: update_metadata tests ───────────────────────────────────────────

    #[test]
    fn test_update_metadata_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "original metadata"),
        );

        client.update_metadata(
            &campaign_id,
            &creator,
            &String::from_str(&env, "updated metadata"),
        );

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.metadata, String::from_str(&env, "updated metadata"));
    }

    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_update_metadata_rejects_non_creator() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let attacker = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "original metadata"),
        );

        client.update_metadata(
            &campaign_id,
            &attacker,
            &String::from_str(&env, "hacked"),
        );
    }

    #[test]
    #[should_panic(expected = "campaign deadline reached")]
    fn test_update_metadata_rejects_after_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 50;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "original metadata"),
        );

        advance_time(&env, deadline_offset + 1);

        client.update_metadata(
            &campaign_id,
            &creator,
            &String::from_str(&env, "too late"),
        );
    }

    #[test]
    #[should_panic(expected = "campaign canceled")]
    fn test_update_metadata_rejects_canceled_campaign() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "original metadata"),
        );

        client.cancel_campaign(&campaign_id, &creator);
        client.update_metadata(
            &campaign_id,
            &creator,
            &String::from_str(&env, "update on canceled"),
        );
    }

    // ── #192: deadline extension governance tests ─────────────────────────────

    #[test]
    fn test_request_extension_stores_request() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 1_000;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "extension test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);

        let new_deadline = env.ledger().timestamp() + deadline_offset + 500;
        client.request_deadline_extension(&campaign_id, &contributor, &new_deadline);

        let request = client.get_extension_request(&campaign_id).unwrap();
        assert_eq!(request.new_deadline, new_deadline);
        assert_eq!(request.approval_count, 1); // requester auto-approves
        assert_eq!(request.requested_by, contributor);
    }

    #[test]
    #[should_panic(expected = "caller is not a contributor")]
    fn test_request_extension_rejects_non_contributor() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let non_contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 1_000;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "extension test"),
        );

        let new_deadline = env.ledger().timestamp() + deadline_offset + 500;
        client.request_deadline_extension(&campaign_id, &non_contributor, &new_deadline);
    }

    #[test]
    #[should_panic(expected = "new deadline exceeds maximum campaign duration")]
    fn test_request_extension_rejects_excessive_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "extension max test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);

        // 181 days from now — exceeds MAX_CAMPAIGN_DURATION_SECONDS (180 days)
        let excessive_deadline = env.ledger().timestamp() + (60 * 60 * 24 * 181);
        client.request_deadline_extension(&campaign_id, &contributor, &excessive_deadline);
    }

    #[test]
    fn test_approve_extension_applies_when_majority_reached() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor1 = Address::generate(&env);
        let contributor2 = Address::generate(&env);
        let admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&contributor1, &300);
        asset_client.mint(&contributor2, &300);

        let client = deploy_contract(&env);

        let deadline_offset: u64 = 1_000;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token_id.clone()],
            &600_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "majority test"),
        );

        client.contribute(&campaign_id, &contributor1, &token_id, &300);
        client.contribute(&campaign_id, &contributor2, &token_id, &300);
        assert_eq!(client.get_contributor_count(&campaign_id), 2);

        let original_deadline = client.get_campaign(&campaign_id).deadline;
        let new_deadline = original_deadline + 500;

        // contributor1 requests (auto-approves: 1/2 = 50%, not yet majority)
        client.request_deadline_extension(&campaign_id, &contributor1, &new_deadline);
        let campaign_after_request = client.get_campaign(&campaign_id);
        assert_eq!(campaign_after_request.deadline, original_deadline); // not yet applied

        // contributor2 approves: 2/2 > 50% → apply
        client.approve_extension(&campaign_id, &contributor2);
        let campaign_after = client.get_campaign(&campaign_id);
        assert_eq!(campaign_after.deadline, new_deadline);

        // Extension request cleared
        assert!(client.get_extension_request(&campaign_id).is_none());
    }

    #[test]
    #[should_panic(expected = "already voted")]
    fn test_approve_extension_rejects_double_vote() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor1 = Address::generate(&env);
        let contributor2 = Address::generate(&env);
        let contributor3 = Address::generate(&env);
        let admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&contributor1, &200);
        asset_client.mint(&contributor2, &200);
        asset_client.mint(&contributor3, &200);

        let client = deploy_contract(&env);

        let deadline_offset: u64 = 1_000;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token_id.clone()],
            &600_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "double vote test"),
        );

        client.contribute(&campaign_id, &contributor1, &token_id, &200);
        client.contribute(&campaign_id, &contributor2, &token_id, &200);
        client.contribute(&campaign_id, &contributor3, &token_id, &200);

        let original_deadline = client.get_campaign(&campaign_id).deadline;
        let new_deadline = original_deadline + 500;

        client.request_deadline_extension(&campaign_id, &contributor1, &new_deadline);
        // contributor1 tries to approve again after already requesting (auto-voting)
        client.approve_extension(&campaign_id, &contributor1);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_request_extension_rejects_claimed_campaign() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 100;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "claimed extension test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        let new_deadline = env.ledger().timestamp() + 500;
        client.request_deadline_extension(&campaign_id, &contributor, &new_deadline);
    }
}
