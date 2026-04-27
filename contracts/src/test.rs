
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
}
}
