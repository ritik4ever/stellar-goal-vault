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
        &soroban_sdk::vec![&env],
        &0_u32,
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
    assert_sole_signer_on(&f.env, &f.client.address, expected, fn_name);
}

fn assert_sole_signer_on(env: &Env, vault: &Address, expected: &Address, fn_name: &str) {
    let auths = env.auths();
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
            assert_eq!(contract, vault, "{fn_name}: auth for another contract");
            assert_eq!(
                name,
                &Symbol::new(env, fn_name),
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
    assert_eq!(balance(&f, &f.creator), TARGET);
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
fn claim_signed_by_a_non_creator_fails_and_changes_nothing() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &TARGET);
    past_deadline(&f.env);
    // Alice signs a claim that would pay out to the creator.
    f.env.mock_auths(&[MockAuth {
        address: &f.alice,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "claim",
            args: (f.campaign_id, f.creator.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    let result = f.client.try_claim(&f.campaign_id, &f.creator);
    assert!(result.is_err(), "a claim signed by a non-creator must fail");

    // No partial payout: campaign, vault balance and creator balance intact.
    assert!(!f.client.get_campaign(&f.campaign_id).claimed);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, TARGET);
    assert_eq!(balance(&f, &f.client.address), TARGET);
    assert_eq!(balance(&f, &f.creator), 0);
}

#[test]
fn duplicate_claim_fails_and_leaves_the_post_claim_state_intact() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &TARGET);
    past_deadline(&f.env);

    f.client.claim(&f.campaign_id, &f.creator);
    assert!(f.client.get_campaign(&f.campaign_id).claimed);
    assert_eq!(balance(&f, &f.client.address), 0);
    assert_eq!(balance(&f, &f.creator), TARGET);

    // A second claim by the creator must fail without moving any tokens.
    let result = f.client.try_claim(&f.campaign_id, &f.creator);
    assert!(result.is_err(), "a duplicate claim must fail");

    assert!(f.client.get_campaign(&f.campaign_id).claimed);
    assert_eq!(balance(&f, &f.client.address), 0);
    assert_eq!(balance(&f, &f.creator), TARGET);
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

// --- refund after failures and on partially refunded campaigns (issue #1518) ---
//
// `refund` is contributor-authorized (above). The tests below pin that rule in
// the two states a failed campaign actually reaches in production: a refund
// attempt whose token transfer failed, and a campaign where some contributors
// have already been refunded and others have not.

/// Test double for a token whose `transfer` can be made to fail on demand.
///
/// It exists only to reproduce a failed token transfer inside `refund` without
/// any real funds: `mint`, `balance` and `transfer` are all the vault's pledge
/// and refund paths touch, and `freeze` makes every later transfer panic the
/// way a token does when the vault cannot cover it. Never deployed outside
/// `cfg(test)`.
#[soroban_sdk::contract]
pub struct FlakyToken;

#[soroban_sdk::contractimpl]
impl FlakyToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = (Symbol::new(&env, "balance"), to);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        let key = (Symbol::new(&env, "balance"), id);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    /// `create_campaign` probes `decimals` to reject non-token addresses.
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    pub fn freeze(env: Env) {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "frozen"), &true);
    }

    pub fn unfreeze(env: Env) {
        env.storage()
            .instance()
            .remove(&Symbol::new(&env, "frozen"));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let frozen: bool = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "frozen"))
            .unwrap_or(false);
        if frozen {
            panic!("token transfer failed");
        }
        let from_key = (Symbol::new(&env, "balance"), from);
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        let to_key = (Symbol::new(&env, "balance"), to);
        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance + amount));
    }
}

/// Underfunded failed campaign that accepts one real SAC token and the test
/// double, so a refund can be made to fail halfway through its token loop.
const FAILED_TARGET: i128 = 2_000;

struct FlakyFixture {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    creator: Address,
    alice: Address,
    bob: Address,
    token: Address,
    flaky: Address,
    campaign_id: u64,
}

