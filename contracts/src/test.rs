#[cfg(test)]
mod test {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, String, Vec,
    };

    use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient, PlatformStats};

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
    fn test_platform_stats_tracking() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor1 = Address::generate(&env);
        let contributor2 = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let token = deploy_token(&env, &admin, &contributor1, target * 2);
        let asset_client = StellarAssetClient::new(&env, &token);
        asset_client.mint(&contributor2, &target);

        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        // 1. Create campaign
        let deadline = env.ledger().timestamp() + 1_000;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline,
            &String::from_str(&env, "stats test"),
            &0_i128,
        );

        let mut stats = client.get_platform_stats();
        assert_eq!(stats.total_campaigns, 1);
        assert_eq!(stats.unique_contributors, 0);

        // 2. Contribute (contributor1)
        client.contribute(&campaign_id, &contributor1, &token, &target);
        stats = client.get_platform_stats();
        assert_eq!(stats.unique_contributors, 1);
        assert_eq!(stats.total_pledged_by_token.len(), 1);
        assert_eq!(stats.total_pledged_by_token.get(0).unwrap().1, target);

        // 3. Contribute (contributor2)
        client.contribute(&campaign_id, &contributor2, &token, &target);
        stats = client.get_platform_stats();
        assert_eq!(stats.unique_contributors, 2);
        assert_eq!(stats.total_pledged_by_token.get(0).unwrap().1, target * 2);

        // 4. Claim (campaign success)
        advance_time(&env, 1_001);
        client.claim(&campaign_id, &creator);
        stats = client.get_platform_stats();
        assert_eq!(stats.campaigns_funded, 1);
        assert_eq!(stats.campaigns_failed, 0);

        // 5. Create failing campaign
        let deadline2 = env.ledger().timestamp() + 1_000;
        let campaign_id2 = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &target,
            &deadline2,
            &String::from_str(&env, "fail test"),
            &0_i128,
        );

        client.cancel_campaign(&campaign_id2, &creator);
        stats = client.get_platform_stats();
        assert_eq!(stats.campaigns_failed, 1);
    }
}
