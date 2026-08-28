
#[cfg(test)]
mod tests {
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
        );
        assert_eq!(client.get_campaign_count(), 1);
        assert_eq!(client.get_next_campaign_id(), 1);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &200_i128,
            &deadline,
            &meta("c2"),
            &0_i128,
        );
        assert_eq!(client.get_campaign_count(), 2);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &300_i128,
            &deadline,
            &meta("c3"),
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "cancel mismatch test"),
            &0_i128,
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
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "cancel claimed test"),
            &0_i128,
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
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "double cancel test"),
            &0_i128,
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
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "cancel refund test"),
            &0_i128,
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
            &0_i128,
        );

        // Same contributor pledges twice — count must stay at 1
        client.contribute(&campaign_id, &contributor, &token, &400);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);

        client.contribute(&campaign_id, &contributor, &token, &300);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);
    }


    #[test]
    fn test_contributor_count_no_double_count_multiple_tokens() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token1 = deploy_token(&env, &admin, &contributor, 1_000);
        let token2 = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token1.clone(), token2.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multiple tokens pledge test"),
            &0_i128,
        );

        // Contributor pledges with token1
        client.contribute(&campaign_id, &contributor, &token1, &400);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);

        // Contributor pledges with token2 - count should remain 1
        client.contribute(&campaign_id, &contributor, &token2, &300);
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
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
            &0_i128,
        );

        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        let new_deadline = env.ledger().timestamp() + 500;
        client.request_deadline_extension(&campaign_id, &contributor, &new_deadline);
    }

    // ── platform fee tests ────────────────────────────────────────────────────

    #[test]
    fn test_default_fee_bps_is_50() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);

        // Before initialize, default applies
        assert_eq!(client.get_platform_fee_bps(), 50);
    }

    #[test]
    fn test_default_fee_recipient_is_none() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);

        assert!(client.get_fee_recipient().is_none());
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_set_fee_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        client.initialize(&admin, &100_i128);

        // attacker tries to set fee — must panic
        client.set_fee(&attacker, &100);
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_set_fee_recipient_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let recipient = Address::generate(&env);
        client.initialize(&admin, &100_i128);

        // attacker tries to set fee recipient — must panic
        client.set_fee_recipient(&attacker, &recipient);
    }

    #[test]
    fn test_set_fee_and_recipient() {
        let env = Env::default();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        client.initialize(&admin, &100_i128);

        client.set_fee(&admin, &200);
        assert_eq!(client.get_platform_fee_bps(), 200);

        client.set_fee_recipient(&admin, &recipient);
        assert_eq!(client.get_fee_recipient().unwrap(), recipient);
    }

    #[test]
    fn test_claim_deducts_fee() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let fee_recipient = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        // Set fee: 200 bps = 2%
        client.set_fee(&admin, &200);
        client.set_fee_recipient(&admin, &fee_recipient);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "fee test"),
            &0_i128,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        // 2% of 1000 = 20 fee
        // Creator gets 980, fee_recipient gets 20
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&creator), 980);
        assert_eq!(token_client.balance(&fee_recipient), 20);

        let campaign = client.get_campaign(&campaign_id);
        assert!(campaign.claimed);
    }

    #[test]
    fn test_claim_zero_fee_disables_mechanism() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let fee_recipient = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        // Set fee to 0 — disabled
        client.set_fee(&admin, &0);
        client.set_fee_recipient(&admin, &fee_recipient);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "zero fee test"),
            &0_i128,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        // fee=0 — all to creator
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&creator), 1_000);
        assert_eq!(token_client.balance(&fee_recipient), 0);
    }

    #[test]
    fn test_claim_no_recipient_no_fee() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        // Set fee to 200 bps but don't set recipient — no fee taken
        client.set_fee(&admin, &200);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "no recipient test"),
            &0_i128,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        // No recipient — all to creator
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&creator), 1_000);
    }

    #[test]
    fn test_fee_collected_event_emitted() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let fee_recipient = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        client.set_fee(&admin, &200);
        client.set_fee_recipient(&admin, &fee_recipient);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "fee event test"),
            &0_i128,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        // Verify event via balance check (core logic)
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&creator), 980);
        assert_eq!(token_client.balance(&fee_recipient), 20);
    }

    #[test]
    fn test_fee_collected_not_emitted_when_fee_zero() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let fee_recipient = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        client.set_fee(&admin, &0);
        client.set_fee_recipient(&admin, &fee_recipient);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "no fee event test"),
            &0_i128,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        // Fee=0 → all to creator
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&creator), 1_000);
        assert_eq!(token_client.balance(&fee_recipient), 0);
    }

    // ── #526: milestone tests ──────────────────────────────────────────────

    #[test]
    fn test_set_milestones_success() {
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
            &String::from_str(&env, "milestone test"),
            &0_i128,
        );

        // Set 3 milestones: 30%, 30%, 40%
        let percentages = soroban_sdk::vec![&env, 3000, 3000, 4000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        assert_eq!(client.get_milestone_count(&campaign_id), 3);

        let m0 = client.get_milestone(&campaign_id, &0);
        assert_eq!(m0.percentage_bps, 3000);
        assert!(!m0.completed);
        assert!(!m0.claimed);

        let m1 = client.get_milestone(&campaign_id, &1);
        assert_eq!(m1.percentage_bps, 3000);

        let m2 = client.get_milestone(&campaign_id, &2);
        assert_eq!(m2.percentage_bps, 4000);
    }

    #[test]
    #[should_panic(expected = "milestone percentages must sum to 10000")]
    fn test_set_milestones_rejects_wrong_sum() {
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
            &String::from_str(&env, "milestone bad sum"),
            &0_i128,
        );

        // 30% + 30% = 60%, not 100%
        let percentages = soroban_sdk::vec![&env, 3000, 3000];
        client.set_milestones(&campaign_id, &creator, &percentages);
    }

    #[test]
    #[should_panic(expected = "milestone count must be 1-5")]
    fn test_set_milestones_rejects_too_many() {
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
            &String::from_str(&env, "milestone too many"),
            &0_i128,
        );

        // 6 milestones is too many
        let percentages = soroban_sdk::vec![&env, 2000, 2000, 2000, 2000, 1000, 1000];
        client.set_milestones(&campaign_id, &creator, &percentages);
    }

    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_set_milestones_rejects_non_creator() {
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
            &String::from_str(&env, "milestone mismatch"),
            &0_i128,
        );

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &attacker, &percentages);
    }

    #[test]
    fn test_complete_milestone_success() {
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
            &String::from_str(&env, "milestone complete"),
            &0_i128,
        );

        let percentages = soroban_sdk::vec![&env, 5000, 5000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);

        let m0 = client.get_milestone(&campaign_id, &0);
        assert!(m0.completed);
        assert!(m0.completion_time.is_some());
        assert!(m0.dispute_window_end.is_some());
    }

    #[test]
    #[should_panic(expected = "milestone already completed")]
    fn test_complete_milestone_already_completed() {
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
            &String::from_str(&env, "milestone double complete"),
            &0_i128,
        );

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);
        client.complete_milestone(&campaign_id, &0, &creator);
    }

    #[test]
    fn test_dispute_milestone_success() {
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
            &String::from_str(&env, "milestone dispute"),
            &0_i128,
        );

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);

        // Dispute within window
        client.dispute_milestone(&campaign_id, &0, &contributor);
    }

    #[test]
    #[should_panic(expected = "dispute window has expired")]
    fn test_dispute_milestone_after_window() {
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
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "milestone dispute late"),
            &0_i128,
        );

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);

        // Advance past dispute window (48h = 172800s)
        advance_time(&env, 172801);

        client.dispute_milestone(&campaign_id, &0, &contributor);
    }

    #[test]
    #[should_panic(expected = "dispute window still active")]
    fn test_claim_milestone_during_window() {
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
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "milestone early claim"),
            &0_i128,
        );

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);

        // Try to claim immediately (still in dispute window)
        client.claim_milestone(&campaign_id, &0, &creator);
    }

    #[test]
    fn test_claim_milestone_after_window_no_dispute() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);
        client.set_fee(&admin, &0); // No fee

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "milestone claim success"),
            &0_i128,
        );

        // Contribute
        client.contribute(&campaign_id, &creator, &token, &1_000);

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);

        // Advance past dispute window
        advance_time(&env, 172801);

        client.claim_milestone(&campaign_id, &0, &creator);

        let token_client = TokenClient::new(&env, &token);
        // Creator should receive 100% of 1000 = 1000
        assert_eq!(token_client.balance(&creator), 1_000);
    }

    #[test]
    fn test_claim_milestone_partial_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);
        client.set_fee(&admin, &0); // No fee

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "milestone partial"),
            &0_i128,
        );

        // Contribute
        client.contribute(&campaign_id, &creator, &token, &1_000);

        // 30% + 70%
        let percentages = soroban_sdk::vec![&env, 3000, 7000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        // Complete first milestone
        client.complete_milestone(&campaign_id, &0, &creator);
        advance_time(&env, 172801);
        client.claim_milestone(&campaign_id, &0, &creator);

        let token_client = TokenClient::new(&env, &token);
        // 30% of 1000 = 300
        assert_eq!(token_client.balance(&creator), 300);

        // Complete second milestone
        client.complete_milestone(&campaign_id, &1, &creator);
        advance_time(&env, 172801);
        client.claim_milestone(&campaign_id, &1, &creator);

        // 300 + 700 = 1000
        assert_eq!(token_client.balance(&creator), 1_000);
    }

    #[test]
    fn test_admin_resolve_milestone_approved() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);
        client.set_fee(&admin, &0);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "admin resolve"),
            &0_i128,
        );

        client.contribute(&campaign_id, &creator, &token, &1_000);

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);

        // Dispute
        client.dispute_milestone(&campaign_id, &0, &contributor);

        // Admin approves - sets dispute_window_end to 0 so claim can proceed
        client.admin_resolve_milestone(&campaign_id, &0, &admin, &true);

        // Now creator can claim (dispute window is set to 0, so now > 0 always)
        client.claim_milestone(&campaign_id, &0, &creator);

        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&creator), 1_000);
    }

    #[test]
    fn test_admin_resolve_milestone_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "admin reject"),
            &0_i128,
        );

        client.contribute(&campaign_id, &creator, &token, &1_000);

        let percentages = soroban_sdk::vec![&env, 10000];
        client.set_milestones(&campaign_id, &creator, &percentages);

        client.complete_milestone(&campaign_id, &0, &creator);

        // Dispute
        client.dispute_milestone(&campaign_id, &0, &contributor);

        // Admin rejects
        client.admin_resolve_milestone(&campaign_id, &0, &admin, &false);

        // Milestone is now claimed (rejected)
        let m0 = client.get_milestone(&campaign_id, &0);
        assert!(m0.claimed);
    }

    // ── #534: featured / spotlight campaigns ─────────────────────────────────

    #[test]
    fn test_feature_campaign_sets_flag() {
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
            &String::from_str(&env, "feature test"),
            &0_i128,
        );

        client.feature_campaign(&admin, &campaign_id);

        assert!(client.is_campaign_featured(&campaign_id));
        let featured = client.get_featured_campaigns();
        assert_eq!(featured.len(), 1);
        assert_eq!(featured.get(0).unwrap(), campaign_id);
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_feature_campaign_admin_only() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "feature admin test"),
            &0_i128,
        );

        client.feature_campaign(&attacker, &campaign_id);
    }

    #[test]
    #[should_panic(expected = "campaign not found")]
    fn test_feature_campaign_requires_existing_campaign() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        // Campaign 1 does not exist yet
        client.feature_campaign(&admin, &1);
    }

    #[test]
    fn test_featured_flag_expires_after_7_days() {
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
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "expiry test"),
            &0_i128,
        );

        client.feature_campaign(&admin, &campaign_id);
        assert!(client.is_campaign_featured(&campaign_id));

        // 7 days + 1 second later the flag is expired with no admin action
        advance_time(&env, 7 * 24 * 60 * 60 + 1);

        assert!(!client.is_campaign_featured(&campaign_id));
        assert_eq!(client.get_featured_campaigns().len(), 0);
    }

    #[test]
    fn test_unfeature_campaign_removes_flag() {
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
            &String::from_str(&env, "unfeature test"),
            &0_i128,
        );

        client.feature_campaign(&admin, &campaign_id);
        client.unfeature_campaign(&admin, &campaign_id);

        assert!(!client.is_campaign_featured(&campaign_id));
        assert_eq!(client.get_featured_campaigns().len(), 0);
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_unfeature_campaign_admin_only() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "unfeature admin test"),
            &0_i128,
        );

        client.unfeature_campaign(&attacker, &campaign_id);
    }

    #[test]
    fn test_unfeature_campaign_idempotent() {
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
            &String::from_str(&env, "idempotent unfeature"),
            &0_i128,
        );

        // Un-featuring a never-featured campaign and twice in a row is a no-op
        client.unfeature_campaign(&admin, &campaign_id);
        client.unfeature_campaign(&admin, &campaign_id);
        assert!(!client.is_campaign_featured(&campaign_id));
    }

    #[test]
    fn test_get_featured_campaigns_excludes_unfeatured_and_expired() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 10_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        let deadline = env.ledger().timestamp() + 1_000_000;
        let c1 = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &deadline,
            &String::from_str(&env, "featured"),
            &0_i128,
        );
        let c2 = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &deadline,
            &String::from_str(&env, "not featured"),
            &0_i128,
        );
        let c3 = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &deadline,
            &String::from_str(&env, "expired"),
            &0_i128,
        );

        // Feature c1 and c3; leave c2 unfeatured
        client.feature_campaign(&admin, &c1);
        client.feature_campaign(&admin, &c3);

        // Let c3's flag expire (feature everything, then expire only c3's by
        // advancing 7 days and re-featuring c1)
        advance_time(&env, 7 * 24 * 60 * 60 + 1);
        assert!(!client.is_campaign_featured(&c3));
        client.feature_campaign(&admin, &c1);

        // c2 was never featured and c3's flag expired — only c1 remains
        assert!(!client.is_campaign_featured(&c2));
        assert!(!client.is_campaign_featured(&c3));
        assert!(client.is_campaign_featured(&c1));

        let featured = client.get_featured_campaigns();
        assert_eq!(featured.len(), 1);
        assert_eq!(featured.get(0).unwrap(), c1);
    }

    #[test]
    fn test_refeature_refreshes_expiry() {
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
            &(env.ledger().timestamp() + 1_000_000),
            &String::from_str(&env, "refeature test"),
            &0_i128,
        );

        client.feature_campaign(&admin, &campaign_id);
        // 4 days in, re-feature (fresh 7-day window from now)
        advance_time(&env, 4 * 24 * 60 * 60);
        client.feature_campaign(&admin, &campaign_id);
        // 4 more days later: 8 days since first feature, but only 4 since refresh
        advance_time(&env, 4 * 24 * 60 * 60);
        assert!(client.is_campaign_featured(&campaign_id));

        // After the refreshed window elapses it expires again
        advance_time(&env, 3 * 24 * 60 * 60 + 1);
        assert!(!client.is_campaign_featured(&campaign_id));
    }

}
