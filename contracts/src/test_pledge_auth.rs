//! Authorization on the pledge contract path (issue #898).
//!
//! The rest of the suite runs under `mock_all_auths()`, which approves every
//! `require_auth` call — so it proves the lifecycle, not who may drive it.
//! These tests pin the signer side:
//!
//! * **Correct signer.** After each privileged call, `env.auths()` must show
//!   exactly one signer — the one `CONTRACT_ABI.md` names — authorizing that
//!   exact entry point on this contract.
//! * **No signer / wrong signer.** With enforcing auth (`mock_auths`), a call
//!   carrying no signature, or another account's signature, fails and leaves
//!   pledges, balances and campaign state untouched.
//! * **New guards.** `contribute` rejects the vault as its own contributor;
//!   `refund_all` is admin-only (it used to be callable by anyone).

use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Ledger, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, IntoVal, String, Symbol,
};

use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};

const TARGET: i128 = 1_000;
const PLEDGE: i128 = 400;
const DURATION: u64 = 1_000;

struct Fixture {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    admin: Address,
    creator: Address,
    alice: Address,
    bob: Address,
    token: Address,
    campaign_id: u64,
}

/// Deploys the vault, optionally initializes it, and opens one campaign with
/// two funded would-be contributors. Auth is fully mocked during setup only.
fn fixture_with(initialize: bool) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarGoalVaultContract, ());
    let client = StellarGoalVaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let minter = StellarAssetClient::new(&env, &token);
    minter.mint(&alice, &10_000);
    minter.mint(&bob, &10_000);

    if initialize {
        client.initialize(&admin, &1);
    }

    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, token.clone()],
        &TARGET,
        &(env.ledger().timestamp() + DURATION),
        &String::from_str(&env, "auth"),
        &0_i128,
    );

    Fixture {
        env,
        client,
        admin,
        creator,
        alice,
        bob,
        token,
        campaign_id,
    }
}

fn fixture() -> Fixture {
    fixture_with(true)
}

fn past_deadline(env: &Env) {
    env.ledger().with_mut(|l| l.timestamp += DURATION + 1);
}

fn balance(f: &Fixture, who: &Address) -> i128 {
    TokenClient::new(&f.env, &f.token).balance(who)
}

/// The last top-level call was authorized by exactly one address, `expected`,
/// for `fn_name` on the vault contract.
fn assert_sole_signer(f: &Fixture, expected: &Address, fn_name: &str) {
    let auths = f.env.auths();
    assert_eq!(
        auths.len(),
        1,
        "{fn_name}: expected exactly one signer, got {auths:?}"
    );
    let (signer, invocation) = &auths[0];
    assert_eq!(
        signer, expected,
        "{fn_name}: authorized by the wrong address"
    );
    match &invocation.function {
        AuthorizedFunction::Contract((contract, name, _)) => {
            assert_eq!(
                contract, &f.client.address,
                "{fn_name}: auth for another contract"
            );
            assert_eq!(
                name,
                &Symbol::new(&f.env, fn_name),
                "{fn_name}: auth for another function"
            );
        }
        other => panic!("{fn_name}: unexpected authorized function {other:?}"),
    }
}

/// Switch from "approve everything" to enforcing auth with no signatures.
fn enforce_no_signatures(f: &Fixture) {
    f.env.mock_auths(&[]);
}

// --- contribute ------------------------------------------------------------

#[test]
fn contribute_requires_exactly_the_contributor_signature() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    assert_sole_signer(&f, &f.alice, "contribute");
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, PLEDGE);
}

#[test]
fn contribute_without_signature_fails_and_changes_nothing() {
    let f = fixture();
    enforce_no_signatures(&f);

    let result = f
        .client
        .try_contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    assert!(result.is_err(), "unsigned contribute must fail");

    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        0
    );
    assert_eq!(balance(&f, &f.alice), 10_000);
}