fn flaky_fixture() -> FlakyFixture {
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

    let flaky = env.register(FlakyToken, ());
    FlakyTokenClient::new(&env, &flaky).mint(&alice, &10_000);

    client.initialize(&admin, &1);

    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, token.clone(), flaky.clone()],
        &FAILED_TARGET,
        &(env.ledger().timestamp() + DURATION),
        &String::from_str(&env, "refund authority"),
        &0_i128,
        &soroban_sdk::vec![&env],
        &0_u32,
    );

    FlakyFixture {
        env,
        client,
        creator,
        alice,
        bob,
        token,
        flaky,
        campaign_id,
    }
}

fn sac_balance(f: &FlakyFixture, who: &Address) -> i128 {
    TokenClient::new(&f.env, &f.token).balance(who)
}

fn flaky_balance(f: &FlakyFixture, who: &Address) -> i128 {
    FlakyTokenClient::new(&f.env, &f.flaky).balance(who)
}

/// A refund that failed must leave the campaign, the vault and the contributor
/// exactly as they were: no partial payout, no zeroed contribution.
fn assert_failed_refund_paid_nothing(f: &FlakyFixture) {
    let campaign = f.client.get_campaign(&f.campaign_id);
    assert!(!campaign.claimed);
    assert_eq!(campaign.pledged_amount, PLEDGE + 600);
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        PLEDGE
    );
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.flaky),
        600
    );
    assert_eq!(sac_balance(f, &f.client.address), PLEDGE);
    assert_eq!(flaky_balance(f, &f.client.address), 600);
    assert_eq!(sac_balance(f, &f.alice), 10_000 - PLEDGE);
    assert_eq!(flaky_balance(f, &f.alice), 9_400);
}

#[test]
fn refund_after_a_failed_token_transfer_pays_nothing_and_only_the_contributor_can_retry() {
    let f = flaky_fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.flaky, &600);
    past_deadline(&f.env);

    // The vault cannot pay this contributor in the second token yet, so the
    // refund's transfer fails and the whole call reverts.
    FlakyTokenClient::new(&f.env, &f.flaky).freeze();
    assert!(f.client.try_refund(&f.campaign_id, &f.alice).is_err());
    assert_failed_refund_paid_nothing(&f);

    // Neither the creator nor another contributor can complete the refund,
    // even though the campaign is failed and the funds are waiting.
    for signer in [&f.creator, &f.bob] {
        f.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "refund",
                args: (f.campaign_id, f.alice.clone()).into_val(&f.env),
                sub_invokes: &[],
            },
        }]);
        assert!(f.client.try_refund(&f.campaign_id, &f.alice).is_err());
        assert_failed_refund_paid_nothing(&f);
    }

    // Once the token is healthy again the contributor's own signature refunds
    // exactly once.
    FlakyTokenClient::new(&f.env, &f.flaky).unfreeze();
    f.env.mock_all_auths();
    f.client.refund(&f.campaign_id, &f.alice);
    assert_sole_signer_on(&f.env, &f.client.address, &f.alice, "refund");

    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        0
    );
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.flaky),
        0
    );
    assert_eq!(sac_balance(&f, &f.alice), 10_000);
    assert_eq!(flaky_balance(&f, &f.alice), 10_000);
    assert_eq!(sac_balance(&f, &f.client.address), 0);
    assert_eq!(flaky_balance(&f, &f.client.address), 0);

    // A duplicate refund after the retry pays nothing.
    assert!(f.client.try_refund(&f.campaign_id, &f.alice).is_err());
    assert_eq!(sac_balance(&f, &f.alice), 10_000);
    assert_eq!(flaky_balance(&f, &f.alice), 10_000);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
}

#[test]
fn partially_refunded_campaign_lets_only_each_contributor_release_their_own_pledge() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token, &PLEDGE);
    past_deadline(&f.env);

    // Alice is refunded first: the campaign is now partially refunded.
    f.client.refund(&f.campaign_id, &f.alice);
    assert_sole_signer(&f, &f.alice, "refund");
    assert_eq!(balance(&f, &f.alice), 10_000);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, PLEDGE);
    assert_eq!(balance(&f, &f.client.address), PLEDGE);

    // Neither the creator nor another contributor can release Bob's pledge.
    for signer in [&f.creator, &f.alice] {
        f.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "refund",
                args: (f.campaign_id, f.bob.clone()).into_val(&f.env),
                sub_invokes: &[],
            },
        }]);
        assert!(f.client.try_refund(&f.campaign_id, &f.bob).is_err());
    }
    assert_eq!(balance(&f, &f.bob), 10_000 - PLEDGE);
    assert_eq!(
        f.client.get_contribution(&f.campaign_id, &f.bob, &f.token),
        PLEDGE
    );
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, PLEDGE);
    assert_eq!(balance(&f, &f.client.address), PLEDGE);

    // Bob's own signature closes the campaign out, and only for his pledge.
    f.env.mock_all_auths();
    f.client.refund(&f.campaign_id, &f.bob);
    assert_sole_signer(&f, &f.bob, "refund");
    assert_eq!(balance(&f, &f.bob), 10_000);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
    assert_eq!(balance(&f, &f.client.address), 0);
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        0
    );
}

