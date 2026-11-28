//! Isolated Soroban regression coverage for SGV-2026-130 (#1510), the test
//! counterpart of SGV-2026-128 (#1508).
//!
//! Every test deploys its own vault, Stellar asset token, campaign and
//! contributors, and drives the public client exactly like a real caller. That
//! keeps the assertions about authorization, vote uniqueness, balances and
//! events independent of the in-crate fixtures in `src/test.rs`.
//!
//! Note: soroban-sdk keeps only the most recent invocation's event log, so each
//! event assertion runs immediately after the call it describes and before the
//! next client call.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::ScVal,
    Address, Env, FromVal, IntoVal, String, Symbol,
};
use stellar_goal_vault::{
    DeadlineExtended, ExtensionApproved, ExtensionRequested, StellarGoalVaultContract,
    StellarGoalVaultContractClient,
};

const DEADLINE_OFFSET: u64 = 1_000;
const MAX_CAMPAIGN_DURATION_SECONDS: u64 = 60 * 60 * 24 * 180;

fn deploy(env: &Env) -> StellarGoalVaultContractClient<'_> {
    let contract_id = env.register(StellarGoalVaultContract, ());
    StellarGoalVaultContractClient::new(env, &contract_id)
}

fn deploy_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token_id).mint(recipient, &amount);
    token_id
}

fn create_campaign(
    env: &Env,
    client: &StellarGoalVaultContractClient<'_>,
    creator: &Address,
    token: &Address,
) -> u64 {
    client.create_campaign(
        creator,
        &soroban_sdk::vec![env, token.clone()],
        &5_000_i128,
        &(env.ledger().timestamp() + DEADLINE_OFFSET),
        &String::from_str(env, "deadline extension regression"),
        &0_i128,
        &soroban_sdk::vec![env],
        &0_u32,
    )
}

fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    TokenClient::new(env, token).balance(who)
}

/// Events with topics ("Goal", `name`) from the most recent contract call, as
/// (position among that call's events, payload). Position proves ordering.
fn goal_events(env: &Env, name: Symbol) -> std::vec::Vec<(usize, ScVal)> {
    let topics_vec: soroban_sdk::Vec<soroban_sdk::Val> =
        (symbol_short!("Goal"), name).into_val(env);
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

#[test]
fn one_valid_extension_commits_with_auditable_unique_votes() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let voters = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let token = deploy_token(&env, &admin, &voters[0], 1_000);
    let minter = StellarAssetClient::new(&env, &token);
    for voter in voters.iter().skip(1) {
        minter.mint(voter, &1_000);
    }

    let client = deploy(&env);
    let campaign_id = create_campaign(&env, &client, &creator, &token);
    for voter in voters.iter() {
        client.contribute(&campaign_id, voter, &token, &100);
    }
    assert_eq!(client.get_contributor_count(&campaign_id), 4);

    let initial_deadline = client.get_campaign(&campaign_id).deadline;
    let vault_before = balance(&env, &token, &client.address);
    let balances_before: [i128; 4] =
        core::array::from_fn(|i| balance(&env, &token, &voters[i]));
    assert_eq!(vault_before, 400);

    let new_deadline = initial_deadline + 500;
    client.request_deadline_extension(&campaign_id, &voters[0], &new_deadline);

    let requests = goal_events(&env, symbol_short!("ExtReq"));
    let approvals = goal_events(&env, symbol_short!("ExtAppr"));
    assert_eq!(requests.len(), 1, "exactly one request event");
    assert_eq!(approvals.len(), 1, "requester auto-approval is reported");
    assert!(requests[0].0 < approvals[0].0, "request precedes approval");
    let expected_request: soroban_sdk::Val = ExtensionRequested {
        campaign_id,
        requested_by: voters[0].clone(),
        new_deadline,
    }
    .into_val(&env);
    assert_eq!(requests[0].1, ScVal::from_val(&env, &expected_request));
    let expected_auto_approval: soroban_sdk::Val = ExtensionApproved {
        campaign_id,
        approver: voters[0].clone(),
        approval_count: 1,
    }
    .into_val(&env);
    assert_eq!(
        approvals[0].1,
        ScVal::from_val(&env, &expected_auto_approval)
    );

    // 2 of 4 is exactly 50% and must not commit the extension.
    client.approve_extension(&campaign_id, &voters[1]);
    assert_eq!(
        client.get_campaign(&campaign_id).deadline,
        initial_deadline
    );
    assert_eq!(client.get_extension_request(&campaign_id).unwrap().approval_count, 2);
    assert!(goal_events(&env, symbol_short!("Extended")).is_empty());

    // 3 of 4 is the smallest strict majority: it commits exactly one extension.
    client.approve_extension(&campaign_id, &voters[2]);
    let approvals = goal_events(&env, symbol_short!("ExtAppr"));
    let extended = goal_events(&env, symbol_short!("Extended"));
    assert_eq!(approvals.len(), 1);
    assert_eq!(extended.len(), 1);
    assert!(approvals[0].0 < extended[0].0);
    let expected_approval: soroban_sdk::Val = ExtensionApproved {
        campaign_id,
        approver: voters[2].clone(),
        approval_count: 3,
    }
    .into_val(&env);
    assert_eq!(approvals[0].1, ScVal::from_val(&env, &expected_approval));
    let expected_extension: soroban_sdk::Val = DeadlineExtended {
        campaign_id,
        old_deadline: initial_deadline,
        new_deadline,
    }
    .into_val(&env);
    assert_eq!(extended[0].1, ScVal::from_val(&env, &expected_extension));

    assert_eq!(client.get_campaign(&campaign_id).deadline, new_deadline);
    assert!(client.get_extension_request(&campaign_id).is_none());
    assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 400);

    // A settled round moves no funds: only the deadline changed.
    assert_eq!(balance(&env, &token, &client.address), vault_before);
    for (i, voter) in voters.iter().enumerate() {
        assert_eq!(balance(&env, &token, voter), balances_before[i]);
    }

    // Votes are cleared with the round, so the late voter is rejected and the
    // committed deadline is preserved.
    assert!(client
        .try_approve_extension(&campaign_id, &voters[3])
        .is_err());
    assert_eq!(client.get_campaign(&campaign_id).deadline, new_deadline);
}

