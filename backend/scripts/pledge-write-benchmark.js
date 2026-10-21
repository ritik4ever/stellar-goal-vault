/**
 * pledge-write-benchmark.js
 *
 * Focused, repeatable benchmark for the pledge write path.
 *
 * Unlike the general load test (load-test.js / ci-load-test.js), this script
 * exercises ONLY POST /api/campaigns/:id/pledges so that latency and throughput
 * numbers reflect the write path exclusively, without read traffic diluting the
 * results.
 *
 * Input size (defaults, all overridable via CLI flags):
 *   - 4 seed campaigns
 *   - 10 concurrent connections
 *   - 15 second duration
 *   - pledge amount: 5 USDC per request
 *   - campaign target amount: 10 000 000 (large enough that the cap is never hit)
 *
 * Output metrics (printed to stdout):
 *   - Latency percentiles: p50, p90, p97.5, p99, max (ms)
 *   - Requests: total, 2xx, non-2xx, errors, timeouts
 *   - Error rate (%)
 *   - Average requests / second
 *   - Average throughput (KiB/s)
 *   - Threshold evaluation: p99 < P99_THRESHOLD_MS, error rate < ERROR_RATE_THRESHOLD_PCT
 *   - Machine-parseable JSON block between ---JSON-START--- / ---JSON-END--- markers
 *
 * Usage (local):
 *   npm run dev:backend   # in another terminal
 *   node backend/scripts/pledge-write-benchmark.js
 *   node backend/scripts/pledge-write-benchmark.js --connections 20 --duration 30
 *
 * Usage (CI / manual workflow):
 *   See .github/workflows/pledge-write-benchmark.yml
 */

"use strict";

const autocannon = require("autocannon");

// ---------------------------------------------------------------------------
// Defaults — document the canonical input size here so the benchmark is
// reproducible across runs and machines.
// ---------------------------------------------------------------------------
const DEFAULTS = {
  baseUrl: "http://127.0.0.1:3001",
  connections: 10,
  duration: 15,
  timeout: 10,
  campaigns: 4,
  pledgeAmount: 5,
  targetAmount: 10_000_000, // large cap so the funding ceiling is never hit
  assetCode: "USDC",
  deadlineHours: 24,
};

// CI thresholds — fail fast if the write path degrades beyond these values.
const P99_THRESHOLD_MS = 500;
const ERROR_RATE_THRESHOLD_PCT = 1;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseNumber(value, fallback, flagName) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flagName}: "${value}"`);
  }
  return parsed;
}

function parseArgs(argv) {
  const config = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--base-url":
        config.baseUrl = next;
        i += 1;
        break;
      case "--connections":
        config.connections = parseNumber(next, config.connections, "--connections");
        i += 1;
        break;
      case "--duration":
        config.duration = parseNumber(next, config.duration, "--duration");
        i += 1;
        break;
      case "--timeout":
        config.timeout = parseNumber(next, config.timeout, "--timeout");
        i += 1;
        break;
      case "--campaigns":
        config.campaigns = parseNumber(next, config.campaigns, "--campaigns");
        i += 1;
        break;
      case "--pledge-amount":
        config.pledgeAmount = parseNumber(next, config.pledgeAmount, "--pledge-amount");
        i += 1;
        break;
      case "--target-amount":
        config.targetAmount = parseNumber(next, config.targetAmount, "--target-amount");
        i += 1;
        break;
      case "--asset-code":
        config.assetCode = String(next || config.assetCode).toUpperCase();
        i += 1;
        break;
      case "--deadline-hours":
        config.deadlineHours = parseNumber(next, config.deadlineHours, "--deadline-hours");
        i += 1;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return config;
}

function printHelp() {
  console.log(`
Pledge write path benchmark — POST /api/campaigns/:id/pledges only.