// --- update_metadata (SGV-2026-142) ------------------------------------------

#[test]
fn update_metadata_requires_exactly_the_creator_signature() {
    let f = fixture();
    let updated = String::from_str(&f.env, "updated metadata");

    f.client
        .update_metadata(&f.campaign_id, &f.creator, &updated);
    assert_sole_signer(&f, &f.creator, "update_metadata");
    assert_eq!(f.client.get_campaign(&f.campaign_id).metadata, updated);
}

#[test]
fn update_metadata_without_signature_fails_and_leaves_storage_and_balances_intact() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    enforce_no_signatures(&f);

    let result = f.client.try_update_metadata(
        &f.campaign_id,
        &f.creator,
        &String::from_str(&f.env, "unsigned update"),
    );
    assert!(result.is_err(), "unsigned update_metadata must fail");

    let campaign = f.client.get_campaign(&f.campaign_id);
    assert_eq!(campaign.metadata, String::from_str(&f.env, "auth"));
    assert_eq!(campaign.pledged_amount, PLEDGE);
    assert_eq!(campaign.contributor_count, 1);
    assert!(!campaign.claimed);
    assert!(!campaign.canceled);
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        PLEDGE
    );
    assert_eq!(balance(&f, &f.alice), 10_000 - PLEDGE);
    assert_eq!(balance(&f, &f.client.address), PLEDGE);
    assert_eq!(balance(&f, &f.creator), 0);
}

