use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, FromVal, IntoVal, String, Symbol,
};

use crate::{CampaignRefunded, StellarGoalVaultContract, StellarGoalVaultContractClient};

const INITIAL_BALANCE: i128 = 1_000;
const DEADLINE: u64 = 100;

struct MultiTokenFixture {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    contributor: Address,
    token_a: Address,
    token_b: Address,
    campaign_id: u64,
}

fn multi_token_fixture() -> MultiTokenFixture {
    let env = Env::default();
    env.ledger().set_timestamp(0);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);
    let token_a = deploy_token(&env, &admin, &contributor);
    let token_b = deploy_token(&env, &admin, &contributor);
    let contract_id = env.register_contract(None, StellarGoalVaultContract);
    let client = StellarGoalVaultContractClient::new(&env, &contract_id);
    client.initialize(&admin, &1_i128);

    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, token_a.clone(), token_b.clone()],
        &1_000_i128,
        &(env.ledger().timestamp() + DEADLINE),
        &String::from_str(&env, "refund transfer rollback"),
        &0_i128,
        &soroban_sdk::vec![&env],
        &0_u32,
    );
    client.contribute(&campaign_id, &contributor, &token_a, &100_i128);
    client.contribute(&campaign_id, &contributor, &token_b, &200_i128);
    env.ledger()
        .with_mut(|ledger| ledger.timestamp += DEADLINE + 1);

    MultiTokenFixture {
        env,
        client,
        contributor,
        token_a,
        token_b,
        campaign_id,
    }
}

fn deploy_token(env: &Env, admin: &Address, contributor: &Address) -> Address {
    let token = env.register_stellar_asset_contract(admin.clone());
    StellarAssetClient::new(env, &token).mint(contributor, &INITIAL_BALANCE);
    token
}

fn set_contributor_refund_auth(f: &MultiTokenFixture) {
    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "refund",
            args: (f.campaign_id, f.contributor.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
}

fn assert_sole_signer(env: &Env, contract: &Address, expected: &Address, fn_name: &str) {
    let auths = env.auths();
    assert_eq!(auths.len(), 1, "{fn_name}: expected exactly one signer");
    let (signer, invocation) = &auths[0];
    assert_eq!(signer, expected, "{fn_name}: wrong signer");
    match &invocation.function {
        soroban_sdk::testutils::AuthorizedFunction::Contract((address, name, _)) => {
            assert_eq!(address, contract);
            assert_eq!(name, &Symbol::new(env, fn_name));
        }
        other => panic!("{fn_name}: unexpected authorization {other:?}"),
    }
}

fn refund_events(env: &Env) -> std::vec::Vec<(usize, soroban_sdk::xdr::ScVal)> {
    let topics_vec: soroban_sdk::Vec<soroban_sdk::Val> = (
        soroban_sdk::symbol_short!("Goal"),
        soroban_sdk::symbol_short!("Refund"),
    )
        .into_val(env);
    let topics: soroban_sdk::xdr::ScVec = topics_vec.into();
    env.events()
        .all()
        .events()
        .iter()
        .enumerate()
        .filter_map(|(position, event)| {
            let soroban_sdk::xdr::ContractEventBody::V0(ref body) = event.body;
            if body.topics == *topics {
                return Some((position, body.data.clone()));
            }
            None
        })
        .collect()
}

fn assert_refund_event(
    env: &Env,
    event: &soroban_sdk::xdr::ScVal,
    campaign_id: u64,
    contributor: &Address,
    token: &Address,
    amount: i128,
) {
    let expected: soroban_sdk::Val = CampaignRefunded {
        campaign_id,
        contributor: contributor.clone(),
        token: token.clone(),
        amount,
    }
    .into_val(env);
    assert_eq!(*event, soroban_sdk::xdr::ScVal::from_val(env, &expected));
}

#[test]
fn failed_later_token_transfer_rolls_back_and_retry_cannot_over_refund() {
    let f = multi_token_fixture();
    let vault = f.client.address.clone();
    let drained_to = Address::generate(&f.env);

    // Leave token B short so token A's earlier transfer fails atomically too.
    TokenClient::new(&f.env, &f.token_b).transfer(&vault, &drained_to, &150_i128);
    set_contributor_refund_auth(&f);
    assert!(
        f.client.try_refund(&f.campaign_id, &f.contributor).is_err(),
        "the underfunded second token must fail the refund"
    );
    assert!(
        refund_events(&f.env).is_empty(),
        "failed calls emit no refunds"
    );

    assert_eq!(
        TokenClient::new(&f.env, &f.token_a).balance(&f.contributor),
        900
    );
    assert_eq!(TokenClient::new(&f.env, &f.token_a).balance(&vault), 100);
    assert_eq!(
        TokenClient::new(&f.env, &f.token_b).balance(&f.contributor),
        800
    );
    assert_eq!(TokenClient::new(&f.env, &f.token_b).balance(&vault), 50);
    assert_eq!(
        TokenClient::new(&f.env, &f.token_b).balance(&drained_to),
        150
    );
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.contributor, &f.token_a),
        100
    );
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.contributor, &f.token_b),
        200
    );
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 300);

    f.env.mock_all_auths();
    StellarAssetClient::new(&f.env, &f.token_b).mint(&vault, &150_i128);
    set_contributor_refund_auth(&f);
    f.client.refund(&f.campaign_id, &f.contributor);
    assert_sole_signer(&f.env, &f.client.address, &f.contributor, "refund");

    let events = refund_events(&f.env);
    assert_eq!(
        events.len(),
        2,
        "one event for each refundable token balance; all events: {:#?}",
        f.env.events().all().events()
    );
    assert!(
        events[0].0 < events[1].0,
        "events follow accepted-token order"
    );
    assert_refund_event(
        &f.env,
        &events[0].1,
        f.campaign_id,
        &f.contributor,
        &f.token_a,
        100,
    );
    assert_refund_event(
        &f.env,
        &events[1].1,
        f.campaign_id,
        &f.contributor,
        &f.token_b,
        200,
    );
    assert_eq!(
        TokenClient::new(&f.env, &f.token_a).balance(&f.contributor),
        1_000
    );
    assert_eq!(
        TokenClient::new(&f.env, &f.token_b).balance(&f.contributor),
        1_000
    );
    assert_eq!(TokenClient::new(&f.env, &f.token_a).balance(&vault), 0);
    assert_eq!(TokenClient::new(&f.env, &f.token_b).balance(&vault), 0);
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.contributor, &f.token_a),
        0
    );
    assert_eq!(
        f.client
            .get_contribution(&f.campaign_id, &f.contributor, &f.token_b),
        0
    );
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);

    set_contributor_refund_auth(&f);
    assert!(
        f.client.try_refund(&f.campaign_id, &f.contributor).is_err(),
        "a successful refund cannot be paid twice"
    );
    assert!(
        refund_events(&f.env).is_empty(),
        "the duplicate refund emits no events"
    );
    assert_eq!(
        TokenClient::new(&f.env, &f.token_a).balance(&f.contributor),
        1_000
    );
    assert_eq!(
        TokenClient::new(&f.env, &f.token_b).balance(&f.contributor),
        1_000
    );
    assert_eq!(f.client.get_campaign(&f.campaign_id).pledged_amount, 0);
}

