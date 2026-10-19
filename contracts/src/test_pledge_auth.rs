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
//! * **Refund path.** `refund` accepts only the contributor's own signature
//!   for that exact campaign, and `cancel_campaign` (which opens refunds)
//!   only the creator's. Unauthorized calls fail with the host's auth error
//!   whatever the campaign state, before any lifecycle check runs.

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

// --- refund path: signer review ------------------------------------------------

const AUTH_ERROR: &str = "Error(Auth, InvalidAction)";

/// Runs `call` and asserts it failed on the signature check itself. The
/// native test contract reports every failure as `Error(Context, ..)` through
/// `try_*`, so the panic text is what tells an auth failure apart from a
/// lifecycle panic such as "campaign is still active".
fn assert_auth_failure(what: &str, call: impl FnOnce()) {
    let payload =
        crate::std::panic::catch_unwind(crate::std::panic::AssertUnwindSafe(call)).expect_err(what);
    let msg = payload
        .downcast_ref::<crate::std::string::String>()
        .map(|s| s.as_str())
        .or_else(|| payload.downcast_ref::<&str>().copied())
        .unwrap_or_default();
    assert!(
        msg.contains(AUTH_ERROR),
        "{what}: expected the auth check to fail first, got: {msg}"
    );
}

/// Only `who`'s signature, for `fn_name(args)` on the vault.
fn sign_as<'a>(
    f: &'a Fixture,
    who: &'a Address,
    fn_name: &'a str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) {
    f.env.mock_auths(&[MockAuth {
        address: who,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

#[test]
fn refund_signed_by_another_account_fails_and_keeps_the_pledge() {
    for signer in ["bob", "creator", "admin"] {
        let f = fixture();
        f.client
            .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
        past_deadline(&f.env);
        let who = match signer {
            "bob" => f.bob.clone(),
            "creator" => f.creator.clone(),
            _ => f.admin.clone(),
        };
        sign_as(
            &f,
            &who,
            "refund",
            (f.campaign_id, f.alice.clone()).into_val(&f.env),
        );

        assert_auth_failure(signer, || f.client.refund(&f.campaign_id, &f.alice));
        assert_eq!(
            f.client
                .get_contribution(&f.campaign_id, &f.alice, &f.token),
            PLEDGE,
            "{signer} must not be able to refund alice"
        );
        assert_eq!(balance(&f, &f.client.address), PLEDGE);
    }
}

#[test]
fn refund_signature_for_another_campaign_cannot_be_replayed() {
    let f = fixture();
    let other = f.client.create_campaign(
        &f.creator,
        &soroban_sdk::vec![&f.env, f.token.clone()],
        &TARGET,
        &(f.env.ledger().timestamp() + DURATION),
        &String::from_str(&f.env, "other"),
        &0_i128,
        &soroban_sdk::vec![&f.env],
        &0_u32,
    );
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    f.client.contribute(&other, &f.alice, &f.token, &PLEDGE);
    past_deadline(&f.env);

    // Alice signed a refund for `other` only.
    sign_as(
        &f,
        &f.alice,
        "refund",
        (other, f.alice.clone()).into_val(&f.env),
    );
    assert_auth_failure("replayed refund", || {
        f.client.refund(&f.campaign_id, &f.alice)
    });
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.alice, &f.token),
        PLEDGE
    );

    // The signature still works for the campaign it was made for.
    sign_as(
        &f,
        &f.alice,
        "refund",
        (other, f.alice.clone()).into_val(&f.env),
    );
    f.client.refund(&other, &f.alice);
    assert_eq!(f.client.get_contribution(&other, &f.alice, &f.token), 0);
}

#[test]
fn unsigned_refund_fails_the_same_way_in_every_campaign_state() {
    // Active, refundable, canceled, funded-after-deadline, and for an
    // address that never pledged: the signature check fails first each time.
    let active = fixture();
    active
        .client
        .contribute(&active.campaign_id, &active.alice, &active.token, &PLEDGE);

    let refundable = fixture();
    refundable.client.contribute(
        &refundable.campaign_id,
        &refundable.alice,
        &refundable.token,
        &PLEDGE,
    );
    past_deadline(&refundable.env);

    let canceled = fixture();
    canceled.client.contribute(
        &canceled.campaign_id,
        &canceled.alice,
        &canceled.token,
        &PLEDGE,
    );
    canceled
        .client
        .cancel_campaign(&canceled.campaign_id, &canceled.creator);

    let funded = fixture();
    funded
        .client
        .contribute(&funded.campaign_id, &funded.alice, &funded.token, &TARGET);
    past_deadline(&funded.env);

    for (state, f, who) in [
        ("active", &active, &active.alice),
        ("refundable", &refundable, &refundable.alice),
        ("canceled", &canceled, &canceled.alice),
        ("funded", &funded, &funded.alice),
        ("never pledged", &refundable, &refundable.bob),
    ] {
        enforce_no_signatures(f);
        let before = f.client.get_campaign(&f.campaign_id);
        assert_auth_failure(state, || f.client.refund(&f.campaign_id, who));
        assert_eq!(f.client.get_campaign(&f.campaign_id), before, "{state}");
    }
}

#[test]
fn authorized_refund_still_follows_the_lifecycle_rules() {
    // A valid signature does not bypass the state checks.
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    let refund_err = |f: &Fixture| {
        sign_as(
            f,
            &f.alice,
            "refund",
            (f.campaign_id, f.alice.clone()).into_val(&f.env),
        );
        f.client.try_refund(&f.campaign_id, &f.alice).is_err()
    };
    assert!(refund_err(&f), "active campaign must not refund");

    past_deadline(&f.env);
    sign_as(
        &f,
        &f.alice,
        "refund",
        (f.campaign_id, f.alice.clone()).into_val(&f.env),
    );
    f.client.refund(&f.campaign_id, &f.alice);
    assert_sole_signer(&f, &f.alice, "refund");
    assert_eq!(balance(&f, &f.alice), 10_000);
    assert!(refund_err(&f), "a second refund has nothing to return");

    let funded = fixture();
    funded
        .client
        .contribute(&funded.campaign_id, &funded.alice, &funded.token, &TARGET);
    past_deadline(&funded.env);
    assert!(refund_err(&funded), "funded campaigns cannot be refunded");
    assert_eq!(balance(&funded, &funded.client.address), TARGET);
}

#[test]
fn signed_refund_on_a_canceled_campaign_works_before_the_deadline() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    f.client.cancel_campaign(&f.campaign_id, &f.creator);

    sign_as(
        &f,
        &f.alice,
        "refund",
        (f.campaign_id, f.alice.clone()).into_val(&f.env),
    );
    f.client.refund(&f.campaign_id, &f.alice);
    assert_sole_signer(&f, &f.alice, "refund");
    assert_eq!(balance(&f, &f.alice), 10_000);
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
}

