//! Repeatable resource measurements for the claim contract path.
//!
//! Same approach as `test_pledge_bench` and the same fixture: set up a
//! funded campaign past its deadline, then meter exactly one `claim` call.
//! The numbers are deterministic, so they can be compared exactly with the
//! committed baseline in `contracts/benchmarks/claim_baseline.tsv`.
//!
//! * The `bench_*` tests are `#[ignore]`d. Run them with
//!   `scripts/bench-claim.sh`, which builds the release WASM, runs them and
//!   diffs the output against the baseline.
//! * The non-ignored `claim_cost_*` tests pin the high-cost behaviour
//!   documented in `contracts/BENCHMARKS.md` as relationships between
//!   measurements, so they hold across SDK upgrades.

use soroban_sdk::{testutils::Address as _, Address, String, Vec};

use crate::test_pledge_bench::{Bench, Measurement, DURATION, PLEDGE};

/// How the platform fee is configured when the campaign is claimed.
#[derive(Clone, Copy)]
enum Fee {
    /// `set_fee(0)`: the fee mechanism is off.
    Disabled,
    /// Default 50 bps, but no recipient set, so no fee is taken.
    NoRecipient,
    /// Default 50 bps with a recipient: two transfers per token.
    Collected,
}

/// A claimable campaign: `funded_tokens` of `token_count` accepted tokens
/// each received one pledge from each of `contributors` contributors, the
/// target equals the total pledged, and the deadline has passed.
struct ClaimSetup {
    token_count: u32,
    funded_tokens: u32,
    contributors: u32,
    fee: Fee,
    co_creators: u32,
}

impl ClaimSetup {
    const fn new(token_count: u32) -> Self {
        ClaimSetup {
            token_count,
            funded_tokens: token_count,
            contributors: 1,
            fee: Fee::Collected,
            co_creators: 0,
        }
    }
}

fn measure_claim(b: &Bench, s: ClaimSetup) -> Measurement {
    let mut tokens = Vec::new(&b.env);
    for _ in 0..s.token_count {
        tokens.push_back(b.token());
    }
    let mut co_creators = Vec::new(&b.env);
    for _ in 0..s.co_creators {
        co_creators.push_back(Address::generate(&b.env));
    }
    let target = PLEDGE * (s.funded_tokens * s.contributors) as i128;
    let id = b.client.create_campaign(
        &b.creator,
        &tokens,
        &target,
        &(b.env.ledger().timestamp() + DURATION),
        &String::from_str(&b.env, "bench"),
        &0_i128,
        &co_creators,
        &s.co_creators,
    );
    for approver in co_creators.iter() {
        b.client.approve_campaign(&id, &approver);
    }
    for _ in 0..s.contributors {
        let who = b.funded(&tokens);
        for i in 0..s.funded_tokens {
            b.client
                .contribute(&id, &who, &tokens.get(i).unwrap(), &PLEDGE);
        }
    }
    match s.fee {
        Fee::Disabled => b.client.set_fee(&b.admin, &0),
        Fee::NoRecipient => {}
        Fee::Collected => b
            .client
            .set_fee_recipient(&b.admin, &Address::generate(&b.env)),
    }
    b.pass_deadline();
    b.client.claim(&id, &b.creator);
    b.measure()
}

// ── benchmarks (run via scripts/bench-claim.sh) ─────────────────────────────

#[test]
#[ignore = "benchmark: run with scripts/bench-claim.sh"]
fn bench_claim_fee_modes() {
    let cases = [
        ("claim_1_token_fee_disabled", Fee::Disabled),
        ("claim_1_token_no_fee_recipient", Fee::NoRecipient),
        ("claim_1_token_with_fee", Fee::Collected),
    ];
    for (name, fee) in cases {
        let b = Bench::new();
        let m = measure_claim(&b, ClaimSetup { fee, ..ClaimSetup::new(1) });
        b.report(name, &m);
    }
}