#[test]
fn refund_all_skips_a_contributor_already_refunded_individually() {
    let env = Env::default();
    env.ledger().set_timestamp(0);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let token = env.register_stellar_asset_contract(admin.clone());
    let token_admin = StellarAssetClient::new(&env, &token);
    token_admin.mint(&alice, &INITIAL_BALANCE);
    token_admin.mint(&bob, &INITIAL_BALANCE);

    let contract_id = env.register_contract(None, StellarGoalVaultContract);
    let client = StellarGoalVaultContractClient::new(&env, &contract_id);
    client.initialize(&admin, &1_i128);
    let campaign_id = client.create_campaign(
        &creator,
        &soroban_sdk::vec![&env, token.clone()],
        &1_000_i128,
        &(env.ledger().timestamp() + DEADLINE),
        &String::from_str(&env, "partially refunded campaign"),
        &0_i128,
        &soroban_sdk::vec![&env],
        &0_u32,
    );
    client.contribute(&campaign_id, &alice, &token, &300_i128);
    client.contribute(&campaign_id, &bob, &token, &300_i128);
    env.ledger()
        .with_mut(|ledger| ledger.timestamp += DEADLINE + 1);

    client.refund(&campaign_id, &alice);
    assert_sole_signer(&env, &client.address, &alice, "refund");
    let alice_events = refund_events(&env);
    assert_eq!(alice_events.len(), 1);
    assert_refund_event(&env, &alice_events[0].1, campaign_id, &alice, &token, 300);
    assert_eq!(
        TokenClient::new(&env, &token).balance(&alice),
        INITIAL_BALANCE
    );
    assert_eq!(client.get_contribution(&campaign_id, &alice, &token), 0);

    client.refund_all(&campaign_id);
    assert_sole_signer(&env, &client.address, &admin, "refund_all");
    let bulk_events = refund_events(&env);
    assert_eq!(
        bulk_events.len(),
        1,
        "refund_all emits only the still-refundable contributor's event"
    );
    assert_refund_event(&env, &bulk_events[0].1, campaign_id, &bob, &token, 300);
    assert_eq!(
        TokenClient::new(&env, &token).balance(&alice),
        INITIAL_BALANCE
    );
    assert_eq!(
        TokenClient::new(&env, &token).balance(&bob),
        INITIAL_BALANCE
    );
    assert_eq!(TokenClient::new(&env, &token).balance(&client.address), 0);
    assert_eq!(client.get_contribution(&campaign_id, &alice, &token), 0);
    assert_eq!(client.get_contribution(&campaign_id, &bob, &token), 0);
    assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 0);

    assert!(client.try_refund_all(&campaign_id).is_err());
    assert!(refund_events(&env).is_empty());
    assert_eq!(
        TokenClient::new(&env, &token).balance(&alice),
        INITIAL_BALANCE
    );
    assert_eq!(
        TokenClient::new(&env, &token).balance(&bob),
        INITIAL_BALANCE
    );
}