#[test]
#[should_panic(expected = "contributor cannot be the vault contract")]
fn refund_rejects_the_vault_as_contributor() {
    let f = fixture();
    past_deadline(&f.env);
    let vault = f.client.address.clone();
    f.client.refund(&f.campaign_id, &vault);
}

// --- cancel_campaign opens refunds, so only the creator may call it ----------------

#[test]
fn cancel_campaign_without_signature_fails_and_keeps_refunds_closed() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
    enforce_no_signatures(&f);

    assert_auth_failure("unsigned cancel", || {
        f.client.cancel_campaign(&f.campaign_id, &f.creator)
    });
    assert!(!f.client.get_campaign(&f.campaign_id).canceled);
}

#[test]
fn cancel_campaign_signed_by_a_contributor_or_the_admin_is_rejected() {
    // A contributor (or the admin) cancelling would let refunds start early.
    for signer in ["alice", "admin"] {
        let f = fixture();
        f.client
            .contribute(&f.campaign_id, &f.alice, &f.token, &PLEDGE);
        let who = if signer == "alice" {
            f.alice.clone()
        } else {
            f.admin.clone()
        };
        sign_as(
            &f,
            &who,
            "cancel_campaign",
            (f.campaign_id, f.creator.clone()).into_val(&f.env),
        );
        assert_auth_failure(signer, || {
            f.client.cancel_campaign(&f.campaign_id, &f.creator)
        });
        assert!(!f.client.get_campaign(&f.campaign_id).canceled, "{signer}");

        // Naming themselves as the creator gets past auth but not the
        // creator check.
        f.env.mock_all_auths();
        assert!(f.client.try_cancel_campaign(&f.campaign_id, &who).is_err());
        assert!(!f.client.get_campaign(&f.campaign_id).canceled, "{signer}");
    }
}
