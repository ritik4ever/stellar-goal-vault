//! Indexer events on the refund contract path.
//!
//! A successful `refund` emits one `("Goal", "Refund")` event per token
//! refunded, followed by exactly one `("Goal", "Refunded")` summary. A
//! successful `refund_all` emits one `("Goal", "Refund")` event per
//! contributor per token, followed by exactly one `("Goal", "RefundAll")`
//! summary. A rejected call emits nothing, so an indexer never records a
//! refund that did not happen.

use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::StellarAssetClient,
    vec, Address, Env, IntoVal, String, Symbol, Val, Vec,
};

use crate::{
    CampaignRefunded, RefundAllCompleted, RefundCompleted, StellarGoalVaultContract,
    StellarGoalVaultContractClient,
};

const TARGET: i128 = 1_000;
const DURATION: u64 = 1_000;

struct Fixture {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    creator: Address,
    alice: Address,
    bob: Address,
    token_a: Address,
    token_b: Address,
    campaign_id: u64,
}

/// Initialized vault with one two-token campaign and two funded contributors.
fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarGoalVaultContract, ());
    let client = StellarGoalVaultContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let token_a = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_b = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    for token in [&token_a, &token_b] {
        let minter = StellarAssetClient::new(&env, token);
        minter.mint(&alice, &10_000);
        minter.mint(&bob, &10_000);
    }

    client.initialize(&admin, &1);
    let campaign_id = client.create_campaign(
        &creator,
        &vec![&env, token_a.clone(), token_b.clone()],
        &TARGET,
        &(env.ledger().timestamp() + DURATION),
        &String::from_str(&env, "refund events"),
        &0_i128,
        &vec![&env],
        &0_u32,
    );

    Fixture {
        env,
        client,
        creator,
        alice,
        bob,
        token_a,
        token_b,
        campaign_id,
    }
}

fn expire(f: &Fixture) {
    f.env.ledger().with_mut(|l| l.timestamp += DURATION + 1);
}

fn topics(env: &Env, name: &str) -> Vec<Val> {
    (Symbol::new(env, "Goal"), Symbol::new(env, name)).into_val(env)
}

fn refund_event(
    f: &Fixture,
    contributor: &Address,
    token: &Address,
    amount: i128,
) -> (Address, Vec<Val>, Val) {
    (
        f.client.address.clone(),
        topics(&f.env, "Refund"),
        CampaignRefunded {
            campaign_id: f.campaign_id,
            contributor: contributor.clone(),
            token: token.clone(),
            amount,
        }
        .into_val(&f.env),
    )
}

/// Events emitted by the vault itself during the last invocation (token
/// transfer events from the asset contracts are filtered out).
fn vault_events(f: &Fixture) -> soroban_sdk::testutils::ContractEvents {
    f.env.events().all().filter_by_contract(&f.client.address)
}

#[test]
fn refund_emits_per_token_events_then_one_summary() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_a, &300);
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_b, &200);
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token_a, &100);
    expire(&f);

    f.client.refund(&f.campaign_id, &f.alice);

    assert_eq!(
        vault_events(&f),
        vec![
            &f.env,
            refund_event(&f, &f.alice, &f.token_a, 300),
            refund_event(&f, &f.alice, &f.token_b, 200),
            (
                f.client.address.clone(),
                topics(&f.env, "Refunded"),
                RefundCompleted {
                    campaign_id: f.campaign_id,
                    contributor: f.alice.clone(),
                    total_refunded: 500,
                    pledged_amount: 100,
                }
                .into_val(&f.env),
            ),
        ]
    );
}

#[test]
fn refund_on_canceled_campaign_emits_summary() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_a, &250);
    f.client.cancel_campaign(&f.campaign_id, &f.creator);

    f.client.refund(&f.campaign_id, &f.alice);

    assert_eq!(
        vault_events(&f),
        vec![
            &f.env,
            refund_event(&f, &f.alice, &f.token_a, 250),
            (
                f.client.address.clone(),
                topics(&f.env, "Refunded"),
                RefundCompleted {
                    campaign_id: f.campaign_id,
                    contributor: f.alice.clone(),
                    total_refunded: 250,
                    pledged_amount: 0,
                }
                .into_val(&f.env),
            ),
        ]
    );
}

#[test]
fn refund_all_emits_per_contributor_events_then_one_summary() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_a, &300);
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token_a, &100);
    f.client.contribute(&f.campaign_id, &f.bob, &f.token_b, &50);
    expire(&f);

    f.client.refund_all(&f.campaign_id);

    assert_eq!(
        vault_events(&f),
        vec![
            &f.env,
            refund_event(&f, &f.alice, &f.token_a, 300),
            refund_event(&f, &f.bob, &f.token_a, 100),
            refund_event(&f, &f.bob, &f.token_b, 50),
            (
                f.client.address.clone(),
                topics(&f.env, "RefundAll"),
                RefundAllCompleted {
                    campaign_id: f.campaign_id,
                    contributors_refunded: 2,
                    total_refunded: 450,
                    pledged_amount: 0,
                }
                .into_val(&f.env),
            ),
        ]
    );
}

#[test]
fn refund_all_counts_only_contributors_with_a_balance() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_a, &300);
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token_a, &100);
    expire(&f);
    // Alice already reclaimed her pledge, so refund_all only pays Bob.
    f.client.refund(&f.campaign_id, &f.alice);

    f.client.refund_all(&f.campaign_id);

    assert_eq!(
        vault_events(&f),
        vec![
            &f.env,
            refund_event(&f, &f.bob, &f.token_a, 100),
            (
                f.client.address.clone(),
                topics(&f.env, "RefundAll"),
                RefundAllCompleted {
                    campaign_id: f.campaign_id,
                    contributors_refunded: 1,
                    total_refunded: 100,
                    pledged_amount: 0,
                }
                .into_val(&f.env),
            ),
        ]
    );
}

#[test]
fn rejected_refund_emits_no_event() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_a, &300);

    // Still active: deadline not reached and not canceled.
    assert!(f.client.try_refund(&f.campaign_id, &f.alice).is_err());
    assert!(vault_events(&f).events().is_empty());

    expire(&f);
    // Bob never pledged.
    assert!(f.client.try_refund(&f.campaign_id, &f.bob).is_err());
    assert!(vault_events(&f).events().is_empty());

    // A second refund after a successful one has nothing left to pay.
    f.client.refund(&f.campaign_id, &f.alice);
    assert!(f.client.try_refund(&f.campaign_id, &f.alice).is_err());
    assert!(vault_events(&f).events().is_empty());
}

#[test]
fn rejected_refund_all_emits_no_event() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_a, &300);

    // Still active.
    assert!(f.client.try_refund_all(&f.campaign_id).is_err());
    assert!(vault_events(&f).events().is_empty());

    // Funded campaigns cannot be refunded.
    f.client
        .contribute(&f.campaign_id, &f.bob, &f.token_a, &(TARGET - 300));
    expire(&f);
    assert!(f.client.try_refund_all(&f.campaign_id).is_err());
    assert!(vault_events(&f).events().is_empty());
}

#[test]
fn rejected_refund_all_after_everyone_refunded_emits_no_event() {
    let f = fixture();
    f.client
        .contribute(&f.campaign_id, &f.alice, &f.token_a, &300);
    expire(&f);
    f.client.refund_all(&f.campaign_id);

    assert!(f.client.try_refund_all(&f.campaign_id).is_err());
    assert!(vault_events(&f).events().is_empty());
}