#[test]
fn extension_votes_require_signatures_and_contributor_status() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let c1 = Address::generate(&env);
    let c2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token = deploy_token(&env, &admin, &c1, 1_000);
    StellarAssetClient::new(&env, &token).mint(&c2, &1_000);

    let client = deploy(&env);
    client.initialize(&admin, &100_i128);
    let campaign_id = create_campaign(&env, &client, &creator, &token);
    client.contribute(&campaign_id, &c1, &token, &100);
    client.contribute(&campaign_id, &c2, &token, &100);
    let initial_deadline = client.get_campaign(&campaign_id).deadline;
    let new_deadline = initial_deadline + 500;

    // No signature at all: rejected before any write.
    env.mock_auths(&[]);
    assert!(client
        .try_request_deadline_extension(&campaign_id, &c1, &new_deadline)
        .is_err());
    assert!(client.get_extension_request(&campaign_id).is_none());

    // Signed but not a contributor: creator, platform admin and an outsider
    // have no voting authority, no matter their role.
    env.mock_all_auths();
    for non_contributor in [&creator, &admin, &outsider] {
        assert!(client
            .try_request_deadline_extension(&campaign_id, non_contributor, &new_deadline)
            .is_err());
    }
    assert!(client.get_extension_request(&campaign_id).is_none());

    // A contributor's request is accepted; only one vote per contributor.
    client.request_deadline_extension(&campaign_id, &c1, &new_deadline);
    assert!(client.try_approve_extension(&campaign_id, &c1).is_err());
    let request = client.get_extension_request(&campaign_id).unwrap();
    assert_eq!(request.approval_count, 1);
    assert_eq!(request.requested_by, c1);
    assert_eq!(client.get_campaign(&campaign_id).deadline, initial_deadline);

    // Non-contributors cannot approve either.
    assert!(client.try_approve_extension(&campaign_id, &outsider).is_err());
    assert_eq!(client.get_extension_request(&campaign_id).unwrap().approval_count, 1);
}

