#ano_main
use libfzuzzer_sys::fuzz_target;

use goal_vault::{GoalVault, GoalVaultClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

fuzz_target!(|data: &[u8]| {
    // Derive a small, bounded set of parameters from the fuzz input so the
    // target stays deterministic and cheap while still exploring a range of
    // pledge amounts and deadlines.
    let seed = if data.is_empty() { 0u8 } else { data[0] };
    let pledge_amount: i128 = 1_000 + (seed as i128) * 10;
    let deadline_offset: u32 = 1_000 + (seed as u32);

    let env = Env::default();
    env.mock_all_auths();

    // --- Setup: token + contract -------------------------------------------
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = token_contract.address();
    let token_client = TokenClient::new(&env, &token_id);
    let token_admin_client = StellarAssetClient::new(&env, &token_id);

    let contract_id = env.register_contract(None, GoalVault);
    let client = GoalVaultClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let backer = Address::generate(&env);
    let stranger = Address::generate(&env);

    // Fund the backer so they can pledge.
    token_admin_client.mint(&backer, &(pledge_amount * 10));

    // Create a campaign with a deadline in the future.
    let deadline = env.ledger().timestamp() + deadline_offset as u64;
    let goal = pledge_amount;
    let title = String::from_str(&env, "fuzz-claim");
    let description = String::from_str(&env, "fuzz claim target");

    let campaign_id = client.create_campaign(
        &creator,
        &title,
        &description,
        &goal,
        &deadline,
        &token_id,
    );

    // Backer pledges, reaching the goal so the campaign can be claimed.
    client.pledge(&campaign_id, &backer, &pledge_amount);

    // --- Advance past the deadline -----------------------------------------
    env.ledger().set_timestamp(deadline + 1);

    // --- Successful claim by the creator -----------------------------------
    client.claim(&campaign_id, &creator);

    let campaign_after_claim = client.get_campaign(&campaign_id);
    assert!(campaign_after_claim.claimed, "campaign should be claimed");
    let pledged_after_claim = campaign_after_claim.pledged_amount;
    let creator_balance_after_claim = token_client.balance(&creator);
    let contract_balance_after_claim = token_client.balance(&contract_id);

    // --- Second claim by the creator must fail atomically ------------------
    let second_claim = client.try_claim(&campaign_id, &creator);
    assert!(
        second_claim.is_err(),
        "second claim by creator should fail"
    );

    let campaign_after_second = client.get_campaign(&campaign_id);
    assert!(
        campaign_after_second.claimed,
        "claimed flag must remain set after failed second claim"
    );
    assert_eq!(
        campaign_after_second.pledged_amount, pledged_after_claim,
        "pledged_amount must be unchanged after failed second claim"
    );
    assert_eq!(
        token_client.balance(&creator),
        creator_balance_after_claim,
        "creator balance must be unchanged after failed second claim"
    );
    assert_eq!(
        token_client.balance(&contract_id),
        contract_balance_after_claim,
        "contract balance must be unchanged after failed second claim"
    );

    // --- Non-creator claim must fail atomically ----------------------------
    let stranger_claim = client.try_claim(&campaign_id, &stranger);
    assert!(
        stranger_claim.is_err(),
        "non-creator claim should fail"
    );

    let campaign_after_stranger = client.get_campaign(&campaign_id);
    assert!(
        campaign_after_stranger.claimed,
        "claimed flag must remain set after failed non-creator claim"
    );
    assert_eq!(
        campaign_after_stranger.pledged_amount, pledged_after_claim,
        "pledged_amount must be unchanged after failed non-creator claim"
    );
    assert_eq!(
        token_client.balance(&creator),
        creator_balance_after_claim,
        "creator balance must be unchanged after failed non-creator claim"
    );
    assert_eq!(
        token_client.balance(&stranger),
        0,
        "stranger balance must remain zero after failed non-creator claim"
    );
    assert_eq!(
        token_client.balance(&contract_id),
        contract_balance_after_claim,
        "contract balance must be unchanged after failed non-creator claim"
    );
});