Options:
  --base-url <url>          Backend URL (default: ${DEFAULTS.baseUrl})
  --connections <number>    Concurrent connections (default: ${DEFAULTS.connections})
  --duration <seconds>      Test duration in seconds (default: ${DEFAULTS.duration})
  --timeout <seconds>       Request timeout in seconds (default: ${DEFAULTS.timeout})
  --campaigns <number>      Number of seed campaigns (default: ${DEFAULTS.campaigns})
  --pledge-amount <number>  Amount per pledge request (default: ${DEFAULTS.pledgeAmount})
  --target-amount <number>  Campaign target amount (default: ${DEFAULTS.targetAmount})
  --asset-code <code>       Asset code for pledges (default: ${DEFAULTS.assetCode})
  --deadline-hours <hours>  Campaign deadline offset in hours (default: ${DEFAULTS.deadlineHours})
  --help                    Show this message

Thresholds (hardcoded):
  p99 latency  < ${P99_THRESHOLD_MS} ms
  Error rate   < ${ERROR_RATE_THRESHOLD_PCT} %
`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a deterministic Stellar-like account ID from a seed string.
 * No real keys are created — these are synthetic identifiers only.
 */
function createStellarLikeAccount(seed) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalizedSeed = String(seed)
    .toUpperCase()
    .split("")
    .filter((c) => alphabet.includes(c))
    .join("");
  let body = normalizedSeed;
  while (body.length < 55) {
    body += alphabet[body.length % alphabet.length];
  }
  return `G${body.slice(0, 55)}`;
}

async function requestJson(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method || "GET"} ${path} → HTTP ${response.status}: ${body}`);
  }
  return response.json();
}