#[test]
#[ignore = "benchmark: run with scripts/bench-claim.sh"]
fn bench_claim_token_count() {
    let b = Bench::new();
    let m = measure_claim(&b, ClaimSetup::new(crate::MAX_ACCEPTED_TOKENS));
    b.report("claim_10_tokens_with_fee", &m);

    let b = Bench::new();
    let m = measure_claim(
        &b,
        ClaimSetup {
            fee: Fee::Disabled,
            ..ClaimSetup::new(crate::MAX_ACCEPTED_TOKENS)
        },
    );
    b.report("claim_10_tokens_fee_disabled", &m);

    let b = Bench::new();
    let m = measure_claim(
        &b,
        ClaimSetup {
            funded_tokens: 1,
            ..ClaimSetup::new(crate::MAX_ACCEPTED_TOKENS)
        },
    );
    b.report("claim_10_tokens_1_funded", &m);
}

#[test]
#[ignore = "benchmark: run with scripts/bench-claim.sh"]
fn bench_claim_campaign_shape() {
    let b = Bench::new();
    let m = measure_claim(
        &b,
        ClaimSetup {
            co_creators: 3,
            ..ClaimSetup::new(1)
        },
    );
    b.report("claim_1_token_multisig_3", &m);
}

// ── guards on the documented high-cost operations ───────────────────────────

/// `claim` iterates accepted tokens, not contributors, so a crowded campaign
/// touches the same entries and emits the same events as a single-backer one.
///
/// Instructions are deliberately not compared: the test host's storage map
/// holds every entry the test created, and lookups in a bigger map meter more
/// instructions even for unrelated entries. On chain the footprint holds only
/// the declared entries, so that growth does not happen there.
#[test]
fn claim_cost_is_independent_of_contributor_count() {
    let one = measure_claim(&Bench::new(), ClaimSetup::new(1));
    let many = measure_claim(
        &Bench::new(),
        ClaimSetup {
            contributors: 20,
            ..ClaimSetup::new(1)
        },
    );
    assert_eq!(one.read_entries, many.read_entries);
    assert_eq!(one.write_entries, many.write_entries);
    assert_eq!(one.events_bytes, many.events_bytes);
}

/// Collecting a fee adds a second transfer and a `Fee` event per token.
#[test]
fn claim_cost_fee_doubles_transfers_per_token() {
    let off = measure_claim(
        &Bench::new(),
        ClaimSetup {
            fee: Fee::Disabled,
            ..ClaimSetup::new(1)
        },
    );
    let on = measure_claim(&Bench::new(), ClaimSetup::new(1));
    assert!(on.write_entries > off.write_entries);
    assert!(on.events_bytes > off.events_bytes);
    assert!(on.instructions > off.instructions);
}

/// Every accepted token costs a balance read even when it received nothing,
/// and every funded token adds its own transfers, writes and events.
#[test]
fn claim_cost_scales_with_accepted_and_funded_tokens() {
    let single = measure_claim(&Bench::new(), ClaimSetup::new(1));
    let sparse = measure_claim(
        &Bench::new(),
        ClaimSetup {
            funded_tokens: 1,
            ..ClaimSetup::new(10)
        },
    );
    let full = measure_claim(&Bench::new(), ClaimSetup::new(10));
    assert!(sparse.read_entries >= single.read_entries + 9);
    assert_eq!(sparse.events_bytes, single.events_bytes);
    assert!(full.write_entries > sparse.write_entries);
    assert!(full.events_bytes >= 10 * single.events_bytes);
}

/// A fee-taking claim emits two events (~1 KiB) per funded token, and mainnet
/// caps events at 16 KiB per transaction. `MAX_ACCEPTED_TOKENS` (10) fits;
/// raising it above 16 would make a fully funded claim fail on chain.
#[test]
fn claim_cost_max_tokens_fit_mainnet_event_limit() {
    let one = measure_claim(&Bench::new(), ClaimSetup::new(1));
    let full = measure_claim(&Bench::new(), ClaimSetup::new(crate::MAX_ACCEPTED_TOKENS));
    assert!(full.events_bytes <= 16 * 1024);
    assert!(16 * one.events_bytes <= 16 * 1024 && 17 * one.events_bytes > 16 * 1024);
}

#[test]
fn claim_cost_measurements_are_deterministic() {
    let a = measure_claim(&Bench::new(), ClaimSetup::new(2));
    let b = measure_claim(&Bench::new(), ClaimSetup::new(2));
    assert_eq!(a.instructions, b.instructions);
    assert_eq!(a.write_bytes, b.write_bytes);
    assert_eq!(a.fee_stroops, b.fee_stroops);
    assert_eq!(a.mem_bytes, b.mem_bytes);
}
