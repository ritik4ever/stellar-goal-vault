
#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, String, Vec,
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

    // -----------------------------------------------------------------------
    // create_campaign — snapshot tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_create_campaign_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        let deadline = env.ledger().timestamp() + 1000;
        let id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &1000_i128,
            &deadline,
            &String::from_str(&env, "my campaign"),
        );

        let campaign = client.get_campaign(&id);
        assert_eq!(campaign.creator, creator);
        assert_eq!(campaign.target_amount, 1000);
        assert_eq!(campaign.metadata, String::from_str(&env, "my campaign"));
    }

    #[test]
    #[should_panic(expected = "target amount must be positive")]
    fn test_create_campaign_zero_target() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &0_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "zero target"),
        );
    }

    #[test]
    #[should_panic(expected = "deadline must be in the future")]
    fn test_create_campaign_past_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        env.ledger().with_mut(|info| {
            info.timestamp = 1000;
        });

        let creator = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &500_i128,
            &(env.ledger().timestamp() - 1),
            &String::from_str(&env, "past deadline"),
        );
    }

    #[test]
    #[should_panic(expected = "deadline exceeds maximum campaign duration")]
    fn test_create_campaign_excessive_duration() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        let deadline = env.ledger().timestamp() + 60 * 60 * 24 * 180 + 1;
        client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &500_i128,
            &deadline,
            &String::from_str(&env, "excessive duration"),
        );
    }

    #[test]
    #[should_panic(expected = "at least one accepted token required")]
    fn test_create_campaign_no_tokens() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &Vec::new(&env),
            &500_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "no tokens"),
        );
    }

    // -----------------------------------------------------------------------
    // contribute — snapshot tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_contribute_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1000;
        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "contribute test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.pledged_amount, 500);
    }

    #[test]
    #[should_panic(expected = "contribution below minimum")]
    fn test_contribute_below_minimum() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "below min"),
        );

        client.contribute(&campaign_id, &contributor, &token, &50);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_contribute_to_claimed() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 50;
        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "contribute to claimed"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
        client.contribute(&campaign_id, &contributor, &token, &100);
    }

    #[test]
    #[should_panic(expected = "campaign canceled")]
    fn test_contribute_to_canceled() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "contribute to canceled"),
        );

        client.cancel_campaign(&campaign_id, &creator);
        client.contribute(&campaign_id, &contributor, &token, &100);
    }

    #[test]
    #[should_panic(expected = "campaign deadline reached")]
    fn test_contribute_after_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 50;
        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "after deadline"),
        );

        advance_time(&env, deadline_offset + 1);
        client.contribute(&campaign_id, &contributor, &token, &500);
    }

    #[test]
    #[should_panic(expected = "campaign funding cap exceeded")]
    fn test_contribute_exceeds_cap() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let token = deploy_token(&env, &admin, &contributor, target * 2);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "exceeds cap"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        client.contribute(&campaign_id, &contributor, &token, &100);
    }

    #[test]
    #[should_panic(expected = "token not accepted by this campaign")]
    fn test_contribute_unaccepted_token() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token_accepted = deploy_token(&env, &admin, &contributor, 1000);
        let token_other = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token_accepted]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "unaccepted token"),
        );

        client.contribute(&campaign_id, &contributor, &token_other, &500);
    }

    // -----------------------------------------------------------------------
    // claim — existing snapshots plus additional failure scenario
    // -----------------------------------------------------------------------

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
    #[should_panic(expected = "campaign canceled")]
    fn test_claim_canceled() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "claim canceled test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        client.cancel_campaign(&campaign_id, &creator);
        client.claim(&campaign_id, &creator);
    }

    // -----------------------------------------------------------------------
    // cancel_campaign — snapshot tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_cancel_campaign_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "cancel test"),
        );

        client.cancel_campaign(&campaign_id, &creator);

        let campaign = client.get_campaign(&campaign_id);
        assert!(campaign.canceled);
    }

    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_cancel_campaign_not_creator() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let attacker = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "cancel by attacker"),
        );

        client.cancel_campaign(&campaign_id, &attacker);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_cancel_campaign_already_claimed() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 50;
        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "cancel claimed"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
        client.cancel_campaign(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "campaign already canceled")]
    fn test_cancel_campaign_twice() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "cancel twice"),
        );

        client.cancel_campaign(&campaign_id, &creator);
        client.cancel_campaign(&campaign_id, &creator);
    }

    // -----------------------------------------------------------------------
    // refund — snapshot tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_refund_underfunded_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1000;
        let deadline_offset: u64 = 50;
        let token = deploy_token(&env, &admin, &contributor, 500);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "refund underfunded"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        advance_time(&env, deadline_offset + 1);
        client.refund(&campaign_id, &contributor);

        let contribution = client.get_contribution(&campaign_id, &contributor, &token);
        assert_eq!(contribution, 0);
    }

    #[test]
    fn test_refund_canceled_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "refund canceled"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        client.cancel_campaign(&campaign_id, &creator);
        client.refund(&campaign_id, &contributor);

        let contribution = client.get_contribution(&campaign_id, &contributor, &token);
        assert_eq!(contribution, 0);
    }

    #[test]
    #[should_panic(expected = "campaign is still active")]
    fn test_refund_active_campaign() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "refund active"),
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        client.refund(&campaign_id, &contributor);
    }

    #[test]
    #[should_panic(expected = "funded campaigns cannot be refunded")]
    fn test_refund_funded_campaign() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 50;
        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "refund funded"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.refund(&campaign_id, &contributor);
    }

    #[test]
    #[should_panic(expected = "nothing to refund")]
    fn test_refund_nothing() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "refund nothing"),
        );

        client.cancel_campaign(&campaign_id, &creator);
        client.refund(&campaign_id, &contributor);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_refund_claimed() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 50;
        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &target,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "refund claimed"),
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
        client.refund(&campaign_id, &contributor);
    }

    // -----------------------------------------------------------------------
    // get_campaign — snapshot tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_campaign_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let token = deploy_token(&env, &Address::generate(&env), &creator, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "get campaign"),
        );

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.creator, creator);
        assert_eq!(campaign.metadata, String::from_str(&env, "get campaign"));
    }

    #[test]
    #[should_panic(expected = "campaign not found")]
    fn test_get_campaign_not_found() {
        let env = Env::default();
        env.mock_all_auths();

        let client = deploy_contract(&env);
        client.get_campaign(&999);
    }

    // -----------------------------------------------------------------------
    // get_contribution — snapshot tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_contribution_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "get contribution"),
        );

        client.contribute(&campaign_id, &contributor, &token, &750);

        let amount = client.get_contribution(&campaign_id, &contributor, &token);
        assert_eq!(amount, 750);
    }

    #[test]
    fn test_get_contribution_zero() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "zero contribution"),
        );

        let amount = client.get_contribution(&campaign_id, &contributor, &token);
        assert_eq!(amount, 0);
    }

    // -----------------------------------------------------------------------
    // get_campaign_count / get_next_campaign_id — snapshot tests
    // -----------------------------------------------------------------------

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
        assert_eq!(client.get_campaign_count(), 2);
        assert_eq!(client.get_next_campaign_id(), 2);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &300_i128,
            &deadline,
            &meta("c3"),
        );
        assert_eq!(client.get_campaign_count(), 3);
        assert_eq!(client.get_next_campaign_id(), 3);
    }

    // -----------------------------------------------------------------------
    // get_contributor_count — snapshot tests
    // -----------------------------------------------------------------------

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

        client.contribute(&campaign_id, &contributor, &token, &400);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);

        client.contribute(&campaign_id, &contributor, &token, &300);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);
    }

    // -----------------------------------------------------------------------
    // get_campaign_token_balance — snapshot test
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_campaign_token_balance_after_contribute() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token = deploy_token(&env, &admin, &contributor, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "token balance test"),
        );

        client.contribute(&campaign_id, &contributor, &token, &750);

        let balance = client.get_campaign_token_balance(&campaign_id, &token);
        assert_eq!(balance, 750);
    }

    #[test]
    fn test_get_campaign_token_balance_zero() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &Vec::from_array(&env, [token.clone()]),
            &1000_i128,
            &(env.ledger().timestamp() + 1000),
            &String::from_str(&env, "zero balance test"),
        );

        let balance = client.get_campaign_token_balance(&campaign_id, &token);
        assert_eq!(balance, 0);
    }

    // -----------------------------------------------------------------------
    // get_version — snapshot test
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_version_returns_pkg_version() {
        let env = Env::default();
        let client = deploy_contract(&env);

        let version = client.get_version();
        assert!(version.len() > 0);
    }
}
