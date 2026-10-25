//! Repeatable resource benchmark for the refund contract path.
//!
//! Runs `refund` and `refund_all` against the **release WASM** (not the native
//! test build, which would skip VM instantiation and Wasm execution costs) in
//! fixed scenarios, reads the metered resources of each invocation from
//! `env.cost_estimate()`, and compares them with the committed baseline in
//! `contracts/benchmarks/refund-costs.tsv`.
//!
//! The host's cost model is deterministic, so for a given contract build and
//! SDK version every run produces identical numbers. Ignored by default
//! because it needs the WASM built first; run it with
//! `scripts/bench-refund.sh` (see `contracts/BENCHMARKS.md`).
//!
//! Environment variables:
//! * `BENCH_WASM` — WASM to measure (default: the `stellar contract build` output).
//! * `BENCH_UPDATE=1` — overwrite the baseline with this run's results.

use std::{format, fs, path::PathBuf, string::String as StdString, vec::Vec as StdVec};

use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Ledger},
    token::StellarAssetClient,
    Address, Env, String, Vec,
};

use crate::StellarGoalVaultContractClient;

const DURATION: u64 = 1_000;
const PLEDGE: i128 = 100;
/// A regression larger than this (percent, any metric) fails the run. Matches
/// the review threshold in `BENCHMARKS.md`.
const THRESHOLD_PCT: i64 = 10;

const METRICS: [&str; 9] = [
    "instructions",
    "mem_bytes",
    "disk_read_entries",
    "memory_read_entries",
    "write_entries",
    "disk_read_bytes",
    "write_bytes",
    "events_bytes",
    "fee_stroops",
];

struct Measurement {
    scenario: StdString,
    values: [i64; 9],
}

fn manifest_path(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel)
}

fn load_wasm() -> StdVec<u8> {
    let path = std::env::var("BENCH_WASM")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest_path("target/wasm32v1-none/release/stellar_goal_vault.wasm"));
    fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "release WASM not found at {}; build it with `stellar contract build` \
             or run scripts/bench-refund.sh",
            path.display()
        )
    })
}

struct Setup {
    env: Env,
    client: StellarGoalVaultContractClient<'static>,
    contributors: StdVec<Address>,
    campaign_id: u64,
}

/// Deploys the WASM, opens a campaign accepting `tokens` tokens, has each of
/// `contributors` pledge `PLEDGE` in every token, then lets the deadline pass
/// with the campaign underfunded so it is refundable.
fn setup(wasm: &[u8], contributors: u32, tokens: u32) -> Setup {
    // Benchmarks are not lifecycle tests; don't write test snapshots.
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    // The test budget accumulates across every call in an Env, so a large
    // setup would exhaust it before the measured call. Lift it: the numbers
    // reported come from per-invocation metering (`cost_estimate().resources()`),
    // and mainnet per-transaction limits are still enforced on every call.
    env.cost_estimate().budget().reset_unlimited();

    let contract_id = env.register(wasm, ());
    let client = StellarGoalVaultContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &1);

    let mut token_list = Vec::new(&env);
    for _ in 0..tokens {
        token_list.push_back(
            env.register_stellar_asset_contract_v2(admin.clone())
                .address(),
        );
    }

    let creator = Address::generate(&env);
    // Target is above everything pledged so the campaign ends underfunded.
    let target = PLEDGE * i128::from(contributors) * i128::from(tokens) + 1;
    let campaign_id = client.create_campaign(
        &creator,
        &token_list,
        &target,
        &(env.ledger().timestamp() + DURATION),
        &String::from_str(&env, "refund benchmark"),
        &0_i128,
        &Vec::new(&env),
        &0_u32,
    );

    let mut addrs = StdVec::new();
    for _ in 0..contributors {
        let contributor = Address::generate(&env);
        for token in token_list.iter() {
            StellarAssetClient::new(&env, &token).mint(&contributor, &PLEDGE);
            client.contribute(&campaign_id, &contributor, &token, &PLEDGE);
        }
        addrs.push(contributor);
    }

    env.ledger().with_mut(|l| l.timestamp += DURATION + 1);

    Setup {
        env,
        client,
        contributors: addrs,
        campaign_id,
    }
}

fn measure(env: &Env, scenario: StdString) -> Measurement {
    let r = env.cost_estimate().resources();
    let fee = env.cost_estimate().fee();
    Measurement {
        scenario,
        values: [
            r.instructions,
            r.mem_bytes,
            i64::from(r.disk_read_entries),
            i64::from(r.memory_read_entries),
            i64::from(r.write_entries),
            i64::from(r.disk_read_bytes),
            i64::from(r.write_bytes),
            i64::from(r.contract_events_size_bytes),
            fee.total,
        ],
    }
}

fn bench_refund(wasm: &[u8], tokens: u32) -> Measurement {
    let s = setup(wasm, 1, tokens);
    s.client.refund(&s.campaign_id, &s.contributors[0]);
    measure(&s.env, format!("refund/tokens={tokens}"))
}

