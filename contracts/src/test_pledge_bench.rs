//! Repeatable resource measurements for the pledge contract path.
//!
//! Each scenario sets up state, then meters exactly one top-level call with
//! `env.cost_estimate()`. The Soroban host meters deterministically, so the
//! same contract code and the same SDK version give the same numbers on every
//! run, on every machine. That is what lets a contributor compare a change
//! against the committed baseline in `contracts/benchmarks/pledge_baseline.tsv`.
//!
//! * The `bench_*` tests are `#[ignore]`d so the regular suite stays quiet.
//!   Run them with `scripts/bench-pledge.sh`. The script builds the release
//!   WASM, runs these tests, and diffs the output against the baseline.
//! * When `GOAL_VAULT_BENCH_WASM` points at a built `.wasm`, the vault is
//!   registered from that binary, so VM instantiation and Wasm execution are
//!   metered too. Without it, the native (Rust) contract is registered. That
//!   mode is useful for a quick look, but it under-counts instructions, so
//!   only compare results taken in the same mode (the `mode` column).
//! * The non-ignored `pledge_cost_*` tests pin the high-cost behaviour
//!   documented in `contracts/BENCHMARKS.md` as relationships between
//!   measurements, not as exact numbers, so they hold across SDK upgrades.
//!
//! Snapshot capture is disabled here so benchmarking never writes files
//! under `test_snapshots/`.

extern crate std;

use std::{format, println, string::String as StdString, vec::Vec as StdVec};

use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    token::StellarAssetClient,
    Address, Env, String, Vec,
};

use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};

const DURATION: u64 = 1_000;
const PLEDGE: i128 = 1_000;
/// Large enough that no scenario hits the campaign funding cap.
const TARGET: i128 = 1_000_000_000;
/// Mainnet limits the host enforces by default in SDK 28.
const MAINNET_TX_INSTRUCTIONS: i64 = 100_000_000;
const MAINNET_TX_WRITE_BYTES: u32 = 132 * 1024;
/// Largest campaign `refund_all` can close in one transaction: each refund
/// emits a 512-byte event and mainnet caps events at 16 KiB per transaction.
const REFUND_ALL_MAX_CONTRIBUTORS: u32 = 32;

/// One metered invocation, as written to the benchmark output.
struct Measurement {
    instructions: i64,
    mem_bytes: i64,
    read_entries: u32,
    write_entries: u32,
    write_bytes: u32,
    events_bytes: u32,
    fee_stroops: i64,
}

struct Bench {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    admin: Address,
    creator: Address,
    mode: &'static str,
}

impl Bench {
    fn new() -> Self {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        // The test Env's own CPU/memory budget also meters test-only work
        // (e.g. recording auths for `env.auths()`), which trips well before
        // a real network would. Lift it; the host still enforces the mainnet
        // per-transaction limits on every invocation, and those are the
        // limits that matter on chain.
        env.cost_estimate().budget().reset_unlimited();

        let (contract_id, mode) = match std::env::var("GOAL_VAULT_BENCH_WASM") {
            Ok(path) if !path.is_empty() => {
                let wasm = std::fs::read(&path)
                    .unwrap_or_else(|e| panic!("GOAL_VAULT_BENCH_WASM={path}: {e}"));
                (env.register(wasm.as_slice(), ()), "wasm")
            }
            _ => (env.register(StellarGoalVaultContract, ()), "native"),
        };
        let client = StellarGoalVaultContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        client.initialize(&admin, &1);

        Bench {
            env,
            client,
            admin,
            creator,
            mode,
        }
    }

    fn token(&self) -> Address {
        self.env
            .register_stellar_asset_contract_v2(self.admin.clone())
            .address()
    }

    fn funded(&self, tokens: &Vec<Address>) -> Address {
        let who = Address::generate(&self.env);
        for t in tokens.iter() {
            StellarAssetClient::new(&self.env, &t).mint(&who, &(PLEDGE * 1_000));
        }
        who
    }

    fn campaign(&self, tokens: &Vec<Address>, cap: i128) -> u64 {
        self.client.create_campaign(
            &self.creator,
            tokens,
            &TARGET,
            &(self.env.ledger().timestamp() + DURATION),
            &String::from_str(&self.env, "bench"),
            &cap,
            &Vec::new(&self.env),
            &0_u32,
        )
    }

    /// Pledges from `n` fresh contributors so later measurements see a
    /// campaign that already has `n` entries in `Contributors(id)`.
    fn add_contributors(&self, id: u64, token: &Address, n: u32) {
        let tokens = soroban_sdk::vec![&self.env, token.clone()];
        for _ in 0..n {
            let who = self.funded(&tokens);
            self.client.contribute(&id, &who, token, &PLEDGE);
        }
    }

