//! Isolated Soroban regression for the deadline-extension vote (issue #1510).
//!
//! These tests deliberately live outside `src/test.rs` and build their own
//! fixtures so the voting round is exercised through the generated client the
//! same way an external caller would. Each test covers one auditable property:
//!
//! - exactly one successful extension round, with the deadline committed once;
//! - unique, reconstructable votes (`ExtensionApproved.approval_count` is the
//!   running tally after each distinct voter);
//! - signatures are required, and campaign creator/admin/outsiders are not
//!   voting members unless they pledged;
//! - token balances and escrow are unchanged by a deadline change, and neither
//!   `claim` nor `refund` can release funds around it.
//!
//! Run with `cargo test --test deadline_extension_regression`.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec,
    xdr::ScVal,
    Address, Env, FromVal, IntoVal, String, Symbol, Vec,
};
use stellar_goal_vault::{
    DeadlineExtended, ExtensionApproved, ExtensionRequested, StellarGoalVaultContract,
    StellarGoalVaultContractClient,
};

const START: u64 = 1_700_000_000;
const DAY: u64 = 86_400;
const MIN_CONTRIBUTION: i128 = 100;
const TARGET: i128 = 1_000;
const PLEDGE: i128 = 100;
const MAX_CAMPAIGN_DURATION_SECONDS: u64 = 180 * DAY;

/// A deployed vault with one four-contributor campaign. The campaign is
/// deliberately below target so settlement must remain impossible even after
/// the deadline moves.
struct Fixture {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    token: Address,
    admin: Address,
    creator: Address,
    alice: Address,
    bob: Address,
    carol: Address,
    dave: Address,
    campaign_id: u64,
    deadline: u64,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);

    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);

    let vault = env.register(StellarGoalVaultContract, ());
    let client = StellarGoalVaultContractClient::new(&env, &vault);
    client.initialize(&admin, &MIN_CONTRIBUTION);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let asset = StellarAssetClient::new(&env, &token);
    for contributor in [&alice, &bob, &carol, &dave] {
        asset.mint(contributor, &10_000);
    }

    let deadline = START + 10 * DAY;
    let campaign_id = client.create_campaign(
        &creator,
        &vec![&env, token.clone()],
        &TARGET,
        &deadline,
        &String::from_str(&env, "deadline extension regression"),
        &0,
        &Vec::new(&env),
        &0,
    );
    for contributor in [&alice, &bob, &carol, &dave] {
        client.contribute(&campaign_id, contributor, &token, &PLEDGE);
    }

    Fixture {
        env,
        client,
        token,
        admin,
        creator,
        alice,
        bob,
        carol,
        dave,
        campaign_id,
        deadline,
    }
}

impl Fixture {
    fn balances(&self) -> (i128, i128, i128, i128, i128, i128) {
        let token = TokenClient::new(&self.env, &self.token);
        (
            token.balance(&self.alice),
            token.balance(&self.bob),
            token.balance(&self.carol),
            token.balance(&self.dave),
            token.balance(&self.client.address),
            self.client.get_campaign(&self.campaign_id).pledged_amount,
        )
    }

    fn assert_nothing_moved(&self, before: (i128, i128, i128, i128, i128, i128)) {
        assert_eq!(self.balances(), before, "extension must not move funds");
        let campaign = self.client.get_campaign(&self.campaign_id);
        assert!(!campaign.claimed);
        assert!(!campaign.canceled);
    }
}

/// All events of the most recent invocation whose topics are
/// `("Goal", name)`, as `(position, data)`. The SDK keeps only the latest
/// invocation's log, so every assertion below reads it before any further
/// contract call.
fn goal_events(env: &Env, name: Symbol) -> Vec<(u32, ScVal)> {
    let topics_vec: Vec<soroban_sdk::Val> = (symbol_short!("Goal"), name).into_val(env);
    let topics: soroban_sdk::xdr::ScVec = topics_vec.into();
    let mut out = Vec::new(env);
    for (position, event) in env.events().all().events().iter().enumerate() {
        let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
        if body.topics == *topics {
            out.push_back((position as u32, body.data.clone()));
        }
    }
    out
}

fn scval(env: &Env, event: impl IntoVal<Env, soroban_sdk::Val>) -> ScVal {
    let val: soroban_sdk::Val = event.into_val(env);
    ScVal::from_val(env, &val)
}