#[test]
fn duplicate_votes_and_invalid_proposals_are_rejected_without_state_change() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let c1 = Address::generate(&env);
    let c2 = Address::generate(&env);
    let c3 = Address::generate(&env);
    let token = deploy_token(&env, &admin, &c1, 1_000);
    let minter = StellarAssetClient::new(&env, &token);
    minter.mint(&c2, &1_000);
    minter.mint(&c3, &1_000);

    let client = deploy(&env);
    let campaign_id = create_campaign(&env, &client, &creator, &token);
    for contributor in [&c1, &c2, &c3] {
        client.contribute(&campaign_id, contributor, &token, &100);
    }

    let initial_deadline = client.get_campaign(&campaign_id).deadline;
    let new_deadline = initial_deadline + 500;
    let vault_before = balance(&env, &token, &client.address);
    client.request_deadline_extension(&campaign_id, &c1, &new_deadline);

    // Duplicate vote in the same round.
    assert!(client.try_approve_extension(&campaign_id, &c1).is_err());
    assert_eq!(client.get_extension_request(&campaign_id).unwrap().approval_count, 1);

    // Stale deadline, past-cap deadline, and a second concurrent request are
    // all rejected without changing the pending tally or the campaign.
    assert!(client
        .try_request_deadline_extension(&campaign_id, &c2, &initial_deadline)
        .is_err());
    let over_max = env.ledger().timestamp() + MAX_CAMPAIGN_DURATION_SECONDS + 1;
    assert!(client
        .try_request_deadline_extension(&campaign_id, &c2, &over_max)
        .is_err());
    assert!(client
        .try_request_deadline_extension(&campaign_id, &c2, &(new_deadline + 1))
        .is_err());
    assert_eq!(client.get_campaign(&campaign_id).deadline, initial_deadline);
    assert_eq!(client.get_extension_request(&campaign_id).unwrap().approval_count, 1);

    // The round is still usable: 2 of 3 is the smallest strict majority.
    client.approve_extension(&campaign_id, &c2);
    // Capture events before any further client call: the SDK keeps only the
    // most recent invocation's log.
    assert_eq!(goal_events(&env, symbol_short!("Extended")).len(), 1);
    assert_eq!(client.get_campaign(&campaign_id).deadline, new_deadline);
    assert!(client.get_extension_request(&campaign_id).is_none());
    assert_eq!(balance(&env, &token, &client.address), vault_before);
}

#[test]
fn extension_is_rejected_once_the_campaign_is_settled() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let c1 = Address::generate(&env);
    let c2 = Address::generate(&env);
    let token = deploy_token(&env, &admin, &c1, 1_000);
    StellarAssetClient::new(&env, &token).mint(&c2, &1_000);

    let client = deploy(&env);
    let campaign_id = create_campaign(&env, &client, &creator, &token);
    client.contribute(&campaign_id, &c1, &token, &200);
    client.contribute(&campaign_id, &c2, &token, &200);
    let initial_deadline = client.get_campaign(&campaign_id).deadline;

    // A canceled campaign is settled for governance purposes: no extension can
    // be requested or approved, and the deadline stays put.
    client.cancel_campaign(&campaign_id, &creator);
    let after_cancel = env.ledger().timestamp();
    assert!(client
        .try_request_deadline_extension(&campaign_id, &c1, &(initial_deadline + 500))
        .is_err());
    assert!(client.try_approve_extension(&campaign_id, &c1).is_err());
    assert_eq!(client.get_campaign(&campaign_id).deadline, initial_deadline);
    assert!(goal_events(&env, symbol_short!("Extended")).is_empty());
    assert_eq!(env.ledger().timestamp(), after_cancel);

    // Refunds remain available to contributors, so the rejected extension
    // cannot strand their funds.
    let before = balance(&env, &token, &c1);
    client.refund(&campaign_id, &c1);
    assert_eq!(balance(&env, &token, &c1), before + 200);
    assert_eq!(client.get_campaign(&campaign_id).pledged_amount, 200);
}
