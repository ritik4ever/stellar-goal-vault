//! Boundary cases on the claim contract path (SSB-2026-191).
//!
//! `claim` is all-or-nothing: it pays out every token balance of a funded
//! campaign in one call and marks the campaign `claimed`. There is no partial
//! claim, so a "remaining" claim after a successful one is always rejected.
//! These tests pin that behaviour at the smallest amounts (one token unit, fee
//! rounding) and when a token transfer fails *after* the creator's signature
//! and every state check passed: the whole call reverts, so the campaign stays
//! claimable and no balance moves.

use soroban_sdk::{
    testutils::{Address as _, Events as _, IssuerFlags, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, String,
};

use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};

const DURATION: u64 = 1_000;

struct Fixture {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    admin: Address,
    creator: Address,
    contributor: Address,
}

/// Initialized vault with a minimum contribution of one token unit and the
/// default 50 bps fee (no fee recipient set, so no fee is taken by default).
fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarGoalVaultContract, ());
    let client = StellarGoalVaultContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &1);

    Fixture {
        creator: Address::generate(&env),
        contributor: Address::generate(&env),
        env,
        client,
        admin,
    }
}

/// Stellar asset whose issuer can revoke authorization, with `amount` minted
/// to the fixture's contributor.
fn revocable_token(f: &Fixture, amount: i128) -> Address {
    let sac = f.env.register_stellar_asset_contract_v2(f.admin.clone());
    sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    StellarAssetClient::new(&f.env, &sac.address()).mint(&f.contributor, &amount);
    sac.address()
}

/// Opens a campaign over `tokens` with `target`, pledges `pledges[i]` of
/// `tokens[i]` from the contributor, and lets the deadline pass.
fn funded_campaign(f: &Fixture, tokens: &[&Address], target: i128, pledges: &[i128]) -> u64 {
    let mut list = vec![&f.env];
    for t in tokens {
        list.push_back((*t).clone());
    }
    let id = f.client.create_campaign(
        &f.creator,
        &list,
        &target,
        &(f.env.ledger().timestamp() + DURATION),
        &String::from_str(&f.env, "claim boundary"),
        &0_i128,
        &vec![&f.env],
        &0_u32,
    );
    for (t, amount) in tokens.iter().zip(pledges) {
        f.client.contribute(&id, &f.contributor, t, amount);
    }
    id
}

fn expire(f: &Fixture) {
    f.env.ledger().with_mut(|l| l.timestamp += DURATION + 1);
}

fn balance(f: &Fixture, token: &Address, who: &Address) -> i128 {
    TokenClient::new(&f.env, token).balance(who)
}

fn vault_events(f: &Fixture) -> usize {
    f.env
        .events()
        .all()
        .filter_by_contract(&f.client.address)
        .events()
        .len()
}

// ---- one-unit claim, then the "remaining" claim ---------------------------

#[test]
fn one_unit_campaign_claims_exactly_one_unit_then_rejects_a_second_claim() {
    let f = fixture();
    let token = revocable_token(&f, 1);
    let id = funded_campaign(&f, &[&token], 1, &[1]);
    expire(&f);

    f.client.claim(&id, &f.creator);

    assert_eq!(balance(&f, &token, &f.creator), 1);
    assert_eq!(balance(&f, &token, &f.client.address), 0);
    assert_eq!(f.client.get_campaign_token_balance(&id, &token), 0);
    let campaign = f.client.get_campaign(&id);
    assert!(campaign.claimed);
    // pledged_amount is the historical total and is not reduced by claim.
    assert_eq!(campaign.pledged_amount, 1);

    // There is no remaining amount to claim: the second call is rejected
    // outright and moves nothing.
    assert!(f.client.try_claim(&id, &f.creator).is_err());
    assert_eq!(vault_events(&f), 0);
    assert_eq!(balance(&f, &token, &f.creator), 1);
    assert!(f.client.get_campaign(&id).claimed);
}

