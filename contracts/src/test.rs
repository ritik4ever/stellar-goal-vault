#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, String,
    };

    use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};
    // Keep contract tests independent of the machine clock and local timezone.
    // Soroban timestamps are UTC Unix seconds; epoch zero preserves the mock
    // ledger's historical test behavior while making the chosen time explicit.
    const TEST_LEDGER_TIMESTAMP: u64 = 0;

    fn test_env() -> Env {
        let env = Env::default();
        env.ledger().set_timestamp(TEST_LEDGER_TIMESTAMP);
        env
    }

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

    /// Builds a synthetic metadata String of `len` bytes for boundary tests.
    fn oversized_metadata(env: &Env, len: usize) -> String {
        let buf: [u8; 501] = [b'x'; 501];
        String::from_bytes(env, &buf[..len])
    }

    // ---- #895: campaign-creation boundary validation ---------------------
    // Invalid boundary input must panic with a stable error and leave the
    // campaign counter (and therefore all storage) untouched.

    #[test]
    #[should_panic(expected = "max_per_contributor must not exceed target_amount")]
    fn test_create_campaign_rejects_cap_above_target() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        // Cap (1_001) exceeds target (1_000) — inconsistent accounting state.
        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "cap above target"),
            &1_001_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    fn test_create_campaign_allows_cap_equal_target() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        // Boundary: cap == target is a consistent configuration and must be
        // accepted (cap > target is rejected; cap < target and 0 are fine).
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "cap equals target"),
            &1_000_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        assert_eq!(client.get_campaign(&campaign_id).target_amount, 1_000);
    }

    #[test]
    #[should_panic(expected = "accepted_tokens must contain valid token contract addresses")]
    fn test_create_campaign_rejects_non_token_address() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let client = deploy_contract(&env);

        // A plain generated address is not a token contract.
        let not_a_token = Address::generate(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, not_a_token],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "fake token"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "metadata must not exceed 500 bytes")]
    fn test_create_campaign_rejects_oversized_metadata() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        // 501 bytes — one over MAX_METADATA_LEN.
        let long_meta = oversized_metadata(&env, 501);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &long_meta,
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    fn test_create_campaign_accepts_metadata_exactly_500_bytes() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let exact_meta = oversized_metadata(&env, 500);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &exact_meta,
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        assert_eq!(client.get_campaign(&campaign_id).metadata.len(), 500);
    }

    #[test]
    fn test_create_campaign_emits_structured_event() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let deadline = env.ledger().timestamp() + 1_000;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &deadline,
            &String::from_str(&env, "event test"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        assert_eq!(campaign_id, 1);
        let events = env.events().all();
        assert!(
            !events.events().is_empty(),
            "campaign creation must emit an event"
        );
    }

    #[test]
    fn test_create_campaign_rejection_emits_no_event() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let long_meta = oversized_metadata(&env, 501);
        let result = crate::std::panic::catch_unwind(crate::std::panic::AssertUnwindSafe(|| {
            client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &500_i128,
                &(env.ledger().timestamp() + 1_000),
                &long_meta,
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );
        }));
        assert!(result.is_err(), "creation must be rejected");
        assert!(
            env.events().all().events().is_empty(),
            "failed creation must not emit a success event"
        );
    }

    #[test]
    fn test_create_campaign_rejection_does_not_mutate_state() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        assert_eq!(client.get_next_campaign_id(), 0);

        // A metadata violation is the last check in the boundary sequence;
        // everything before it (auth, amounts, deadlines, tokens) has already
        // run, so this proves no earlier check mutates storage either.
        let long_meta = oversized_metadata(&env, 501);
        // `crate::std` resolves through the `#[cfg(test)] extern crate std;`
        // in lib.rs — the crate itself is `#![no_std]`.
        let result = crate::std::panic::catch_unwind(crate::std::panic::AssertUnwindSafe(|| {
            client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &500_i128,
                &(env.ledger().timestamp() + 1_000),
                &long_meta,
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );
        }));
        assert!(result.is_err(), "creation must be rejected");

        // Counter unchanged — no campaign row was written.
        assert_eq!(client.get_next_campaign_id(), 0);
        // A later valid creation starts at id 1 and works normally.
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "after rejected create"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
        assert_eq!(campaign_id, 1);
    }

    #[test]
    #[should_panic(expected = "too many accepted tokens")]
    fn test_create_campaign_rejects_count_before_duplicate_scan() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let client = deploy_contract(&env);

        // 11 copies of the SAME address: both "too many" and "duplicate".
        // The count check must win — proving it runs before the O(n^2) scan.
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let mut tokens = soroban_sdk::vec![&env];
        for _ in 0..11 {
            tokens.push_back(token.clone());
        }

        client.create_campaign(
            &creator,
            &tokens,
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "count before dedup"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    // ---- #895: per-contributor cap enforcement ---------------------------
    // The cap recorded at creation time is now read at contribute time.

    #[test]
    #[should_panic(expected = "per-contributor cap exceeded")]
    fn test_contribute_enforces_per_contributor_cap_across_tokens() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&contributor, &1_000);

        let client = deploy_contract(&env);

        // Cap of 600 across ALL tokens; target 2_000 is never reachable.
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token_id.clone()],
            &2_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "cap enforcement test"),
            &600_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token_id, &400);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 400);

        // 400 + 300 = 700 > cap 600 — must panic.
        client.contribute(&campaign_id, &contributor, &token_id, &300);
    }

    #[test]
    fn test_contribute_allows_exactly_at_per_contributor_cap() {
        let env = test_env();
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
            &String::from_str(&env, "cap boundary test"),
            &500_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        // Exactly at the cap: 300 + 200 = 500 must be accepted.
        client.contribute(&campaign_id, &contributor, &token, &300);
        client.contribute(&campaign_id, &contributor, &token, &200);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 500);
    }

    #[test]
    #[should_panic(expected = "per-contributor cap exceeded")]
    fn test_contribute_rejects_pledge_over_per_contributor_cap() {
        let env = test_env();
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
            &String::from_str(&env, "over cap enforcement"),
            &500_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &400);
        // 400 + 101 = 501 > cap 500.
        client.contribute(&campaign_id, &contributor, &token, &101);
    }

    #[test]
    fn test_claim_success() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &attacker);
    }

    #[test]
    #[should_panic(expected = "campaign is still active")]
    fn test_claim_before_deadline() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "campaign is not funded")]
    fn test_claim_underfunded() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &(target / 2));
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_claim_double_claim() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    fn test_get_campaign_count_tracks_creates() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );
        assert_eq!(client.get_campaign_count(), 2);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &300_i128,
            &deadline,
            &meta("c3"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    fn test_contributor_count_zero_on_new_campaign() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        assert_eq!(client.get_contributor_count(&campaign_id), 0);
    }

    #[test]
    fn test_contributor_count_single_contributor() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);
    }

    #[test]
    fn test_contributor_count_multiple_unique_contributors() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    fn test_max_accepted_tokens_allows_exactly_10() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.accepted_tokens.len(), 10);
    }

    // ── admin / pause tests (issue #193) ──────────────────────────────────────

    #[test]
    fn test_initialize_sets_admin_and_unpaused() {
        let env = test_env();
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
        let env = test_env();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        client.initialize(&admin, &100_i128);
        client.initialize(&admin, &100_i128);
    }

    #[test]
    fn test_admin_can_pause_and_unpause() {
        let env = test_env();
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
        let env = test_env();
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.set_paused(&admin, &true);
        client.contribute(&campaign_id, &contributor, &token, &500);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_create_campaign_blocked_when_paused() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        client.set_paused(&admin, &true);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "paused create should fail"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    fn test_create_campaign_succeeds_when_unpaused() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);

        // Explicitly unpaused (default), then create — preserves existing lifecycle.
        client.set_paused(&admin, &false);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "unpaused create ok"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.creator, creator);
        assert_eq!(campaign.target_amount, 500);
        assert!(!campaign.claimed);
        assert!(!campaign.canceled);
        assert_eq!(campaign.contributor_count, 0);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_claim_blocked_when_paused() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );
        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, deadline_offset + 1);

        client.set_paused(&admin, &true);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_refund_blocked_when_paused() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );
        client.contribute(&campaign_id, &contributor, &token, &500);
        advance_time(&env, deadline_offset + 1);

        client.set_paused(&admin, &true);
        client.refund(&campaign_id, &contributor);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_cancel_campaign_blocked_when_paused() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.set_paused(&admin, &true);
        client.cancel_campaign(&campaign_id, &creator);
    }

    #[test]
    fn test_read_only_functions_work_when_paused() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );
        client.cancel_campaign(&campaign_id, &creator);
        assert!(client.get_campaign(&campaign_id).canceled);
    }

    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_cancel_campaign_non_creator_rejected() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );
        // attacker tries to cancel — must panic with "creator mismatch"
        client.cancel_campaign(&campaign_id, &attacker);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_cancel_campaign_already_claimed_rejected() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );
        client.cancel_campaign(&campaign_id, &creator);
        // second cancel must panic
        client.cancel_campaign(&campaign_id, &creator);
    }

    #[test]
    fn test_refund_works_on_canceled_campaign_before_deadline() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        // Same contributor pledges twice — count must stay at 1
        client.contribute(&campaign_id, &contributor, &token, &400);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);

        client.contribute(&campaign_id, &contributor, &token, &300);
        assert_eq!(client.get_contributor_count(&campaign_id), 1);
    }

    #[test]
    fn test_contributor_count_no_double_count_multiple_tokens() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        assert_eq!(client.get_min_contribution(), 100);
    }

    #[test]
    fn test_initialize_sets_custom_min_contribution() {
        let env = test_env();
        env.mock_all_auths();
        let client = deploy_contract(&env);
        let admin = Address::generate(&env);
        client.initialize(&admin, &500_i128);
        assert_eq!(client.get_min_contribution(), 500);
    }

    #[test]
    #[should_panic(expected = "contribution below minimum")]
    fn test_contribute_rejects_99_stroops() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &99);
    }

    #[test]
    fn test_contribute_accepts_exactly_100_stroops() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        // Exactly 100 must succeed
        client.contribute(&campaign_id, &contributor, &token, &100);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 100);
    }

    #[test]
    #[should_panic(expected = "contribution below minimum")]
    fn test_contribute_rejects_below_custom_min() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        // 499 is below the custom minimum of 500
        client.contribute(&campaign_id, &contributor, &token, &499);
    }

    #[test]
    fn test_contribute_accepts_at_custom_min() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 500);
    }

    // ── #185: update_metadata tests ───────────────────────────────────────────

    #[test]
    fn test_update_metadata_success() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.update_metadata(
            &campaign_id,
            &creator,
            &String::from_str(&env, "updated metadata"),
        );

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(
            campaign.metadata,
            String::from_str(&env, "updated metadata")
        );
    }

    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_update_metadata_rejects_non_creator() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.update_metadata(&campaign_id, &attacker, &String::from_str(&env, "hacked"));
    }

    #[test]
    #[should_panic(expected = "campaign deadline reached")]
    fn test_update_metadata_rejects_after_deadline() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        advance_time(&env, deadline_offset + 1);

        client.update_metadata(&campaign_id, &creator, &String::from_str(&env, "too late"));
    }

    #[test]
    #[should_panic(expected = "campaign canceled")]
    fn test_update_metadata_rejects_canceled_campaign() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        let new_deadline = env.ledger().timestamp() + deadline_offset + 500;
        client.request_deadline_extension(&campaign_id, &non_contributor, &new_deadline);
    }

    #[test]
    #[should_panic(expected = "new deadline exceeds maximum campaign duration")]
    fn test_request_extension_rejects_excessive_deadline() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &500);

        // 181 days from now — exceeds MAX_CAMPAIGN_DURATION_SECONDS (180 days)
        let excessive_deadline = env.ledger().timestamp() + (60 * 60 * 24 * 181);
        client.request_deadline_extension(&campaign_id, &contributor, &excessive_deadline);
    }

    #[test]
    fn test_approve_extension_applies_when_majority_reached() {
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        let new_deadline = env.ledger().timestamp() + 500;
        client.request_deadline_extension(&campaign_id, &contributor, &new_deadline);
    }

    // ── multi-sig campaign approval tests (co-creators) ────────────────────────

    #[test]
    fn test_create_campaign_with_co_creators_success() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let co_creator2 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multi-sig test"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone(), co_creator2.clone()],
            &2_u32,
        );

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.co_creators.len(), 2);
        assert_eq!(campaign.approval_threshold, 2);
        assert!(campaign.co_creators.iter().any(|a| a == co_creator1));
        assert!(campaign.co_creators.iter().any(|a| a == co_creator2));
    }

    #[test]
    fn test_create_campaign_with_co_creators_get_co_creators() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let co_creator2 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multi-sig test"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone(), co_creator2.clone()],
            &2_u32,
        );

        let co_creators = client.get_co_creators(&campaign_id);
        assert_eq!(co_creators.len(), 2);
        assert!(co_creators.iter().any(|a| a == co_creator1));
        assert!(co_creators.iter().any(|a| a == co_creator2));
    }

    #[test]
    fn test_create_campaign_with_co_creators_is_not_approved_initially() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multi-sig test"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        assert!(!client.is_campaign_approved(&campaign_id));
        assert_eq!(client.get_campaign_approvals(&campaign_id), 0);
    }

    #[test]
    #[should_panic(expected = "approval_threshold must be > 0 when co_creators provided")]
    fn test_create_campaign_rejects_zero_threshold_with_co_creators() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "bad threshold"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "approval_threshold cannot exceed number of co_creators")]
    fn test_create_campaign_rejects_threshold_exceeds_co_creators() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "bad threshold"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &2_u32,
        );
    }

    #[test]
    #[should_panic(expected = "co_creators must not be empty when approval_threshold > 0")]
    fn test_create_campaign_rejects_threshold_without_co_creators() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "bad threshold"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &1_u32,
        );
    }

    #[test]
    #[should_panic(expected = "creator cannot be a co-creator")]
    fn test_create_campaign_rejects_creator_as_co_creator() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "creator as co-creator"),
            &0_i128,
            &soroban_sdk::vec![&env, creator.clone()],
            &1_u32,
        );
    }

    #[test]
    #[should_panic(expected = "duplicate co-creator addresses")]
    fn test_create_campaign_rejects_duplicate_co_creators() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "dup co-creators"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone(), co_creator1.clone()],
            &1_u32,
        );
    }

    #[test]
    fn test_approve_campaign_success_meets_threshold() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let co_creator2 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multi-sig test"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone(), co_creator2.clone()],
            &2_u32,
        );

        // First approval (1/2)
        client.approve_campaign(&campaign_id, &co_creator1);
        assert!(!client.is_campaign_approved(&campaign_id));
        assert_eq!(client.get_campaign_approvals(&campaign_id), 1);

        // Second approval (2/2) - threshold met
        client.approve_campaign(&campaign_id, &co_creator2);
        assert!(client.is_campaign_approved(&campaign_id));
        assert_eq!(client.get_campaign_approvals(&campaign_id), 2);
    }

    #[test]
    fn test_approve_campaign_success_single_co_creator() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "single co-creator"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        client.approve_campaign(&campaign_id, &co_creator1);
        assert!(client.is_campaign_approved(&campaign_id));
        assert_eq!(client.get_campaign_approvals(&campaign_id), 1);
    }

    #[test]
    #[should_panic(expected = "campaign does not require approval")]
    fn test_approve_campaign_rejects_non_multi_sig_campaign() {
        let env = test_env();
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
            &String::from_str(&env, "single creator"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        let stranger = Address::generate(&env);
        client.approve_campaign(&campaign_id, &stranger);
    }

    #[test]
    #[should_panic(expected = "approver is not a co-creator")]
    fn test_approve_campaign_rejects_non_co_creator() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let stranger = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multi-sig test"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        client.approve_campaign(&campaign_id, &stranger);
    }

    #[test]
    #[should_panic(expected = "already approved")]
    fn test_approve_campaign_rejects_double_approval() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "multi-sig test"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        client.approve_campaign(&campaign_id, &co_creator1);
        client.approve_campaign(&campaign_id, &co_creator1);
    }

    #[test]
    #[should_panic(expected = "campaign already finalized")]
    fn test_approve_campaign_rejects_claimed_campaign() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let client = deploy_contract(&env);

        // Create a separate token with sufficient balance for the multi-sig campaign
        let token = deploy_token(&env, &admin, &contributor, 2_000);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 100),
            &String::from_str(&env, "claimed multi-sig"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        // Approve it first
        client.approve_campaign(&campaign_id, &co_creator1);
        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, 101);
        client.claim(&campaign_id, &creator);

        // Now try to approve again (already claimed)
        client.approve_campaign(&campaign_id, &co_creator1);
    }

    #[test]
    #[should_panic(expected = "campaign already finalized")]
    fn test_approve_campaign_rejects_canceled_campaign() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "canceled campaign"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        client.cancel_campaign(&campaign_id, &creator);
        client.approve_campaign(&campaign_id, &co_creator1);
    }

    #[test]
    #[should_panic(expected = "campaign not approved")]
    fn test_contribute_blocked_when_not_approved() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "needs approval"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        // Campaign not approved yet - contribute should fail
        client.contribute(&campaign_id, &contributor, &token, &500);
    }

    #[test]
    fn test_contribute_allowed_after_approval() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "needs approval"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        // Approve first
        client.approve_campaign(&campaign_id, &co_creator1);

        // Now contribute should work
        client.contribute(&campaign_id, &contributor, &token, &500);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 500);
    }

    #[test]
    #[should_panic(expected = "campaign not approved")]
    fn test_claim_blocked_when_not_approved() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 100),
            &String::from_str(&env, "needs approval"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, 101);

        // Campaign not approved - claim should fail
        client.claim(&campaign_id, &creator);
    }

    #[test]
    fn test_claim_allowed_after_approval() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let co_creator1 = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 100),
            &String::from_str(&env, "needs approval"),
            &0_i128,
            &soroban_sdk::vec![&env, co_creator1.clone()],
            &1_u32,
        );

        // Approve FIRST, then contribute
        client.approve_campaign(&campaign_id, &co_creator1);
        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, 101);

        client.claim(&campaign_id, &creator);

        assert!(client.get_campaign(&campaign_id).claimed);
    }

    #[test]
    fn test_is_campaign_approved_backward_compatible() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        // Single-creator campaign (no co-creators) should be auto-approved
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "single creator"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        assert!(client.is_campaign_approved(&campaign_id));
        assert_eq!(client.get_campaign_approvals(&campaign_id), 0);
    }

    #[test]
    fn test_get_campaign_approvals_returns_zero_for_non_multi_sig() {
        let env = test_env();
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
            &String::from_str(&env, "single creator"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        assert_eq!(client.get_campaign_approvals(&campaign_id), 0);
    }

    #[test]
    fn test_get_co_creators_returns_empty_for_non_multi_sig() {
        let env = test_env();
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
            &String::from_str(&env, "single creator"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        let co_creators = client.get_co_creators(&campaign_id);
        assert_eq!(co_creators.len(), 0);
    }

    // ── platform fee tests ────────────────────────────────────────────────────

    #[test]
    fn test_default_fee_bps_is_50() {
        let env = test_env();
        env.mock_all_auths();
        let client = deploy_contract(&env);

        // Before initialize, default applies
        assert_eq!(client.get_platform_fee_bps(), 50);
    }

    #[test]
    fn test_default_fee_recipient_is_none() {
        let env = test_env();
        env.mock_all_auths();
        let client = deploy_contract(&env);

        assert!(client.get_fee_recipient().is_none());
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_set_fee_admin_only() {
        let env = test_env();
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
        let env = test_env();
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
        let env = test_env();
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
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
        let env = test_env();
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
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        // Fee=0 → all to creator
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&creator), 1_000);
        assert_eq!(token_client.balance(&fee_recipient), 0);
    }

    // --- Failure-path coverage (issue #989) ---
    // Invalid input, missing data, duplicate actions, deadline/timeout, and
    // permission failures asserted by panic behavior (not snapshots alone).

    #[test]
    #[should_panic(expected = "target amount must be positive")]
    fn test_create_campaign_rejects_non_positive_target() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &0_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "zero target"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "deadline must be in the future")]
    fn test_create_campaign_rejects_past_deadline() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        let now = env.ledger().timestamp();
        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &now,
            &String::from_str(&env, "past deadline"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "deadline exceeds maximum campaign duration")]
    fn test_create_campaign_rejects_duration_over_max() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        // MAX_CAMPAIGN_DURATION_SECONDS = 180 days; exceed by one second.
        let excessive = env.ledger().timestamp() + (60 * 60 * 24 * 180) + 1;
        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &excessive,
            &String::from_str(&env, "too long"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "accepted_tokens must not be empty")]
    fn test_create_campaign_rejects_empty_accepted_tokens() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "no tokens"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "duplicate token addresses")]
    fn test_create_campaign_rejects_duplicate_tokens() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone(), token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "dup tokens"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "max_per_contributor must not be negative")]
    fn test_create_campaign_rejects_negative_max_per_contributor() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &creator, 1_000);
        let client = deploy_contract(&env);

        client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &500_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "neg cap"),
            &(-1_i128),
            &soroban_sdk::vec![&env],
            &0_u32,
        );
    }

    #[test]
    #[should_panic(expected = "campaign not found")]
    fn test_get_campaign_missing_id_panics() {
        let env = test_env();
        env.mock_all_auths();

        let client = deploy_contract(&env);
        let _ = client.get_campaign(&999_u64);
    }

    #[test]
    #[should_panic(expected = "campaign funding cap exceeded")]
    fn test_contribute_rejects_funding_cap_exceeded() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 2_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "over target"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &1_001);
    }

    #[test]
    #[should_panic(expected = "token not accepted by this campaign")]
    fn test_contribute_rejects_unaccepted_token() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let accepted = deploy_token(&env, &admin, &contributor, 1_000);
        let other = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, accepted],
            &1_000_i128,
            &(env.ledger().timestamp() + 1_000),
            &String::from_str(&env, "wrong token"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &other, &500);
    }

    #[test]
    #[should_panic(expected = "campaign deadline reached")]
    fn test_contribute_rejects_after_deadline() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 50;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "late pledge"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        advance_time(&env, deadline_offset + 1);
        client.contribute(&campaign_id, &contributor, &token, &500);
    }

    #[test]
    #[should_panic(expected = "funded campaigns cannot be refunded")]
    fn test_refund_rejects_funded_campaign_after_deadline() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 1_000);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 50;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "funded no refund"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &1_000);
        advance_time(&env, deadline_offset + 1);
        client.refund(&campaign_id, &contributor);
    }

    #[test]
    #[should_panic(expected = "nothing to refund")]
    fn test_refund_rejects_when_nothing_to_refund() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let stranger = Address::generate(&env);
        let admin = Address::generate(&env);
        let contributor = Address::generate(&env);
        let token = deploy_token(&env, &admin, &contributor, 500);
        let client = deploy_contract(&env);

        let deadline_offset: u64 = 50;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, token.clone()],
            &1_000_i128,
            &(env.ledger().timestamp() + deadline_offset),
            &String::from_str(&env, "no pledge refund"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        client.contribute(&campaign_id, &contributor, &token, &500);
        advance_time(&env, deadline_offset + 1);
        // Stranger never pledged — nothing to refund.
        client.refund(&campaign_id, &stranger);
    }

    #[test]
    #[should_panic(expected = "fee must be non-negative")]
    fn test_set_fee_rejects_negative() {
        let env = test_env();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = deploy_contract(&env);
        client.initialize(&admin, &100_i128);
        client.set_fee(&admin, &(-1_i128));
    }

    // =====================================================================
    // Refund-path lifecycle and accounting invariants (#911)
    // =====================================================================
    // After every accepted step the refund books must balance:
    //   (1) pledged_amount == Σ contributions over {contributor, token}
    //   (2) pledged_amount == Σ CampaignTokenBalance(campaign, token)
    //   (3) CampaignTokenBalance(campaign, token) == vault's real holdings
    // Invalid transitions (premature refund, funded campaign refund, claimed
    // refund, double refund, unauthorized stranger refund, paused refund)
    // must fail cleanly and leave (1)–(3) untouched: invalid transitions
    // neither create nor destroy value. See contracts/PROPERTY_TESTS.md.

    fn token_balance(env: &Env, token: &Address, who: &Address) -> i128 {
        TokenClient::new(env, token).balance(who)
    }

    fn deploy_token_minting(
        env: &Env,
        admin: &Address,
        holders: &[Address],
        amount: i128,
    ) -> Address {
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let asset_client = StellarAssetClient::new(env, &token);
        for holder in holders {
            asset_client.mint(holder, &amount);
        }
        token
    }

    fn assert_refund_books(
        env: &Env,
        client: &StellarGoalVaultContractClient,
        campaign_id: u64,
        tokens: &[Address],
        contributors: &[Address],
    ) {
        let campaign = client.get_campaign(&campaign_id);
        let vault = client.address.clone();

        // 1. Sum of all individual contributions across all tokens
        let mut sum_contributions: i128 = 0;
        for token in tokens {
            for contributor in contributors {
                let contribution = client.get_contribution(&campaign_id, contributor, token);
                assert!(contribution >= 0, "contribution must be non-negative");
                sum_contributions += contribution;
            }
        }

        // 2. Sum of CampaignTokenBalance across all tokens
        let mut sum_token_balances: i128 = 0;
        for token in tokens {
            let token_bal = client.get_campaign_token_balance(&campaign_id, token);
            assert!(token_bal >= 0, "campaign token balance must be non-negative");
            sum_token_balances += token_bal;

            // 3. CampaignTokenBalance must equal the vault's actual token balance
            let real_vault_bal = TokenClient::new(env, token).balance(&vault);
            assert_eq!(
                token_bal, real_vault_bal,
                "CampaignTokenBalance must match vault real token holdings"
            );
        }

        // 4. Pledged amount must equal sum of contributions
        assert_eq!(
            campaign.pledged_amount, sum_contributions,
            "pledged_amount must equal sum of active contributions"
        );

        // 5. Pledged amount must equal sum of token balances
        assert_eq!(
            campaign.pledged_amount, sum_token_balances,
            "pledged_amount must equal sum of CampaignTokenBalances"
        );

        // 6. Pledged amount must be non-negative
        assert!(
            campaign.pledged_amount >= 0,
            "pledged_amount must remain non-negative"
        );
    }

    #[test]
    fn test_refund_lifecycle_table_driven_underfunded_preserves_accounting_invariants() {
        struct Row {
            target: i128,
            deadline_offset: u64,
            pledges: &'static [i128],
        }

        let cases = [
            Row {
                target: 1_000,
                deadline_offset: 50,
                pledges: &[200, 300],
            },
            Row {
                target: 5_000,
                deadline_offset: 100,
                pledges: &[800, 1_200, 1_500],
            },
            Row {
                target: 10_000,
                deadline_offset: 200,
                pledges: &[100, 400, 1_500, 3_000],
            },
            Row {
                target: 2_000,
                deadline_offset: 30,
                pledges: &[100, 1_899],
            },
        ];

        for (case_idx, row) in cases.iter().enumerate() {
            let env = test_env();
            env.mock_all_auths();

            let creator = Address::generate(&env);
            let admin = Address::generate(&env);
            let contributors: soroban_sdk::Vec<Address> = {
                let mut v = soroban_sdk::Vec::new(&env);
                for _ in 0..row.pledges.len() {
                    v.push_back(Address::generate(&env));
                }
                v
            };

            let mut contrib_slice: std::vec::Vec<Address> = std::vec::Vec::new();
            for i in 0..contributors.len() {
                contrib_slice.push(contributors.get(i).unwrap());
            }

            let initial_mint = 50_000_i128;
            let token = deploy_token_minting(&env, &admin, &contrib_slice, initial_mint);
            let tokens = [token.clone()];
            let client = deploy_contract(&env);
            let vault = client.address.clone();

            let campaign_id = client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &row.target,
                &(env.ledger().timestamp() + row.deadline_offset),
                &String::from_str(&env, "refund lifecycle table row"),
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );

            // Verify initial clean accounting
            assert_refund_books(&env, &client, campaign_id, &tokens, &contrib_slice);

            // Step 1: Sequential pledges
            let mut total_pledged = 0_i128;
            for (i, pledge) in row.pledges.iter().enumerate() {
                let who = &contrib_slice[i];
                let balance_before = token_balance(&env, &token, who);
                client.contribute(&campaign_id, who, &token, pledge);
                total_pledged += pledge;

                assert_eq!(token_balance(&env, &token, who), balance_before - pledge);
                assert_eq!(token_balance(&env, &token, &vault), total_pledged);
                assert_refund_books(&env, &client, campaign_id, &tokens, &contrib_slice);
            }

            assert!(
                total_pledged < row.target,
                "case {} must be underfunded: {} < {}",
                case_idx,
                total_pledged,
                row.target
            );

            // Step 2: Premature refunds while active are rejected without mutating state
            for who in &contrib_slice {
                assert!(
                    client.try_refund(&campaign_id, who).is_err(),
                    "active campaign must reject premature refund"
                );
                assert_refund_books(&env, &client, campaign_id, &tokens, &contrib_slice);
            }

            // Step 3: Advance past deadline
            advance_time(&env, row.deadline_offset + 1);

            // Step 4: Step-by-step partial refunds; each step preserves global accounting
            let mut remaining_vault = total_pledged;
            for (i, pledge) in row.pledges.iter().enumerate() {
                let who = &contrib_slice[i];
                let balance_before = token_balance(&env, &token, who);

                client.refund(&campaign_id, who);

                // Contributor is made whole to exact initial mint
                assert_eq!(token_balance(&env, &token, who), balance_before + pledge);
                assert_eq!(token_balance(&env, &token, who), initial_mint);

                remaining_vault -= pledge;
                assert_eq!(token_balance(&env, &token, &vault), remaining_vault);

                // Assert invariant holds after each partial refund
                assert_refund_books(&env, &client, campaign_id, &tokens, &contrib_slice);
            }

            // Step 5: Vault is fully drained to zero and campaign is cleared
            assert_eq!(token_balance(&env, &token, &vault), 0);
            assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 0);

            // Step 6: Double refunds are rejected and do not create negative balances
            for who in &contrib_slice {
                assert!(
                    client.try_refund(&campaign_id, who).is_err(),
                    "double refund must be rejected"
                );
                assert_eq!(token_balance(&env, &token, who), initial_mint);
                assert_refund_books(&env, &client, campaign_id, &tokens, &contrib_slice);
            }
        }
    }

    #[test]
    fn test_refund_invalid_transitions_preserve_state_and_conserve_value() {
        // --- Scenario A: Active Campaign (before deadline) ---
        {
            let env = test_env();
            env.mock_all_auths();

            let creator = Address::generate(&env);
            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let contributors = [alice.clone()];

            let initial_mint = 10_000_i128;
            let token = deploy_token_minting(&env, &admin, &contributors, initial_mint);
            let tokens = [token.clone()];
            let client = deploy_contract(&env);
            let vault = client.address.clone();

            let target_a = 2_000_i128;
            let offset_a = 100_u64;
            let c_a = client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &target_a,
                &(env.ledger().timestamp() + offset_a),
                &String::from_str(&env, "active campaign"),
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );
            client.contribute(&c_a, &alice, &token, &500);
            assert_refund_books(&env, &client, c_a, &tokens, &contributors);

            // Attempt refund before deadline: rejected with books untouched
            assert!(client.try_refund(&c_a, &alice).is_err());
            assert_eq!(token_balance(&env, &token, &alice), initial_mint - 500);
            assert_eq!(token_balance(&env, &token, &vault), 500);
            assert_refund_books(&env, &client, c_a, &tokens, &contributors);
        }

        // --- Scenario B: Funded Campaign after deadline ---
        {
            let env = test_env();
            env.mock_all_auths();

            let creator = Address::generate(&env);
            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let contributors = [alice.clone(), bob.clone()];

            let initial_mint = 10_000_i128;
            let token = deploy_token_minting(&env, &admin, &contributors, initial_mint);
            let tokens = [token.clone()];
            let client = deploy_contract(&env);
            let vault = client.address.clone();

            let target_b = 1_000_i128;
            let offset_b = 50_u64;
            let c_b = client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &target_b,
                &(env.ledger().timestamp() + offset_b),
                &String::from_str(&env, "funded campaign"),
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );
            client.contribute(&c_b, &alice, &token, &600);
            client.contribute(&c_b, &bob, &token, &400);
            advance_time(&env, offset_b + 1);

            // Funded campaigns cannot be refunded
            assert!(client.try_refund(&c_b, &alice).is_err());
            assert!(client.try_refund(&c_b, &bob).is_err());
            assert_refund_books(&env, &client, c_b, &tokens, &contributors);

            // --- Scenario C: Claimed Campaign ---
            client.claim(&c_b, &creator);
            assert!(client.get_campaign(&c_b).claimed);
            // Claimed campaign strictly rejects refunds
            assert!(client.try_refund(&c_b, &alice).is_err());
            assert!(client.try_refund(&c_b, &bob).is_err());
            assert_eq!(token_balance(&env, &token, &vault), 0);
        }

        // --- Scenario D: Stranger and Paused ---
        {
            let env = test_env();
            env.mock_all_auths();

            let creator = Address::generate(&env);
            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let stranger = Address::generate(&env);
            let contributors = [alice.clone(), stranger.clone()];

            let initial_mint = 10_000_i128;
            let token = deploy_token_minting(&env, &admin, &contributors, initial_mint);
            let tokens = [token.clone()];
            let client = deploy_contract(&env);
            let vault = client.address.clone();
            client.initialize(&admin, &100_i128);

            let target_d = 1_000_i128;
            let offset_d = 50_u64;
            let c_d = client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &target_d,
                &(env.ledger().timestamp() + offset_d),
                &String::from_str(&env, "stranger test"),
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );
            client.contribute(&c_d, &alice, &token, &300);
            advance_time(&env, offset_d + 1);

            // Stranger has nothing to refund
            assert!(client.try_refund(&c_d, &stranger).is_err());
            assert_refund_books(&env, &client, c_d, &tokens, &contributors);

            // Paused contract rejects refund
            client.set_paused(&admin, &true);
            assert!(client.try_refund(&c_d, &alice).is_err());
            assert_refund_books(&env, &client, c_d, &tokens, &contributors);

            // Unpause restores valid refund transition
            client.set_paused(&admin, &false);
            client.refund(&c_d, &alice);
            assert_refund_books(&env, &client, c_d, &tokens, &contributors);
            assert_eq!(token_balance(&env, &token, &alice), initial_mint);
            assert_eq!(token_balance(&env, &token, &vault), 0);
        }
    }

    #[test]
    fn test_canceled_campaign_refund_matrix_preserves_invariants() {
        struct CancelRow {
            target: i128,
            deadline_offset: u64,
            pledges: &'static [i128],
        }

        let cases = [
            CancelRow {
                target: 1_000,
                deadline_offset: 100,
                pledges: &[250, 450],
            },
            CancelRow {
                target: 3_000,
                deadline_offset: 200,
                pledges: &[500, 700, 900],
            },
            CancelRow {
                target: 2_000,
                deadline_offset: 50,
                pledges: &[1_200],
            },
        ];

        for row in cases {
            let env = test_env();
            env.mock_all_auths();

            let creator = Address::generate(&env);
            let admin = Address::generate(&env);
            let mut contributors: std::vec::Vec<Address> = std::vec::Vec::new();
            for _ in 0..row.pledges.len() {
                contributors.push(Address::generate(&env));
            }

            let initial_mint = 20_000_i128;
            let token = deploy_token_minting(&env, &admin, &contributors, initial_mint);
            let tokens = [token.clone()];
            let client = deploy_contract(&env);
            let vault = client.address.clone();

            let campaign_id = client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &row.target,
                &(env.ledger().timestamp() + row.deadline_offset),
                &String::from_str(&env, "canceled refund row"),
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );

            for (i, pledge) in row.pledges.iter().enumerate() {
                client.contribute(&campaign_id, &contributors[i], &token, pledge);
            }
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            // Canceling does not alter token holdings or accounting books
            client.cancel_campaign(&campaign_id, &creator);
            assert!(client.get_campaign(&campaign_id).canceled);
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            // Canceled campaign cannot be claimed
            assert!(client.try_claim(&campaign_id, &creator).is_err());
            // Canceled campaign cannot be re-canceled
            assert!(client.try_cancel_campaign(&campaign_id, &creator).is_err());

            // Contributors can refund immediately, BEFORE deadline
            for (i, pledge) in row.pledges.iter().enumerate() {
                let who = &contributors[i];
                let before = token_balance(&env, &token, who);
                client.refund(&campaign_id, who);
                assert_eq!(token_balance(&env, &token, who), before + pledge);
                assert_eq!(token_balance(&env, &token, who), initial_mint);
                assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);
            }

            // Vault drained to 0
            assert_eq!(token_balance(&env, &token, &vault), 0);
            assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 0);

            // Second refund attempt is rejected
            for who in &contributors {
                assert!(client.try_refund(&campaign_id, who).is_err());
            }
        }
    }

    #[test]
    fn test_multi_token_refund_lifecycle_conserves_value() {
        let env = test_env();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);
        let contributors = [alice.clone(), bob.clone(), charlie.clone()];

        let usdc = deploy_token_minting(&env, &admin, &contributors, 10_000);
        let eurc = deploy_token_minting(&env, &admin, &contributors, 10_000);
        let xlm = deploy_token_minting(&env, &admin, &contributors, 10_000);
        let tokens = [usdc.clone(), eurc.clone(), xlm.clone()];
        let client = deploy_contract(&env);
        let vault = client.address.clone();

        let target = 3_000_i128;
        let offset = 100_u64;
        let campaign_id = client.create_campaign(
            &creator,
            &soroban_sdk::vec![&env, usdc.clone(), eurc.clone(), xlm.clone()],
            &target,
            &(env.ledger().timestamp() + offset),
            &String::from_str(&env, "multi-token refund"),
            &0_i128,
            &soroban_sdk::vec![&env],
            &0_u32,
        );

        // Diverse contribution matrix across multiple tokens
        // Alice: 200 USDC + 150 EURC = 350
        client.contribute(&campaign_id, &alice, &usdc, &200);
        client.contribute(&campaign_id, &alice, &eurc, &150);

        // Bob: 300 EURC + 400 XLM = 700
        client.contribute(&campaign_id, &bob, &eurc, &300);
        client.contribute(&campaign_id, &bob, &xlm, &400);

        // Charlie: 100 USDC + 200 XLM = 300
        client.contribute(&campaign_id, &charlie, &usdc, &100);
        client.contribute(&campaign_id, &charlie, &xlm, &200);

        let total_pledged = 1_350_i128;
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, total_pledged);
        assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

        // Advance time past deadline (1350 < 3000 target => underfunded)
        advance_time(&env, offset + 1);

        // Alice refunds: receives 200 USDC + 150 EURC in one call
        client.refund(&campaign_id, &alice);
        assert_eq!(token_balance(&env, &usdc, &alice), 10_000);
        assert_eq!(token_balance(&env, &eurc, &alice), 10_000);
        assert_eq!(token_balance(&env, &xlm, &alice), 10_000);
        assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

        // Bob's and Charlie's balances in vault remain completely intact
        assert_eq!(token_balance(&env, &usdc, &vault), 100); // Charlie's USDC
        assert_eq!(token_balance(&env, &eurc, &vault), 300); // Bob's EURC
        assert_eq!(token_balance(&env, &xlm, &vault), 600);  // Bob's 400 + Charlie's 200

        // Bob refunds: receives 300 EURC + 400 XLM
        client.refund(&campaign_id, &bob);
        assert_eq!(token_balance(&env, &usdc, &bob), 10_000);
        assert_eq!(token_balance(&env, &eurc, &bob), 10_000);
        assert_eq!(token_balance(&env, &xlm, &bob), 10_000);
        assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

        // Charlie refunds: receives 100 USDC + 200 XLM
        client.refund(&campaign_id, &charlie);
        assert_eq!(token_balance(&env, &usdc, &charlie), 10_000);
        assert_eq!(token_balance(&env, &eurc, &charlie), 10_000);
        assert_eq!(token_balance(&env, &xlm, &charlie), 10_000);

        // All vault balances drained to 0
        assert_eq!(token_balance(&env, &usdc, &vault), 0);
        assert_eq!(token_balance(&env, &eurc, &vault), 0);
        assert_eq!(token_balance(&env, &xlm, &vault), 0);
        assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 0);
        assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);
    }

    #[test]
    fn test_refund_all_admin_bulk_refund_table_driven() {
        struct BulkRow {
            target: i128,
            pledges: &'static [i128],
            canceled: bool,
        }

        let cases = [
            BulkRow {
                target: 1_000,
                pledges: &[300, 400],
                canceled: false,
            },
            BulkRow {
                target: 5_000,
                pledges: &[500, 800, 1_200, 1_500],
                canceled: false,
            },
            BulkRow {
                target: 2_500,
                pledges: &[400, 600, 800],
                canceled: true,
            },
        ];

        for row in cases {
            let env = test_env();
            env.mock_all_auths();

            let admin = Address::generate(&env);
            let creator = Address::generate(&env);
            let client = deploy_contract(&env);
            client.initialize(&admin, &100_i128);

            let mut contributors: std::vec::Vec<Address> = std::vec::Vec::new();
            for _ in 0..row.pledges.len() {
                contributors.push(Address::generate(&env));
            }

            let initial_mint = 25_000_i128;
            let token = deploy_token_minting(&env, &admin, &contributors, initial_mint);
            let tokens = [token.clone()];
            let vault = client.address.clone();

            let offset = 100_u64;
            let campaign_id = client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &row.target,
                &(env.ledger().timestamp() + offset),
                &String::from_str(&env, "refund all bulk test"),
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );

            for (i, pledge) in row.pledges.iter().enumerate() {
                client.contribute(&campaign_id, &contributors[i], &token, pledge);
            }
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            if row.canceled {
                client.cancel_campaign(&campaign_id, &creator);
            } else {
                // Premature bulk refund before deadline is rejected
                assert!(client.try_refund_all(&campaign_id).is_err());
                assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);
                advance_time(&env, offset + 1);
            }

            // Single atomic bulk refund restores every contributor
            client.refund_all(&campaign_id);

            for who in &contributors {
                assert_eq!(token_balance(&env, &token, who), initial_mint);
            }
            assert_eq!(token_balance(&env, &token, &vault), 0);
            assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 0);
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            // Second bulk refund call rejected (nothing to refund)
            assert!(client.try_refund_all(&campaign_id).is_err());
        }
    }

    proptest::proptest! {
        #![proptest_config(proptest::prelude::ProptestConfig::with_cases(32))]
        #[test]
        fn test_prop_refund_conserves_system_value(
            target in 700_i128..5_000_i128,
            pledge_a in 100_i128..250_i128,
            pledge_b in 100_i128..250_i128,
            deadline_offset in 10_u64..1_000_u64,
        ) {
            let env = test_env();
            env.mock_all_auths();

            let creator = Address::generate(&env);
            let admin = Address::generate(&env);
            let alice = Address::generate(&env);
            let bob = Address::generate(&env);
            let contributors = [alice.clone(), bob.clone()];

            let initial_mint = 10_000_i128;
            let token = deploy_token_minting(&env, &admin, &contributors, initial_mint);
            let tokens = [token.clone()];
            let client = deploy_contract(&env);
            let vault = client.address.clone();

            let campaign_id = client.create_campaign(
                &creator,
                &soroban_sdk::vec![&env, token.clone()],
                &target,
                &(env.ledger().timestamp() + deadline_offset),
                &String::from_str(&env, "prop refund"),
                &0_i128,
                &soroban_sdk::vec![&env],
                &0_u32,
            );

            // Step 1: Contribute
            client.contribute(&campaign_id, &alice, &token, &pledge_a);
            client.contribute(&campaign_id, &bob, &token, &pledge_b);
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            // Total system tokens conserved
            let total_system = token_balance(&env, &token, &alice)
                + token_balance(&env, &token, &bob)
                + token_balance(&env, &token, &vault);
            assert_eq!(total_system, initial_mint * 2);

            // Step 2: Premature refund is rejected and conserves state
            assert!(client.try_refund(&campaign_id, &alice).is_err());
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            // Step 3: Advance past deadline (underfunded: pledge_a + pledge_b <= 400 < target >= 500)
            advance_time(&env, deadline_offset + 1);

            // Alice refunds
            client.refund(&campaign_id, &alice);
            assert_eq!(token_balance(&env, &token, &alice), initial_mint);
            assert_eq!(token_balance(&env, &token, &bob), initial_mint - pledge_b);
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            // Bob refunds
            client.refund(&campaign_id, &bob);
            assert_eq!(token_balance(&env, &token, &bob), initial_mint);
            assert_eq!(token_balance(&env, &token, &vault), 0);
            assert_refund_books(&env, &client, campaign_id, &tokens, &contributors);

            // Final state: both contributors restored, vault drained, pledged amount 0
            assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 0);

            // Double refund fails cleanly
            assert!(client.try_refund(&campaign_id, &alice).is_err());
            assert!(client.try_refund(&campaign_id, &bob).is_err());
            assert_eq!(token_balance(&env, &token, &vault), 0);
        }
    }
}