    fn pass_deadline(&self) {
        self.env
            .ledger()
            .with_mut(|l| l.timestamp += DURATION + 1);
    }

    /// Reads the metering of the call that just ran.
    fn measure(&self) -> Measurement {
        let est = self.env.cost_estimate();
        let r = est.resources();
        Measurement {
            instructions: r.instructions,
            mem_bytes: r.mem_bytes,
            read_entries: r.memory_read_entries + r.disk_read_entries,
            write_entries: r.write_entries,
            write_bytes: r.write_bytes,
            events_bytes: r.contract_events_size_bytes,
            fee_stroops: est.fee().total,
        }
    }

    fn report(&self, scenario: &str, m: &Measurement) {
        // One machine-readable line per scenario; scripts/bench-pledge.sh
        // greps for the `BENCH\t` prefix. Columns match the baseline header.
        let line: StdVec<StdString> = [
            scenario.into(),
            self.mode.into(),
            format!("{}", m.instructions),
            format!("{}", m.mem_bytes),
            format!("{}", m.read_entries),
            format!("{}", m.write_entries),
            format!("{}", m.write_bytes),
            format!("{}", m.events_bytes),
            format!("{}", m.fee_stroops),
        ]
        .into();
        println!("BENCH\t{}", line.join("\t"));
        assert!(
            m.instructions < MAINNET_TX_INSTRUCTIONS && m.write_bytes < MAINNET_TX_WRITE_BYTES,
            "{scenario} exceeds a mainnet per-transaction limit"
        );
    }
}

// ── measurement helpers shared by the bench and the guard tests ─────────────

fn measure_first_pledge(b: &Bench, existing_contributors: u32) -> Measurement {
    let token = b.token();
    let tokens = soroban_sdk::vec![&b.env, token.clone()];
    let id = b.campaign(&tokens, 0);
    b.add_contributors(id, &token, existing_contributors);
    let who = b.funded(&tokens);
    b.client.contribute(&id, &who, &token, &PLEDGE);
    b.measure()
}

fn measure_capped_pledge(b: &Bench, token_count: u32) -> Measurement {
    let mut tokens = Vec::new(&b.env);
    for _ in 0..token_count {
        tokens.push_back(b.token());
    }
    let id = b.campaign(&tokens, TARGET);
    let who = b.funded(&tokens);
    b.client.contribute(&id, &who, &tokens.get(0).unwrap(), &PLEDGE);
    b.measure()
}

fn measure_refund_all(b: &Bench, contributors: u32) -> Measurement {
    let token = b.token();
    let tokens = soroban_sdk::vec![&b.env, token.clone()];
    let id = b.campaign(&tokens, 0);
    b.add_contributors(id, &token, contributors);
    b.pass_deadline();
    b.client.refund_all(&id);
    b.measure()
}

// ── benchmarks (run via scripts/bench-pledge.sh) ────────────────────────────

#[test]
#[ignore = "benchmark: run with scripts/bench-pledge.sh"]
fn bench_create_campaign() {
    let b = Bench::new();
    let tokens = soroban_sdk::vec![&b.env, b.token()];
    b.campaign(&tokens, 0);
    b.report("create_campaign_1_token", &b.measure());

    let mut tokens = Vec::new(&b.env);
    for _ in 0..crate::MAX_ACCEPTED_TOKENS {
        tokens.push_back(b.token());
    }
    b.campaign(&tokens, 0);
    b.report("create_campaign_10_tokens", &b.measure());
}

#[test]
#[ignore = "benchmark: run with scripts/bench-pledge.sh"]
fn bench_contribute() {
    let b = Bench::new();
    b.report("contribute_first_pledge", &measure_first_pledge(&b, 0));

    let b = Bench::new();
    let token = b.token();
    let tokens = soroban_sdk::vec![&b.env, token.clone()];
    let id = b.campaign(&tokens, 0);
    let who = b.funded(&tokens);
    b.client.contribute(&id, &who, &token, &PLEDGE);
    b.client.contribute(&id, &who, &token, &PLEDGE);
    b.report("contribute_repeat_pledge", &b.measure());

    let b = Bench::new();
    b.report("contribute_capped_1_token", &measure_capped_pledge(&b, 1));
    let b = Bench::new();
    b.report("contribute_capped_10_tokens", &measure_capped_pledge(&b, 10));
}

#[test]
#[ignore = "benchmark: run with scripts/bench-pledge.sh"]
fn bench_contribute_contributor_growth() {
    for n in [10_u32, 100, 400] {
        let b = Bench::new();
        let m = measure_first_pledge(&b, n);
        b.report(&format!("contribute_first_pledge_after_{n}"), &m);
    }
}