#[test]
#[should_panic(expected = "campaign already claimed")]
fn remaining_claim_after_full_claim_panics_with_stable_message() {
    let f = fixture();
    let token = revocable_token(&f, 1);
    let id = funded_campaign(&f, &[&token], 1, &[1]);
    expire(&f);

    f.client.claim(&id, &f.creator);
    f.client.claim(&id, &f.creator);
}

#[test]
fn pledges_after_claim_are_impossible_so_nothing_remains_in_the_vault() {
    let f = fixture();
    let token = revocable_token(&f, 10);
    let id = funded_campaign(&f, &[&token], 5, &[5]);
    expire(&f);
    f.client.claim(&id, &f.creator);

    // The deadline has passed and the campaign is claimed: a late pledge is
    // rejected, so no "remaining" balance can accumulate for a second claim.
    assert!(f
        .client
        .try_contribute(&id, &f.contributor, &token, &1)
        .is_err());
    assert_eq!(f.client.get_campaign_token_balance(&id, &token), 0);
    assert_eq!(balance(&f, &token, &f.client.address), 0);
}

// ---- integer fee arithmetic at the smallest amounts -----------------------

#[test]
fn fee_rounds_down_to_zero_below_one_unit_and_conserves_the_balance() {
    let f = fixture();
    let recipient = Address::generate(&f.env);
    f.client.set_fee_recipient(&f.admin, &recipient);
    // Default fee: 50 bps. fee = balance * 50 / 10_000, truncated.
    for (pledge, fee) in [(1_i128, 0_i128), (199, 0), (200, 1), (399, 1)] {
        let creator_before;
        let token = revocable_token(&f, pledge);
        let id = funded_campaign(&f, &[&token], pledge, &[pledge]);
        creator_before = balance(&f, &token, &f.creator);
        expire(&f);

        f.client.claim(&id, &f.creator);

        assert_eq!(balance(&f, &token, &recipient), fee, "fee for {pledge}");
        assert_eq!(
            balance(&f, &token, &f.creator) - creator_before,
            pledge - fee,
            "creator share for {pledge}"
        );
        assert_eq!(balance(&f, &token, &f.client.address), 0);
    }
}

#[test]
fn full_fee_sends_everything_to_the_recipient() {
    let f = fixture();
    let recipient = Address::generate(&f.env);
    f.client.set_fee_recipient(&f.admin, &recipient);
    f.client.set_fee(&f.admin, &10_000);
    let token = revocable_token(&f, 1);
    let id = funded_campaign(&f, &[&token], 1, &[1]);
    expire(&f);

    f.client.claim(&id, &f.creator);

    assert_eq!(balance(&f, &token, &recipient), 1);
    assert_eq!(balance(&f, &token, &f.creator), 0);
    assert!(f.client.get_campaign(&id).claimed);
}

#[test]
fn fee_above_100_percent_makes_claim_revert_without_touching_other_campaigns() {
    let f = fixture();
    let recipient = Address::generate(&f.env);
    f.client.set_fee_recipient(&f.admin, &recipient);
    let token = revocable_token(&f, 1_000);
    // Two campaigns share the vault's balance of `token`.
    let funded = funded_campaign(&f, &[&token], 100, &[100]);
    let other = funded_campaign(&f, &[&token], 900, &[500]);
    expire(&f);

    // `set_fee` accepts any non-negative value. At 200% the fee (200) exceeds
    // the campaign's balance (100), so the creator's share is negative and
    // the token rejects the transfer. The fee transfer that preceded it is
    // rolled back with the rest of the call.
    f.client.set_fee(&f.admin, &20_000);
    assert!(f.client.try_claim(&funded, &f.creator).is_err());

    assert!(!f.client.get_campaign(&funded).claimed);
    assert_eq!(balance(&f, &token, &recipient), 0);
    assert_eq!(balance(&f, &token, &f.creator), 0);
    assert_eq!(balance(&f, &token, &f.client.address), 600);
    assert_eq!(f.client.get_campaign_token_balance(&funded, &token), 100);
    assert_eq!(f.client.get_campaign_token_balance(&other, &token), 500);

    // Once the admin restores a valid fee, the same campaign claims normally.
    f.client.set_fee(&f.admin, &50);
    f.client.claim(&funded, &f.creator);
    assert_eq!(balance(&f, &token, &f.creator), 100);
    assert_eq!(balance(&f, &token, &f.client.address), 500);
}