#[test]
fn one_valid_extension_commits_with_auditable_unique_votes() {
    let f = setup();
    let before = f.balances();
    let new_deadline = f.deadline + 2 * DAY;

    f.client
        .request_deadline_extension(&f.campaign_id, &f.alice, &new_deadline);

    let requested = goal_events(&f.env, symbol_short!("ExtReq"));
    assert_eq!(requested.len(), 1);
    assert_eq!(
        requested.get(0).unwrap().1,
        scval(
            &f.env,
            ExtensionRequested {
                campaign_id: f.campaign_id,
                requested_by: f.alice.clone(),
                new_deadline,
            }
        )
    );

    // The requester auto-approves, but one vote of four is not a majority.
    let approvals = goal_events(&f.env, symbol_short!("ExtAppr"));
    assert_eq!(approvals.len(), 1);
    assert_eq!(
        approvals.get(0).unwrap().1,
        scval(
            &f.env,
            ExtensionApproved {
                campaign_id: f.campaign_id,
                approver: f.alice.clone(),
                approval_count: 1,
            }
        )
    );
    assert!(
        requested.get(0).unwrap().0 < approvals.get(0).unwrap().0,
        "request is announced first"
    );
    assert!(goal_events(&f.env, symbol_short!("Extended")).is_empty());
    assert_eq!(
        f.client.get_campaign(&f.campaign_id).deadline,
        f.deadline,
        "a single approval must not move the deadline"
    );

    // Bob is the second distinct voter; two of four still is not a majority.
    f.client.approve_extension(&f.campaign_id, &f.bob);
    let approvals = goal_events(&f.env, symbol_short!("ExtAppr"));
    assert_eq!(approvals.len(), 1);
    assert_eq!(
        approvals.get(0).unwrap().1,
        scval(
            &f.env,
            ExtensionApproved {
                campaign_id: f.campaign_id,
                approver: f.bob.clone(),
                approval_count: 2,
            }
        )
    );
    assert!(goal_events(&f.env, symbol_short!("Extended")).is_empty());
    assert_eq!(
        f.client
            .get_extension_request(&f.campaign_id)
            .unwrap()
            .approval_count,
        2
    );
    assert_eq!(f.client.get_campaign(&f.campaign_id).deadline, f.deadline);

    // Carol is the third distinct voter: exactly one commit, one Extended event.
    f.client.approve_extension(&f.campaign_id, &f.carol);
    let approvals = goal_events(&f.env, symbol_short!("ExtAppr"));
    assert_eq!(approvals.len(), 1);
    assert_eq!(
        approvals.get(0).unwrap().1,
        scval(
            &f.env,
            ExtensionApproved {
                campaign_id: f.campaign_id,
                approver: f.carol.clone(),
                approval_count: 3,
            }
        )
    );

    let extended = goal_events(&f.env, symbol_short!("Extended"));
    assert_eq!(extended.len(), 1);
    assert_eq!(
        extended.get(0).unwrap().1,
        scval(
            &f.env,
            DeadlineExtended {
                campaign_id: f.campaign_id,
                old_deadline: f.deadline,
                new_deadline,
            }
        )
    );
    assert!(
        approvals.get(0).unwrap().0 < extended.get(0).unwrap().0,
        "the approval is reported before the committed deadline"
    );

    assert!(f.client.get_extension_request(&f.campaign_id).is_none());
    assert_eq!(
        f.client.get_campaign(&f.campaign_id).deadline,
        new_deadline,
        "the committed deadline must be the requested one, applied once"
    );

    // Votes are per round: a later request starts from one approval, not four.
    let next_deadline = new_deadline + DAY;
    f.client
        .request_deadline_extension(&f.campaign_id, &f.dave, &next_deadline);
    let next = f.client.get_extension_request(&f.campaign_id).unwrap();
    assert_eq!(next.requested_by, f.dave);
    assert_eq!(next.approval_count, 1);
    assert_eq!(f.client.get_campaign(&f.campaign_id).deadline, new_deadline);

    f.assert_nothing_moved(before);
}

#[test]
fn extension_requires_signatures_and_contributor_status() {
    let f = setup();
    let before = f.balances();
    let outsider = Address::generate(&f.env);
    let new_deadline = f.deadline + DAY;

    // No signature at all: `caller.require_auth()` rejects the request.
    f.env.mock_auths(&[]);
    assert!(f
        .client
        .try_request_deadline_extension(&f.campaign_id, &f.alice, &new_deadline)
        .is_err());
    assert!(f.client.get_extension_request(&f.campaign_id).is_none());
    assert_eq!(f.client.get_campaign(&f.campaign_id).deadline, f.deadline);
    assert!(goal_events(&f.env, symbol_short!("ExtReq")).is_empty());
    f.env.mock_all_auths();
    f.assert_nothing_moved(before);

    // Signed but ineligible: creator and admin do not vote by virtue of office,
    // and an outsider never pledged.
    for caller in [&f.creator, &f.admin, &outsider] {
        assert!(
            f.client
                .try_request_deadline_extension(&f.campaign_id, caller, &new_deadline)
                .is_err(),
            "creator/admin/outsider must not request an extension without contributing"
        );
    }
    assert!(f.client.get_extension_request(&f.campaign_id).is_none());
    assert_eq!(f.client.get_campaign(&f.campaign_id).deadline, f.deadline);
    f.assert_nothing_moved(before);

    // A contributor can open the round; approving still needs a signature...
    f.client
        .request_deadline_extension(&f.campaign_id, &f.alice, &new_deadline);
    f.env.mock_auths(&[]);
    assert!(f
        .client
        .try_approve_extension(&f.campaign_id, &f.bob)
        .is_err());
    assert!(goal_events(&f.env, symbol_short!("ExtAppr")).is_empty());
    assert!(goal_events(&f.env, symbol_short!("Extended")).is_empty());
    f.env.mock_all_auths();

    // ...and contributor status, regardless of role.
    for caller in [&f.creator, &f.admin, &outsider] {
        assert!(
            f.client
                .try_approve_extension(&f.campaign_id, caller)
                .is_err(),
            "non-contributors must not vote on a deadline extension"
        );
    }

    let request = f.client.get_extension_request(&f.campaign_id).unwrap();
    assert_eq!(request.approval_count, 1, "rejected votes must not count");
    assert_eq!(f.client.get_campaign(&f.campaign_id).deadline, f.deadline);
    f.assert_nothing_moved(before);
}