#[test]
fn update_metadata_signed_by_another_account_fails_and_changes_nothing() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);

    let hacked = String::from_str(&f.env, "hacked metadata");

    // Case 1: Bob signs an update_metadata call purporting to act as creator.
    f.env.mock_auths(&[MockAuth {
        address: &f.bob,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "update_metadata",
            args: (f.campaign_id, f.creator.clone(), hacked.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    let result = f
        .client
        .try_update_metadata(&f.campaign_id, &f.creator, &hacked);
    assert!(
        result.is_err(),
        "update_metadata signed by a non-creator must fail"
    );

    // Case 2: Bob signs an update_metadata call with his own address as creator.
    f.env.mock_auths(&[MockAuth {
        address: &f.bob,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "update_metadata",
            args: (f.campaign_id, f.bob.clone(), hacked.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    let result = f
        .client
        .try_update_metadata(&f.campaign_id, &f.bob, &hacked);
    assert!(
        result.is_err(),
        "update_metadata by a non-creator caller must fail"
    );

    let campaign = f.client.get_campaign(&f.campaign_id);
    assert_eq!(campaign.metadata, String::from_str(&f.env, "auth"));
    assert_eq!(campaign.pledged_amount, PLEDGE);
    assert_eq!(campaign.contributor_count, 1);
    assert!(!campaign.claimed);
    assert!(!campaign.canceled);
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        PLEDGE
    );
    assert_eq!(balance(&f, &f.alice), 10_000 - PLEDGE);
    assert_eq!(balance(&f, &f.bob), 10_000);
    assert_eq!(balance(&f, &f.client.address), PLEDGE);
    assert_eq!(balance(&f, &f.creator), 0);
}

#[test]
fn unauthorized_update_metadata_around_pledge_and_settlement_leaves_balances_and_state_valid() {
    let f = fixture();
    let original = String::from_str(&f.env, "auth");
    let tampered = String::from_str(&f.env, "tampered");

    // First pledge moves tokens into the vault.
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);

    // Contributor Alice tries to overwrite metadata after pledging.
    f.env.mock_auths(&[MockAuth {
        address: &f.alice,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "update_metadata",
            args: (f.campaign_id, f.alice.clone(), tampered.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f
        .client
        .try_update_metadata(&f.campaign_id, &f.alice, &tampered)
        .is_err());

    let mid_campaign = f.client.get_campaign(&f.campaign_id);
    assert_eq!(mid_campaign.metadata, original);
    assert_eq!(mid_campaign.pledged_amount, PLEDGE);
    assert_eq!(balance(&f, &f.alice), 10_000 - PLEDGE);
    assert_eq!(balance(&f, &f.client.address), PLEDGE);
    assert_eq!(balance(&f, &f.creator), 0);

    // Second pledge completes the funding target.
    f.env.mock_all_auths();
    let remainder = TARGET - PLEDGE;
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token, &remainder);

    // Unauthorized caller attempts unsigned metadata update before settlement.
    enforce_no_signatures(&f);
    assert!(f
        .client
        .try_update_metadata(&f.campaign_id, &f.creator, &tampered)
        .is_err());

    let pre_claim = f.client.get_campaign(&f.campaign_id);
    assert_eq!(pre_claim.metadata, original);
    assert_eq!(pre_claim.pledged_amount, TARGET);
    assert!(!pre_claim.claimed);
    assert_eq!(balance(&f, &f.client.address), TARGET);
    assert_eq!(balance(&f, &f.creator), 0);

    // Settlement still succeeds cleanly for the creator with full payout.
    f.env.mock_all_auths();
    past_deadline(&f.env);
    f.client.claim(&f.campaign_id, &f.creator);

    let post_claim = f.client.get_campaign(&f.campaign_id);
    assert!(post_claim.claimed);
    assert_eq!(post_claim.metadata, original);
    assert_eq!(post_claim.pledged_amount, TARGET);
    assert_eq!(balance(&f, &f.client.address), 0);
    assert_eq!(balance(&f, &f.creator), TARGET);
}

// --- #1528: authority near Campaign storage TTL -----------------------------
//
// The TTL-refresh helpers write to storage, so every path that may call them
// must be behind `require_auth` *before* the first refresh — otherwise an
// unauthorized caller could still perturb storage lifetimes by failing late.
// These tests pin that invariant for `contribute`, `claim` and `refund_all`:
// with enforcing auth, an unsigned or mis-signed call fails, no fund moves,
// and the campaign record is unchanged. Soroban rolls the whole invocation
// back on auth failure, so the TTL bump never lands either.

#[test]
fn contribute_without_signature_near_ttl_leaves_campaign_untouched() {
    let f = fixture();
    f.env.ledger().set_min_persistent_entry_ttl(1);
    enforce_no_signatures(&f);

    let before = f.client.get_campaign(&f.campaign_id);
    assert!(f
        .client
        .try_contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE)
        .is_err());
    let after = f.client.get_campaign(&f.campaign_id);
    assert_eq!(after.pledged_amount, before.pledged_amount);
    assert_eq!(
        f.client.get_contribution(&f.campaign_id, &f.alice, &f.token),
        0
    );
    assert_eq!(balance(&f, &f.alice), 10_000);
}

#[test]
fn claim_signed_by_non_creator_near_ttl_releases_no_funds() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &TARGET);
    past_deadline(&f.env);
    f.env.ledger().set_min_persistent_entry_ttl(1);

    f.env.mock_auths(&[MockAuth {
        address: &f.alice,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "claim",
            args: (f.campaign_id, f.creator.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f.client.try_claim(&f.campaign_id, &f.creator).is_err());
    assert!(!f.client.get_campaign(&f.campaign_id).claimed);
    assert_eq!(balance(&f, &f.creator), 0);
    assert_eq!(balance(&f, &f.client.address), TARGET);
}

#[test]
fn refund_all_without_admin_signature_near_ttl_refunds_nothing() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    past_deadline(&f.env);
    f.env.ledger().set_min_persistent_entry_ttl(1);
    enforce_no_signatures(&f);

    assert!(f.client.try_refund_all(&f.campaign_id).is_err());
    assert_eq!(balance(&f, &f.alice), 10_000 - PLEDGE);
    assert_eq!(balance(&f, &f.client.address), PLEDGE);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, PLEDGE);
    let _ = &f.admin;
    let _ = &f.bob;
}