// ---- transfer failing after authorization ---------------------------------

#[test]
fn deauthorized_creator_makes_claim_revert_and_stay_claimable() {
    let f = fixture();
    let token = revocable_token(&f, 100);
    let id = funded_campaign(&f, &[&token], 100, &[100]);
    expire(&f);

    // The creator signs and every contract check passes, but the issuer has
    // revoked the creator's authorization, so the payout transfer fails.
    StellarAssetClient::new(&f.env, &token).set_authorized(&f.creator, &false);
    assert!(f.client.try_claim(&id, &f.creator).is_err());

    assert!(!f.client.get_campaign(&id).claimed);
    assert_eq!(f.client.get_campaign_token_balance(&id, &token), 100);
    assert_eq!(balance(&f, &token, &f.client.address), 100);
    assert_eq!(vault_events(&f), 0);

    // After the issuer re-authorizes the creator, the claim succeeds in full.
    StellarAssetClient::new(&f.env, &token).set_authorized(&f.creator, &true);
    f.client.claim(&id, &f.creator);
    assert_eq!(balance(&f, &token, &f.creator), 100);
    assert!(f.client.get_campaign(&id).claimed);
}

#[test]
fn failure_on_a_later_token_rolls_back_earlier_token_payouts() {
    let f = fixture();
    let first = revocable_token(&f, 60);
    let second = revocable_token(&f, 40);
    let id = funded_campaign(&f, &[&first, &second], 100, &[60, 40]);
    expire(&f);

    // `first` pays out before `second` fails: the whole claim must revert, so
    // no token is paid out and both campaign balances are intact.
    StellarAssetClient::new(&f.env, &second).set_authorized(&f.creator, &false);
    assert!(f.client.try_claim(&id, &f.creator).is_err());

    assert!(!f.client.get_campaign(&id).claimed);
    assert_eq!(balance(&f, &first, &f.creator), 0);
    assert_eq!(f.client.get_campaign_token_balance(&id, &first), 60);
    assert_eq!(f.client.get_campaign_token_balance(&id, &second), 40);
    assert_eq!(vault_events(&f), 0);
}

#[test]
fn deauthorized_fee_recipient_makes_claim_revert() {
    let f = fixture();
    let recipient = Address::generate(&f.env);
    f.client.set_fee_recipient(&f.admin, &recipient);
    let token = revocable_token(&f, 1_000);
    let id = funded_campaign(&f, &[&token], 1_000, &[1_000]);
    expire(&f);

    StellarAssetClient::new(&f.env, &token).set_authorized(&recipient, &false);
    assert!(f.client.try_claim(&id, &f.creator).is_err());

    assert!(!f.client.get_campaign(&id).claimed);
    assert_eq!(balance(&f, &token, &f.creator), 0);
    assert_eq!(f.client.get_campaign_token_balance(&id, &token), 1_000);
    assert_eq!(vault_events(&f), 0);
}

#[test]
fn deauthorized_vault_makes_claim_revert() {
    let f = fixture();
    let token = revocable_token(&f, 100);
    let id = funded_campaign(&f, &[&token], 100, &[100]);
    expire(&f);

    // Freezing the vault's own balance blocks the outgoing transfer.
    StellarAssetClient::new(&f.env, &token).set_authorized(&f.client.address, &false);
    assert!(f.client.try_claim(&id, &f.creator).is_err());

    assert!(!f.client.get_campaign(&id).claimed);
    assert_eq!(balance(&f, &token, &f.client.address), 100);
    assert_eq!(f.client.get_campaign_token_balance(&id, &token), 100);
}