fn bench_refund_all(wasm: &[u8], contributors: u32, tokens: u32) -> Measurement {
    let s = setup(wasm, contributors, tokens);
    s.client.refund_all(&s.campaign_id);
    measure(
        &s.env,
        format!("refund_all/contributors={contributors},tokens={tokens}"),
    )
}

/// True if `refund_all` over `contributors` single-token pledges fits within
/// the mainnet per-transaction limits the test host enforces by default.
fn refund_all_fits(wasm: &[u8], contributors: u32) -> bool {
    let s = setup(wasm, contributors, 1);
    let client = &s.client;
    let campaign_id = s.campaign_id;
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.try_refund_all(&campaign_id)
    }))
    .map_or(false, |r| matches!(r, Ok(Ok(()))))
}

/// Largest contributor count `refund_all` can process in one transaction.
fn refund_all_capacity(wasm: &[u8]) -> u32 {
    let (mut lo, mut hi) = (1_u32, 2_u32);
    while refund_all_fits(wasm, hi) {
        lo = hi;
        hi *= 2;
    }
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if refund_all_fits(wasm, mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

fn to_tsv(wasm_size: usize, capacity: u32, rows: &[Measurement]) -> StdString {
    let mut out = format!("scenario\t{}\n", METRICS.join("\t"));
    out += &format!("wasm_size_bytes\t{wasm_size}\n");
    out += &format!("refund_all_max_contributors\t{capacity}\n");
    for m in rows {
        let vals: StdVec<StdString> = m.values.iter().map(|v| format!("{v}")).collect();
        out += &format!("{}\t{}\n", m.scenario, vals.join("\t"));
    }
    out
}

/// Parses `scenario -> values` from a TSV produced by [`to_tsv`].
fn parse_tsv(tsv: &str) -> StdVec<(StdString, StdVec<i64>)> {
    tsv.lines()
        .skip(1)
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut cols = l.split('\t');
            let name = cols.next().unwrap_or_default().into();
            (name, cols.filter_map(|c| c.parse().ok()).collect())
        })
        .collect()
}

fn delta_pct(base: i64, cur: i64) -> i64 {
    if base == 0 {
        if cur == 0 {
            0
        } else {
            100
        }
    } else {
        (cur - base) * 100 / base
    }
}

#[test]
#[ignore = "needs the release WASM; run scripts/bench-refund.sh"]
fn bench_refund_path() {
    let wasm = load_wasm();

    let rows = [
        bench_refund(&wasm, 1),
        bench_refund(&wasm, 3),
        bench_refund(&wasm, 10),
        bench_refund_all(&wasm, 1, 1),
        bench_refund_all(&wasm, 10, 1),
        bench_refund_all(&wasm, 25, 1),
        bench_refund_all(&wasm, 10, 3),
    ];
    let capacity = refund_all_capacity(&wasm);
    let current = to_tsv(wasm.len(), capacity, &rows);

    let out_dir = manifest_path("target/bench");
    fs::create_dir_all(&out_dir).unwrap();
    fs::write(out_dir.join("refund-costs.tsv"), &current).unwrap();

    let baseline_path = manifest_path("benchmarks/refund-costs.tsv");
    if std::env::var("BENCH_UPDATE").as_deref() == Ok("1") {
        fs::create_dir_all(baseline_path.parent().unwrap()).unwrap();
        fs::write(&baseline_path, &current).unwrap();
        std::println!("baseline updated: {}\n\n{current}", baseline_path.display());
        return;
    }

    let baseline = match fs::read_to_string(&baseline_path) {
        Ok(b) => parse_tsv(&b),
        Err(_) => {
            std::println!(
                "no baseline at {}; current results:\n\n{current}",
                baseline_path.display()
            );
            return;
        }
    };

    // Compare every metric of every row present in both runs. For the
    // capacity row a *drop* is the regression, so its delta is negated.
    let mut regressions = StdVec::new();
    if current == fs::read_to_string(&baseline_path).unwrap_or_default() {
        std::println!(
            "refund path: identical to baseline ({})",
            baseline_path.display()
        );
        return;
    }
    std::println!("| scenario | metric | baseline | current | delta |");
    std::println!("|---|---|---:|---:|---:|");
    for (name, cur_vals) in parse_tsv(&current) {
        let Some((_, base_vals)) = baseline.iter().find(|(n, _)| *n == name) else {
            std::println!("| {name} | (new) | — | — | — |");
            continue;
        };
        for (i, (&b, &c)) in base_vals.iter().zip(cur_vals.iter()).enumerate() {
            let metric = if cur_vals.len() == 1 {
                "value"
            } else {
                METRICS[i]
            };
            let mut d = delta_pct(b, c);
            if b != c {
                std::println!("| {name} | {metric} | {b} | {c} | {d:+}% |");
            }
            if name == "refund_all_max_contributors" {
                d = -d;
            }
            if d > THRESHOLD_PCT {
                regressions.push(format!("{name} {metric}: {b} -> {c}"));
            }
        }
    }
    assert!(
        regressions.is_empty(),
        "refund path regressed more than {THRESHOLD_PCT}% (if intended, rerun \
         scripts/bench-refund.sh --update-baseline):\n{}",
        regressions.join("\n")
    );
}
