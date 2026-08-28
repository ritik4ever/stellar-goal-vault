//! Lifecycle tests for native XLM campaigns (issue #549).
//!
//! On Stellar, native XLM is exposed to Soroban through its own Stellar Asset
//! Contract (SAC). A SAC registered with the test host therefore exercises the
//! exact token interface the contract uses on-chain for native XLM, so these
//! tests double as verification that create / contribute / claim / refund all
//! move real native balances correctly.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

use crate::{AssetType, StellarGoalVaultContract, StellarGoalVaultContractClient};

fn deploy_contract(env: &Env) -> StellarGoalVaultContractClient<'_> {
    let contract_id = env.register_contract(None, StellarGoalVaultContract);
    StellarGoalVaultContractClient::new(env, &contract_id)
}

/// Registers a SAC standing in for the network-native XLM asset and mints
/// `amount` of it to `recipient`.
fn deploy_native_asset(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let native = env.register_stellar_asset_contract(admin.clone());
    StellarAssetClient::new(env, &native).mint(recipient, &amount);
    native
}

fn advance_time(env: &Env, seconds: u64) {
    env.ledger().with_mut(|info| {
        info.timestamp += seconds;
    });
}

#[test]
fn test_native_xlm_campaign_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);

    let target: i128 = 1_000;
    let deadline_offset: u64 = 100;
    let deadline = env.ledger().timestamp() + deadline_offset;

    let native = deploy_native_asset(&env, &admin, &contributor, target);
    let client = deploy_contract(&env);

    // Register the canonical native asset so an XLM-only campaign is recognised
    // as a native campaign rather than a generic SAC campaign.
    client.initialize(&admin, &100_i128);
    client.set_native_asset(&admin, &native);
    assert_eq!(client.get_native_asset(), Some(native.clone()));

    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, native.clone()],
        &target,
        &deadline,
        &String::from_str(&env, "restore the coral reef"),
        &0_i128,
    );

    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(
        campaign.asset_type,
        AssetType::Native,
        "an XLM-only campaign should be classified as native"
    );

    // Contribute native XLM and confirm the balance actually moved into the
    // contract's custody.
    let native_token = TokenClient::new(&env, &native);
    assert_eq!(native_token.balance(&contributor), target);
    client.contribute(&campaign_id, &contributor, &native, &target);
    assert_eq!(native_token.balance(&contributor), 0);
    assert_eq!(native_token.balance(&client.address), target);
    assert_eq!(
        client.get_campaign_token_balance(&campaign_id, &native),
        target
    );

    // Claiming a funded campaign after its deadline releases the native XLM to
    // the creator and clears the tracked balance.
    advance_time(&env, deadline_offset + 1);
    client.claim(&campaign_id, &creator);

    assert!(client.get_campaign(&campaign_id).claimed);
    assert_eq!(native_token.balance(&creator), target);
    assert_eq!(native_token.balance(&client.address), 0);
    assert_eq!(client.get_campaign_token_balance(&campaign_id, &native), 0);
}

#[test]
fn test_native_xlm_refund_after_failed_campaign() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);

    let target: i128 = 1_000;
    let pledge: i128 = 400; // deliberately below target so the campaign fails
    let deadline_offset: u64 = 50;
    let deadline = env.ledger().timestamp() + deadline_offset;

    let native = deploy_native_asset(&env, &admin, &contributor, pledge);
    let client = deploy_contract(&env);
    client.initialize(&admin, &100_i128);
    client.set_native_asset(&admin, &native);

    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, native.clone()],
        &target,
        &deadline,
        &String::from_str(&env, "underfunded XLM goal"),
        &0_i128,
    );
    assert_eq!(
        client.get_campaign(&campaign_id).asset_type,
        AssetType::Native
    );

    client.contribute(&campaign_id, &contributor, &native, &pledge);
    let native_token = TokenClient::new(&env, &native);
    assert_eq!(native_token.balance(&contributor), 0);
    assert_eq!(native_token.balance(&client.address), pledge);

    // The deadline passes without meeting the target, so the contributor can
    // reclaim their native XLM in full.
    advance_time(&env, deadline_offset + 1);
    client.refund(&campaign_id, &contributor);

    assert_eq!(native_token.balance(&contributor), pledge);
    assert_eq!(native_token.balance(&client.address), 0);
    assert_eq!(
        client.get_contribution(&campaign_id, &contributor, &native),
        0
    );
    assert_eq!(client.get_campaign_token_balance(&campaign_id, &native), 0);
}

#[test]
fn test_native_xlm_refund_after_cancel() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);

    let target: i128 = 1_000;
    let pledge: i128 = 600;
    let deadline = env.ledger().timestamp() + 100;

    let native = deploy_native_asset(&env, &admin, &contributor, pledge);
    let client = deploy_contract(&env);
    client.initialize(&admin, &100_i128);
    client.set_native_asset(&admin, &native);

    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, native.clone()],
        &target,
        &deadline,
        &String::from_str(&env, "cancelled XLM campaign"),
        &0_i128,
    );

    client.contribute(&campaign_id, &contributor, &native, &pledge);

    // Cancelling before the deadline lets contributors refund immediately.
    client.cancel_campaign(&campaign_id, &creator);
    client.refund(&campaign_id, &contributor);

    let native_token = TokenClient::new(&env, &native);
    assert_eq!(native_token.balance(&contributor), pledge);
    assert_eq!(client.get_campaign_token_balance(&campaign_id, &native), 0);
}

#[test]
fn test_non_native_campaign_is_sac() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);

    let target: i128 = 1_000;
    let deadline = env.ledger().timestamp() + 100;

    let native = deploy_native_asset(&env, &admin, &contributor, target);
    // A second, distinct SAC token that is not the registered native asset.
    let other = deploy_native_asset(&env, &admin, &contributor, target);
    let client = deploy_contract(&env);
    client.initialize(&admin, &100_i128);
    client.set_native_asset(&admin, &native);

    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, other.clone()],
        &target,
        &deadline,
        &String::from_str(&env, "usdc campaign"),
        &0_i128,
    );
    assert_eq!(client.get_campaign(&campaign_id).asset_type, AssetType::Sac);
}

#[test]
fn test_native_classification_requires_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);

    let target: i128 = 1_000;
    let deadline = env.ledger().timestamp() + 100;

    let native = deploy_native_asset(&env, &admin, &contributor, target);
    let client = deploy_contract(&env);

    // No native asset registered: even a campaign that uses the native address
    // falls back to the generic SAC classification.
    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, native.clone()],
        &target,
        &deadline,
        &String::from_str(&env, "unregistered native"),
        &0_i128,
    );
    assert_eq!(client.get_campaign(&campaign_id).asset_type, AssetType::Sac);
    assert_eq!(client.get_native_asset(), None);
}

#[test]
fn test_multi_token_including_native_is_sac() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);

    let target: i128 = 1_000;
    let deadline = env.ledger().timestamp() + 100;

    let native = deploy_native_asset(&env, &admin, &contributor, target);
    let other = deploy_native_asset(&env, &admin, &contributor, target);
    let client = deploy_contract(&env);
    client.initialize(&admin, &100_i128);
    client.set_native_asset(&admin, &native);

    // A campaign accepting native XLM alongside another token is a mixed,
    // multi-token campaign and is classified as SAC.
    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, native.clone(), other.clone()],
        &target,
        &deadline,
        &String::from_str(&env, "mixed campaign"),
        &0_i128,
    );
    assert_eq!(client.get_campaign(&campaign_id).asset_type, AssetType::Sac);
}