#[test]
fn duplicate_votes_and_invalid_deadlines_are_rejected_without_state_change() {
    let f = setup();
    let before = f.balances();
    let new_deadline = f.deadline + DAY;

    f.client
        .request_deadline_extension(&f.campaign_id, &f.alice, &new_deadline);
    f.client.approve_extension(&f.campaign_id, &f.bob);
    assert_eq!(
        f.client
            .get_extension_request(&f.campaign_id)
            .unwrap()
            .approval_count,
        2
    );

    // A contributor may vote once per round.
    assert!(f
        .client
        .try_approve_extension(&f.campaign_id, &f.bob)
        .is_err());
    assert_eq!(
        f.client
            .get_extension_request(&f.campaign_id)
            .unwrap()
            .approval_count,
        2
    );
    assert!(goal_events(&f.env, symbol_short!("ExtAppr")).is_empty());
    assert!(goal_events(&f.env, symbol_short!("Extended")).is_empty());

    // One pending request per campaign.
    assert!(f
        .client
        .try_request_deadline_extension(&f.campaign_id, &f.carol, &(new_deadline + DAY))
        .is_err());

    // The stored proposal may not be duplicated or bypass the duration cap.
    assert!(f
        .client
        .try_request_deadline_extension(&f.campaign_id, &f.carol, &f.deadline)
        .is_err());
    let beyond_max = START + MAX_CAMPAIGN_DURATION_SECONDS + DAY;
    assert!(f
        .client
        .try_request_deadline_extension(&f.campaign_id, &f.carol, &beyond_max)
        .is_err());

    let request = f.client.get_extension_request(&f.campaign_id).unwrap();
    assert_eq!(request.new_deadline, new_deadline);
    assert_eq!(request.approval_count, 2);
    assert_eq!(f.client.get_campaign(&f.campaign_id).deadline, f.deadline);
    f.assert_nothing_moved(before);

    // The round still commits normally after those rejections.
    f.client.approve_extension(&f.campaign_id, &f.dave);
    let extended = goal_events(&f.env, symbol_short!("Extended"));
    assert_eq!(extended.len(), 1);
    assert_eq!(
        extended.get(0).unwrap().1,
        scval(
            &f.env,
            DeadlineExtended {
                campaign_id: f.campaign_id,
                old_deadline: f.deadline,
                new_deadline,
            }
        )
    );
    assert!(f.client.get_extension_request(&f.campaign_id).is_none());

    // Moving the deadline does not unlock escrow: the campaign is still below
    // target and the new deadline has not passed.
    assert!(f.client.try_claim(&f.campaign_id, &f.creator).is_err());
    assert!(f.client.try_refund(&f.campaign_id, &f.alice).is_err());
    f.assert_nothing_moved(before);
}

#[test]
fn extension_is_rejected_once_the_campaign_is_settled() {
    let f = setup();
    let before = f.balances();
    let new_deadline = f.deadline + DAY;
    f.client
        .request_deadline_extension(&f.campaign_id, &f.alice, &new_deadline);

    // Cancel the campaign: settlement state must win over a pending vote.
    f.client.cancel_campaign(&f.campaign_id, &f.creator);

    assert!(f
        .client
        .try_approve_extension(&f.campaign_id, &f.bob)
        .is_err());
    assert!(f
        .client
        .try_request_deadline_extension(&f.campaign_id, &f.carol, &new_deadline)
        .is_err());
    assert_eq!(f.client.get_campaign(&f.campaign_id).deadline, f.deadline);
    assert!(goal_events(&f.env, symbol_short!("Extended")).is_empty());

    let token = TokenClient::new(&f.env, &f.token);
    f.client.refund(&f.campaign_id, &f.alice);
    assert_eq!(token.balance(&f.alice), before.0 + PLEDGE);
    assert_eq!(
        f.client.get_campaign(&f.campaign_id).pledged_amount,
        before.5 - PLEDGE
    );
}