async function waitForHealthyBackend(baseUrl) {
  try {
    await requestJson(baseUrl, "/api/health");
  } catch (err) {
    throw new Error(
      `Backend not reachable at ${baseUrl}. Start it with "npm run dev:backend" first.\n${err.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Seed campaigns
// ---------------------------------------------------------------------------
async function seedCampaigns(config) {
  const now = Date.now();
  const deadline = Math.floor(now / 1000) + Math.floor(config.deadlineHours * 3600);
  const campaigns = [];

  for (let i = 0; i < config.campaigns; i += 1) {
    const payload = {
      creator: createStellarLikeAccount(`BENCHCREATOR${i}`),
      title: `Pledge Benchmark Campaign ${now}-${i}`,
      description: "Synthetic campaign used by the pledge write path benchmark.",
      acceptedTokens: [config.assetCode],
      targetAmount: config.targetAmount,
      deadline,
    };
    const response = await requestJson(config.baseUrl, "/api/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    campaigns.push(response.data);
  }

  return campaigns;
}

// ---------------------------------------------------------------------------
// Build autocannon request list — pledge writes only, round-robin campaigns,
// deterministic contributor IDs so results are not polluted by per-contributor
// limit enforcement.
// ---------------------------------------------------------------------------
function buildPledgeRequests(config, campaigns) {
  // Generate enough distinct contributors for one full rotation across all
  // connections so the per-contributor cap never fires even at high concurrency.
  const distinctContributors = Math.max(config.connections * 2, 20);

  return campaigns.map((campaign, ci) => ({
    method: "POST",
    path: `/api/campaigns/${campaign.id}/pledges`,
    headers: { "content-type": "application/json" },
    // autocannon rotates through the requests array; each entry uses a
    // deterministic contributor so the target amount cap is never hit.
    body: JSON.stringify({
      contributor: createStellarLikeAccount(`BENCHPLEDGER${ci}-${(ci * 7) % distinctContributors}`),
      amount: config.pledgeAmount,
      assetCode: config.assetCode,
    }),
  }));
}

// ---------------------------------------------------------------------------
// Run autocannon
// ---------------------------------------------------------------------------
function runAutocannon(config, requests) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: config.baseUrl,
        connections: config.connections,
        duration: config.duration,
        timeout: config.timeout,
        pipelining: 1,
        requests,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );

    autocannon.track(instance, {
      renderProgressBar: true,
      renderLatencyTable: true,
      renderResultsTable: true,
    });
  });
}

// ---------------------------------------------------------------------------
// Print & threshold check
// ---------------------------------------------------------------------------
function formatFixed(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function printResults(config, campaigns, result) {
  const successful = Math.max(0, result["2xx"] || 0);
  const failed = (result.non2xx || 0) + (result.errors || 0) + (result.timeouts || 0);
  const total = successful + failed;
  const errorRate = total === 0 ? 0 : (failed / total) * 100;
  const p99 = result.latency.p99;

  console.log("\n=== Pledge Write Path Benchmark ===");
  console.log("\nInput size");
  console.log(`  base URL:         ${config.baseUrl}`);
  console.log(`  connections:      ${config.connections}`);
  console.log(`  duration:         ${config.duration}s`);
  console.log(`  seed campaigns:   ${campaigns.length}`);
  console.log(`  pledge amount:    ${config.pledgeAmount} ${config.assetCode}`);
  console.log(`  campaign target:  ${config.targetAmount} ${config.assetCode}`);

  console.log("\nLatency percentiles (ms)");
  console.log(`  p50:    ${formatFixed(result.latency.p50)}`);
  console.log(`  p90:    ${formatFixed(result.latency.p90)}`);
  console.log(`  p97.5:  ${formatFixed(result.latency.p97_5)}`);
  console.log(`  p99:    ${formatFixed(p99)}`);
  console.log(`  max:    ${formatFixed(result.latency.max)}`);

  console.log("\nRequest summary");
  console.log(`  total:       ${total}`);
  console.log(`  2xx:         ${successful}`);
  console.log(`  non-2xx:     ${result.non2xx || 0}`);
  console.log(`  errors:      ${result.errors || 0}`);
  console.log(`  timeouts:    ${result.timeouts || 0}`);
  console.log(`  error rate:  ${formatFixed(errorRate)}%`);
  console.log(`  avg req/s:   ${formatFixed(result.requests.average)}`);
  console.log(`  throughput:  ${formatFixed(result.throughput.average / 1024)} KiB/s`);

  const p99Pass = p99 <= P99_THRESHOLD_MS;
  const errPass = errorRate <= ERROR_RATE_THRESHOLD_PCT;
  console.log("\nThreshold evaluation");
  console.log(
    `  p99 latency: ${formatFixed(p99)}ms ${p99Pass ? "✅" : "❌"} (threshold ≤ ${P99_THRESHOLD_MS}ms)`,
  );
  console.log(
    `  error rate:  ${formatFixed(errorRate)}% ${errPass ? "✅" : "❌"} (threshold ≤ ${ERROR_RATE_THRESHOLD_PCT}%)`,
  );
  console.log(`  overall:     ${p99Pass && errPass ? "PASS ✅" : "FAIL ❌"}`);

  // Machine-parseable JSON block consumed by the CI workflow
  const summary = {
    benchmark: "pledge-write-path",
    inputSize: {
      connections: config.connections,
      durationSeconds: config.duration,
      campaigns: campaigns.length,
      pledgeAmount: config.pledgeAmount,
      assetCode: config.assetCode,
      targetAmount: config.targetAmount,
    },
    latency: {
      p50: result.latency.p50,
      p90: result.latency.p90,
      p97_5: result.latency.p97_5,
      p99,
      max: result.latency.max,
    },
    requests: {
      total,
      "2xx": successful,
      non2xx: result.non2xx || 0,
      errors: result.errors || 0,
      timeouts: result.timeouts || 0,
      errorRate,
      avgReqPerSec: result.requests.average,
      avgThroughputKiBs: result.throughput.average / 1024,
    },
    thresholds: {
      p99: { value: p99, threshold: P99_THRESHOLD_MS, pass: p99Pass },
      errorRate: { value: errorRate, threshold: ERROR_RATE_THRESHOLD_PCT, pass: errPass },
    },
    passed: p99Pass && errPass,
  };

  console.log(`\n---JSON-START---\n${JSON.stringify(summary)}\n---JSON-END---`);

  return summary.passed;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const config = parseArgs(process.argv.slice(2));

  console.log("Checking backend health…");
  await waitForHealthyBackend(config.baseUrl);

  console.log(`Seeding ${config.campaigns} campaign(s)…`);
  const campaigns = await seedCampaigns(config);

  const requests = buildPledgeRequests(config, campaigns);

  console.log(
    `Running pledge write benchmark: ${config.connections} connections × ${config.duration}s…`,
  );
  const result = await runAutocannon(config, requests);
  const passed = printResults(config, campaigns, result);

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nPledge write benchmark failed: ${err.message}`);
  process.exitCode = 1;
});
