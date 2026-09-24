#![cfg(feature = "integration")]

use std::process::Command;
use std::env;

/// This test invokes the `contracts/scripts/integration_testnet.sh` script which
/// performs a full deploy + campaign lifecycle against the configured Soroban
/// RPC endpoint. The script requires the following environment variables:
/// - `TESTNET_SECRET_KEY` : funded Stellar secret key used for deploying and signing txs
/// - `SOROBAN_RPC_URL` : RPC endpoint (e.g. https://soroban-testnet.stellar.org:443)
/// - `NETWORK_PASSPHRASE` : optional, defaults to Test SDF Network ; September 2015
#[test]
fn integration_testnet_full_flow() {
    let script_path = concat!(env!("CARGO_MANIFEST_DIR"), "/scripts/integration_testnet.sh");

    // Ensure environment variables exist before running the (long) integration script
    let secret = env::var("TESTNET_SECRET_KEY").expect("TESTNET_SECRET_KEY must be set to run integration tests");
    let rpc = env::var("SOROBAN_RPC_URL").expect("SOROBAN_RPC_URL must be set to run integration tests");
    let _pass = env::var("NETWORK_PASSPHRASE").unwrap_or_else(|_| String::from("Test SDF Network ; September 2015"));

    // Make the script executable and run it, capturing output for CI logs
    let mut cmd = Command::new("bash");
    cmd.arg(script_path);
    // Forward environment explicitly to the script to avoid surprises
    cmd.env("TESTNET_SECRET_KEY", secret);
    cmd.env("SOROBAN_RPC_URL", rpc);

    let output = cmd.output().expect("failed to spawn integration script");

    println!("=== integration script stdout ===\n{}", String::from_utf8_lossy(&output.stdout));
    eprintln!("=== integration script stderr ===\n{}", String::from_utf8_lossy(&output.stderr));

    assert!(output.status.success(), "integration script failed");
}
