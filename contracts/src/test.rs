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
    // version: getter returns current contract version
    // -------------------------------------------------------------------------
    #[test]
    fn test_get_version_returns_semver() {
        let env = Env::default();
        let client = deploy_contract(&env);

        let version = client.get_version();
        assert_eq!(version, String::from_str(&env, env!("CARGO_PKG_VERSION")));

        let mut parts = env!("CARGO_PKG_VERSION").split('.');
        let major = parts.next().unwrap_or("");
        let minor = parts.next().unwrap_or("");
        let patch = parts.next().unwrap_or("");
        assert!(
            parts.next().is_none(),
            "version should have major.minor.patch"
        );

        assert!(
            [major, minor, patch]
                .iter()
                .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit())),
            "version segments should be numeric"
        );
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
}
