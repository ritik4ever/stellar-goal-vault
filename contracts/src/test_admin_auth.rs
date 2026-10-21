//! Authorization on the contract configuration path (issue #913).
//!
//! The lifecycle suite runs under `mock_all_auths()`, which approves every
//! `require_auth` call. That proves the transition logic, not who may drive it.
//! These tests pin the signer side of every admin entry point:
//!
//! * **Correct signer.** An authorized call records exactly one signer — the
//!   stored admin — for that exact entry point on this contract, and the
//!   configuration change takes effect.
//! * **No signer.** The call fails and configuration is unchanged.
//! * **Wrong signer.** A valid signature from another account is rejected with
//!   the deterministic `"caller is not admin"` panic, even when that account
//!   passes its own address as the `admin` argument.
//!
//! `initialize` is the one configuration entry point with no stored admin yet;
//! it must still be signed by the address it appoints.

use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal, Symbol, Vec,
};

use crate::{Campaign, StellarGoalVaultContract, StellarGoalVaultContractClient};

struct Fixture {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    admin: Address,
}

/// Deploys the vault and, when `initialize` is true, sets `admin`.
/// Auth is fully mocked during setup only.
fn fixture_with(initialize: bool) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarGoalVaultContract, ());
    let client = StellarGoalVaultContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    if initialize {
        client.initialize(&admin, &100);
    }

    Fixture { env, client, admin }
}

fn fixture() -> Fixture {
    fixture_with(true)
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
    assert_eq!(signer, expected, "{fn_name}: authorized by the wrong address");
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

// --- set_paused -------------------------------------------------------------

#[test]
fn set_paused_requires_exactly_the_admin_signature() {
    let f = fixture();

    f.client.set_paused(&f.admin, &true);

    assert_sole_signer(&f, &f.admin, "set_paused");
    assert!(f.client.get_paused());
}

#[test]
fn set_paused_without_signature_is_rejected_and_state_unchanged() {
    let f = fixture();
    enforce_no_signatures(&f);

    assert!(
        f.client.try_set_paused(&f.admin, &true).is_err(),
        "unsigned admin call must fail"
    );
    assert!(!f.client.get_paused());
}

#[test]
#[should_panic(expected = "caller is not admin")]
fn set_paused_signed_by_non_admin_is_rejected() {
    let f = fixture();
    let attacker = Address::generate(&f.env);
    // A valid signature, but from an account that is not the stored admin.
    f.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "set_paused",
            args: (attacker.clone(), true).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    f.client.set_paused(&attacker, &true);
}

// --- set_fee ----------------------------------------------------------------

#[test]
fn set_fee_requires_exactly_the_admin_signature() {
    let f = fixture();

    f.client.set_fee(&f.admin, &250);

    assert_sole_signer(&f, &f.admin, "set_fee");
    assert_eq!(f.client.get_platform_fee_bps(), 250);
}

#[test]
fn set_fee_without_signature_is_rejected_and_state_unchanged() {
    let f = fixture();
    enforce_no_signatures(&f);

    assert!(f.client.try_set_fee(&f.admin, &250).is_err());
    assert_eq!(f.client.get_platform_fee_bps(), 50);
}

#[test]
#[should_panic(expected = "caller is not admin")]
fn set_fee_signed_by_non_admin_is_rejected() {
    let f = fixture();
    let attacker = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "set_fee",
            args: (attacker.clone(), 250_i128).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    f.client.set_fee(&attacker, &250);
}

// --- set_fee_recipient ------------------------------------------------------

#[test]
fn set_fee_recipient_requires_exactly_the_admin_signature() {
    let f = fixture();
    let recipient = Address::generate(&f.env);

    f.client.set_fee_recipient(&f.admin, &recipient);

    assert_sole_signer(&f, &f.admin, "set_fee_recipient");
    assert_eq!(f.client.get_fee_recipient().unwrap(), recipient);
}

#[test]
fn set_fee_recipient_without_signature_is_rejected_and_state_unchanged() {
    let f = fixture();
    let recipient = Address::generate(&f.env);
    enforce_no_signatures(&f);

    assert!(f.client.try_set_fee_recipient(&f.admin, &recipient).is_err());
    assert!(f.client.get_fee_recipient().is_none());
}

#[test]
#[should_panic(expected = "caller is not admin")]
fn set_fee_recipient_signed_by_non_admin_is_rejected() {
    let f = fixture();
    let attacker = Address::generate(&f.env);
    let recipient = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "set_fee_recipient",
            args: (attacker.clone(), recipient.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    f.client.set_fee_recipient(&attacker, &recipient);
}

// --- migrate ----------------------------------------------------------------

#[test]
fn migrate_requires_exactly_the_admin_signature() {
    let f = fixture();
    let old_contract_id = Address::generate(&f.env);

    f.client.migrate(
        &f.admin,
        &old_contract_id,
        &Vec::<u64>::new(&f.env),
        &Vec::<Campaign>::new(&f.env),
    );

    assert_sole_signer(&f, &f.admin, "migrate");
}

#[test]
#[should_panic(expected = "caller is not admin")]
fn migrate_signed_by_non_admin_is_rejected() {
    let f = fixture();
    let attacker = Address::generate(&f.env);
    let old_contract_id = Address::generate(&f.env);
    let source_ids = Vec::<u64>::new(&f.env);
    let campaigns = Vec::<Campaign>::new(&f.env);

    f.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "migrate",
            args: (
                attacker.clone(),
                old_contract_id.clone(),
                source_ids.clone(),
                campaigns.clone(),
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    f.client
        .migrate(&attacker, &old_contract_id, &source_ids, &campaigns);
}

// --- initialize -------------------------------------------------------------

#[test]
fn initialize_requires_the_appointed_admin_signature() {
    let f = fixture_with(false);
    enforce_no_signatures(&f);

    assert!(
        f.client.try_initialize(&f.admin, &100).is_err(),
        "unsigned initialize must fail"
    );
    assert!(
        f.client.try_get_admin().is_err(),
        "a rejected initialize must not appoint an admin"
    );
    assert!(!f.client.get_paused());
}

#[test]
#[should_panic(expected = "not initialized")]
fn config_setter_fails_before_initialize() {
    let f = fixture_with(false);

    // With auth mocked, the failure is the missing admin, not the signature:
    // configuration cannot be changed before there is an admin to authorize it.
    f.client.set_paused(&f.admin, &true);
}