#[test]
#[ignore = "benchmark: run with scripts/bench-pledge.sh"]
fn bench_claim() {
    let b = Bench::new();
    let token = b.token();
    let tokens = soroban_sdk::vec![&b.env, token.clone()];
    let id = b.client.create_campaign(
        &b.creator,
        &tokens,
        &PLEDGE,
        &(b.env.ledger().timestamp() + DURATION),
        &String::from_str(&b.env, "bench"),
        &0_i128,
        &Vec::new(&b.env),
        &0_u32,
    );
    let who = b.funded(&tokens);
    b.client.contribute(&id, &who, &token, &PLEDGE);
    b.client.set_fee_recipient(&b.admin, &Address::generate(&b.env));
    b.pass_deadline();
    b.client.claim(&id, &b.creator);
    b.report("claim_1_token_with_fee", &b.measure());
}

#[test]
#[ignore = "benchmark: run with scripts/bench-pledge.sh"]
fn bench_refund() {
    let b = Bench::new();
    let token = b.token();
    let tokens = soroban_sdk::vec![&b.env, token.clone()];
    let id = b.campaign(&tokens, 0);
    let who = b.funded(&tokens);
    b.client.contribute(&id, &who, &token, &PLEDGE);
    b.pass_deadline();
    b.client.refund(&id, &who);
    b.report("refund_1_token", &b.measure());

    for n in [10_u32, REFUND_ALL_MAX_CONTRIBUTORS] {
        let b = Bench::new();
        let m = measure_refund_all(&b, n);
        b.report(&format!("refund_all_{n}_contributors"), &m);
    }
}

// ── guards on the documented high-cost operations ───────────────────────────

/// `contribute` rewrites the whole `Contributors(id)` vector on every
/// first-time pledge, so its write size grows linearly with the number of
/// existing contributors (see BENCHMARKS.md, "High-cost operations").
#[test]
fn pledge_cost_first_pledge_write_bytes_grow_with_contributors() {
    let small = measure_first_pledge(&Bench::new(), 0);
    let large = measure_first_pledge(&Bench::new(), 50);
    assert_eq!(small.write_entries, large.write_entries);
    // Each extra contributor adds one ScAddress (~40 bytes) to the vector.
    assert!(
        large.write_bytes >= small.write_bytes + 50 * 30,
        "expected Contributors(id) rewrite to scale: {} vs {}",
        small.write_bytes,
        large.write_bytes
    );
}

/// A repeat pledge skips the `Contributors(id)` / `HasContributed` writes.
#[test]
fn pledge_cost_repeat_pledge_is_cheaper_than_first() {
    let b = Bench::new();
    let token = b.token();
    let tokens = soroban_sdk::vec![&b.env, token.clone()];
    let id = b.campaign(&tokens, 0);
    let who = b.funded(&tokens);
    b.client.contribute(&id, &who, &token, &PLEDGE);
    let first = b.measure();
    b.client.contribute(&id, &who, &token, &PLEDGE);
    let repeat = b.measure();
    assert!(repeat.write_entries < first.write_entries);
    assert!(repeat.write_bytes < first.write_bytes);
}

/// The per-contributor cap check reads one `Contribution` entry per accepted
/// token, so capped pledges on multi-token campaigns read more entries.
#[test]
fn pledge_cost_cap_check_reads_scale_with_accepted_tokens() {
    let one = measure_capped_pledge(&Bench::new(), 1);
    let ten = measure_capped_pledge(&Bench::new(), 10);
    assert!(ten.read_entries >= one.read_entries + 9);
    assert!(ten.instructions > one.instructions);
}

/// `refund_all` emits one event per contributor, so a single call can only
/// close out [`REFUND_ALL_MAX_CONTRIBUTORS`] contributors on mainnet.
#[test]
fn pledge_cost_refund_all_fits_mainnet_at_max_contributors() {
    let m = measure_refund_all(&Bench::new(), REFUND_ALL_MAX_CONTRIBUTORS);
    assert!(m.events_bytes <= 16 * 1024);
}

/// One contributor past the ceiling breaks the mainnet event-size limit
/// (`contract events size bytes: 16896 > 16384`).
#[test]
#[should_panic(expected = "ExceededLimit")]
fn pledge_cost_refund_all_exceeds_mainnet_past_max_contributors() {
    measure_refund_all(&Bench::new(), REFUND_ALL_MAX_CONTRIBUTORS + 1);
}

/// The metering itself must be repeatable or baselines are meaningless.
#[test]
fn pledge_cost_measurements_are_deterministic() {
    let a = measure_first_pledge(&Bench::new(), 3);
    let b = measure_first_pledge(&Bench::new(), 3);
    assert_eq!(a.instructions, b.instructions);
    assert_eq!(a.mem_bytes, b.mem_bytes);
    assert_eq!(a.write_bytes, b.write_bytes);
    assert_eq!(a.fee_stroops, b.fee_stroops);
}