#[test]
fn contribute_signed_by_another_account_fails() {
    let f = fixture();
    // Bob signs a pledge that would pull Alice's tokens.
    f.env.mock_auths(&[MockAuth {
        address: &f.bob,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "contribute",
            args: (f.campaign_id, f.alice.clone(), f.token.clone(), PLEDGE).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    let result = f
        .client
        .try_contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    assert!(result.is_err(), "a pledge signed by someone else must fail");
    assert_eq!(balance(&f, &f.alice), 10_000);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
}

#[test]
#[should_panic(expected = "contributor cannot be the vault contract")]
fn contribute_rejects_the_vault_as_contributor() {
    let f = fixture();
    let vault = f.client.address.clone();
    f.client
        .contribute(&f.campaign_id, &vault, &f.token, &PLEDGE);
}

// --- claim / cancel ----------------------------------------------------------

#[test]
fn claim_requires_exactly_the_creator_signature() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &TARGET);
    past_deadline(&f.env);

    f.client.claim(&f.campaign_id, &f.creator);
    assert_sole_signer(&f, &f.creator, "claim");
    assert!(f.client.get_campaign(&f.campaign_id).claimed);
}

#[test]
fn claim_without_signature_fails_and_keeps_funds_in_the_vault() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &TARGET);
    past_deadline(&f.env);
    enforce_no_signatures(&f);

    assert!(f.client.try_claim(&f.campaign_id, &f.creator).is_err());
    assert!(!f.client.get_campaign(&f.campaign_id).claimed);
    assert_eq!(balance(&f, &f.client.address), TARGET);
    assert_eq!(balance(&f, &f.creator), 0);
}

#[test]
fn cancel_campaign_requires_exactly_the_creator_signature() {
    let f = fixture();
    f.client.cancel_campaign(&f.campaign_id, &f.creator);
    assert_sole_signer(&f, &f.creator, "cancel_campaign");
    assert!(f.client.get_campaign(&f.campaign_id).canceled);
}

// --- refund --------------------------------------------------------------------

#[test]
fn refund_requires_exactly_the_contributor_signature() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    past_deadline(&f.env);

    f.client.refund(&f.campaign_id, &f.alice);
    assert_sole_signer(&f, &f.alice, "refund");
    assert_eq!(balance(&f, &f.alice), 10_000);
}

#[test]
fn refund_without_signature_fails_and_keeps_the_pledge() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    past_deadline(&f.env);
    enforce_no_signatures(&f);

    assert!(f.client.try_refund(&f.campaign_id, &f.alice).is_err());
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        PLEDGE
    );
    assert_eq!(balance(&f, &f.alice), 10_000 - PLEDGE);
}

// --- refund_all (admin only since #898) -----------------------------------------

#[test]
fn refund_all_requires_exactly_the_admin_signature_and_refunds_everyone() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token, &PLEDGE);
    past_deadline(&f.env);

    f.client.refund_all(&f.campaign_id);
    assert_sole_signer(&f, &f.admin, "refund_all");

    // Lifecycle unchanged for an authorized call: everyone is made whole.
    assert_eq!(balance(&f, &f.alice), 10_000);
    assert_eq!(balance(&f, &f.bob), 10_000);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
    assert_eq!(balance(&f, &f.client.address), 0);
}

#[test]
fn refund_all_without_signature_fails_and_changes_nothing() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token, &PLEDGE);
    past_deadline(&f.env);
    enforce_no_signatures(&f);

    assert!(f.client.try_refund_all(&f.campaign_id).is_err());
    assert_eq!(
        f.client.get_campaign(&f.campaign_id).pledged_amount,
        2 * PLEDGE
    );
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        PLEDGE
    );
    assert_eq!(
        f.client.get_contribution(&f.campaign_id, &f.bob, &f.token),
        PLEDGE
    );
    assert_eq!(balance(&f, &f.client.address), 2 * PLEDGE);
}

#[test]
fn refund_all_signed_by_the_creator_is_rejected() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    past_deadline(&f.env);
    // The creator is not the admin, so their signature is not enough.
    f.env.mock_auths(&[MockAuth {
        address: &f.creator,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "refund_all",
            args: (f.campaign_id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    assert!(f.client.try_refund_all(&f.campaign_id).is_err());
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        PLEDGE
    );
}

#[test]
fn refund_all_fails_the_same_way_before_the_deadline_without_a_signature() {
    // Auth is checked before the campaign is read, so an unauthorized call
    // fails regardless of campaign state (here: still active).
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    enforce_no_signatures(&f);
    assert!(f.client.try_refund_all(&f.campaign_id).is_err());
}

#[test]
#[should_panic(expected = "not initialized")]
fn refund_all_requires_an_initialized_admin() {
    let f = fixture_with(false);
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    past_deadline(&f.env);
    f.client.refund_all(&f.campaign_id);
}
