//! Authority around the minimum contribution rule (SGV-2026-113, issue #1493).
//!
//! Pins who may contribute at and below the configured floor, that an invalid
//! floor can never be installed, and that strangers cannot alter campaign or
//! fund state. Mock tokens only; no live funds.
//!
//! Covered rules: the floor is set once by `initialize` (admin signature
//! required, must be > 0, a second call cannot replace admin or floor);
//! `contribute` rejects amounts below `get_min_contribution()` and accepts
//! exactly the floor, only with the contributor's own signature; strangers
//! cannot cancel, claim or refund for others; `refund_all` needs the admin.

use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, IntoVal, String,
};

use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};

const FLOOR: i128 = 50;
const TARGET: i128 = 1_000;
const DURATION: u64 = 1_000;

struct F {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    admin: Address,
    creator: Address,
    alice: Address,
    mallory: Address,
    token: Address,
    id: u64,
}

fn setup() -> F {
    let env = Env::default();
    env.mock_all_auths();
    let vault = env.register(StellarGoalVaultContract, ());
    let client = StellarGoalVaultContractClient::new(&env, &vault);
    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let mallory = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let minter = StellarAssetClient::new(&env, &token);
    minter.mint(&alice, &10_000);
    minter.mint(&mallory, &10_000);
    client.initialize(&admin, &FLOOR);
    let id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, token.clone()],
        &TARGET,
        &(env.ledger().timestamp() + DURATION),
        &String::from_str(&env, "min"),
        &0_i128,
        &soroban_sdk::vec![&env],
        &0_u32,
    );
    F {
        env,
        client,
        admin,
        creator,
        alice,
        mallory,
        token,
        id,
    }
}

fn bal(f: &F, who: &Address) -> i128 {
    TokenClient::new(&f.env, &f.token).balance(who)
}

fn sign_only(
    f: &F,
    signer: &Address,
    fn_name: &'static str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) {
    f.env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

#[test]
fn contribution_one_below_floor_is_rejected_even_when_signed() {
    let f = setup();
    assert_eq!(f.client.get_min_contribution(), FLOOR);
    assert!(f
        .client
        .try_contribute(&f.id, &f.alice, &f.token, &(FLOOR - 1))
        .is_err());
    assert_eq!(f.client.get_campaign(&f.id).pledged_amount, 0);
    assert_eq!(bal(&f, &f.alice), 10_000);
}

#[test]
fn contribution_exactly_at_floor_is_accepted_for_the_signer() {
    let f = setup();
    f.client.contribute(&f.id, &f.alice, &f.token, &FLOOR);
    assert_eq!(f.client.get_campaign(&f.id).pledged_amount, FLOOR);
    assert_eq!(f.client.get_contribution(&f.id, &f.alice, &f.token), FLOOR);
    assert_eq!(bal(&f, &f.alice), 10_000 - FLOOR);
}

#[test]
fn contribution_at_floor_signed_by_someone_else_is_rejected() {
    let f = setup();
    sign_only(
        &f,
        &f.mallory,
        "contribute",
        (f.id, f.alice.clone(), f.token.clone(), FLOOR).into_val(&f.env),
    );
    assert!(f
        .client
        .try_contribute(&f.id, &f.alice, &f.token, &FLOOR)
        .is_err());
    assert_eq!(f.client.get_campaign(&f.id).pledged_amount, 0);
    assert_eq!(bal(&f, &f.alice), 10_000);
}

#[test]
fn zero_and_negative_floor_are_rejected_and_leave_vault_uninitialized() {
    for bad in [0_i128, -1, i128::MIN] {
        let env = Env::default();
        env.mock_all_auths();
        let vault = env.register(StellarGoalVaultContract, ());
        let client = StellarGoalVaultContractClient::new(&env, &vault);
        let admin = Address::generate(&env);
        assert!(client.try_initialize(&admin, &bad).is_err());
        // Nothing was stored: a valid initialize still succeeds afterwards.
        client.initialize(&admin, &FLOOR);
        assert_eq!(client.get_min_contribution(), FLOOR);
        assert_eq!(client.get_admin(), admin);
    }
}

#[test]
fn initialize_without_admin_signature_is_rejected() {
    let env = Env::default();
    let vault = env.register(StellarGoalVaultContract, ());
    let client = StellarGoalVaultContractClient::new(&env, &vault);
    let admin = Address::generate(&env);
    env.mock_auths(&[]);
    assert!(client.try_initialize(&admin, &FLOOR).is_err());
    env.mock_all_auths();
    client.initialize(&admin, &FLOOR);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn reinitialize_cannot_replace_admin_or_floor() {
    let f = setup();
    assert!(f.client.try_initialize(&f.mallory, &1).is_err());
    assert_eq!(f.client.get_admin(), f.admin);
    assert_eq!(f.client.get_min_contribution(), FLOOR);
}

#[test]
fn stranger_cannot_cancel_claim_or_refund_for_others() {
    let f = setup();
    f.client.contribute(&f.id, &f.alice, &f.token, &TARGET);
    let vault = f.client.address.clone();

    // Stranger acting as creator: identity mismatch even with mallory's own signature.
    assert!(f.client.try_cancel_campaign(&f.id, &f.mallory).is_err());
    assert!(!f.client.get_campaign(&f.id).canceled);

    f.env.ledger().with_mut(|l| l.timestamp += DURATION + 1);
    assert!(f.client.try_claim(&f.id, &f.mallory).is_err());
    assert!(!f.client.get_campaign(&f.id).claimed);

    // Mallory never pledged, so a refund moves nothing; alice's pledge stays escrowed.
    let _ = f.client.try_refund(&f.id, &f.mallory);
    assert_eq!(f.client.get_contribution(&f.id, &f.alice, &f.token), TARGET);
    assert_eq!(bal(&f, &vault), TARGET);
    assert_eq!(bal(&f, &f.mallory), 10_000);
    assert_eq!(bal(&f, &f.creator), 0);
}

#[test]
fn refund_all_requires_the_admin_signature() {
    let f = setup();
    f.client.contribute(&f.id, &f.alice, &f.token, &FLOOR);
    f.env.ledger().with_mut(|l| l.timestamp += DURATION + 1);
    sign_only(&f, &f.mallory, "refund_all", (f.id,).into_val(&f.env));
    assert!(f.client.try_refund_all(&f.id).is_err());
    assert_eq!(bal(&f, &f.client.address), FLOOR);
    assert_eq!(bal(&f, &f.alice), 10_000 - FLOOR);
}
