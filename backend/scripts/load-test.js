const autocannon = require("autocannon");

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:3001",
  connections: 20,
  duration: 20,
  timeout: 10,
  campaigns: 8,
  readWeight: 3,
  pledgeWeight: 1,
  targetAmount: 1000000,
  pledgeAmount: 5,
  assetCode: "USDC",
  deadlineHours: 24,
};

function parseNumber(value, fallback, flagName) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flagName}: "${value}"`);
  }

  return parsed;
}

function parseNonNegativeNumber(value, fallback, flagName) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flagName}: "${value}"`);
  }

  return parsed;
}

function parseArgs(argv) {
  const config = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    switch (arg) {
      case "--base-url":
        config.baseUrl = nextValue;
        index += 1;
        break;
      case "--connections":
        config.connections = parseNumber(nextValue, config.connections, "--connections");
        index += 1;
        break;
      case "--duration":
        config.duration = parseNumber(nextValue, config.duration, "--duration");
        index += 1;
        break;
      case "--timeout":
        config.timeout = parseNumber(nextValue, config.timeout, "--timeout");
        index += 1;
        break;
      case "--campaigns":
        config.campaigns = parseNumber(nextValue, config.campaigns, "--campaigns");
        index += 1;
        break;
      case "--read-weight":
        config.readWeight = parseNonNegativeNumber(nextValue, config.readWeight, "--read-weight");
        index += 1;
        break;
      case "--pledge-weight":
        config.pledgeWeight = parseNonNegativeNumber(nextValue, config.pledgeWeight, "--pledge-weight");
        index += 1;
        break;
      case "--target-amount":
        config.targetAmount = parseNumber(nextValue, config.targetAmount, "--target-amount");
        index += 1;
        break;
      case "--pledge-amount":
        config.pledgeAmount = parseNumber(nextValue, config.pledgeAmount, "--pledge-amount");
        index += 1;
        break;
      case "--asset-code":
        config.assetCode = String(nextValue || config.assetCode).toUpperCase();
        index += 1;
        break;
      case "--deadline-hours":
        config.deadlineHours = parseNumber(nextValue, config.deadlineHours, "--deadline-hours");
        index += 1;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (config.readWeight < 1 && config.pledgeWeight < 1) {
    throw new Error("At least one of --read-weight or --pledge-weight must be greater than zero.");
  }

  return config;
}

function createStellarLikeAccount(seed) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalizedSeed = String(seed)
    .toUpperCase()
    .split("")
    .filter((character) => alphabet.includes(character))
    .join("");
  let body = normalizedSeed;

  while (body.length < 55) {
    body += alphabet[body.length % alphabet.length];
  }

  return `G${body.slice(0, 55)}`;
}

function printHelp() {
  console.log(`
Load test the local Stellar Goal Vault API.

Options:
  --base-url <url>          Backend URL (default: ${DEFAULTS.baseUrl})
  --connections <number>    Concurrent connections (default: ${DEFAULTS.connections})
  --duration <seconds>      Test duration in seconds (default: ${DEFAULTS.duration})
  --timeout <seconds>       Request timeout in seconds (default: ${DEFAULTS.timeout})
  --campaigns <number>      Number of seed campaigns to create (default: ${DEFAULTS.campaigns})
  --read-weight <number>    Relative weight for campaign reads (default: ${DEFAULTS.readWeight})
  --pledge-weight <number>  Relative weight for pledge writes (default: ${DEFAULTS.pledgeWeight})
  --target-amount <number>  Target amount for each seed campaign (default: ${DEFAULTS.targetAmount})
  --pledge-amount <number>  Amount used for each pledge request (default: ${DEFAULTS.pledgeAmount})
  --asset-code <code>       Asset code for seed campaigns (default: ${DEFAULTS.assetCode})
  --deadline-hours <hours>  Deadline offset for seed campaigns (default: ${DEFAULTS.deadlineHours})
  --help                    Show this message
`);
}

async function requestJson(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method || "GET"} ${path} failed with ${response.status}: ${body}`);
  }

  return response.json();
}

async function waitForHealthyBackend(baseUrl) {
  try {
    await requestJson(baseUrl, "/api/health");
  } catch (error) {
    throw new Error(
      `Backend is not reachable at ${baseUrl}. Start it with "npm run dev:backend" before running the load test.\n${error.message}`,
    );
  }
}

async function seedCampaigns(config) {
  const createdAt = new Date();
  const deadline = Math.floor(createdAt.getTime() / 1000) + Math.floor(config.deadlineHours * 3600);
  const campaigns = [];

  for (let index = 0; index < config.campaigns; index += 1) {
    const suffix = `${createdAt.getTime()}-${index}`;
    const payload = {
      creator: createStellarLikeAccount(`LOADCREATOR${index}`),
      title: `Load Test Campaign ${suffix}`,
      description: "Synthetic campaign used by the API load test script.",
      assetCode: config.assetCode,
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

function buildRequests(config, campaigns) {
  const requests = [];
  let pledgeCounter = 0;

  for (let index = 0; index < config.readWeight; index += 1) {
    requests.push({
      method: "GET",
      path: `/api/campaigns?page=1&limit=${Math.max(10, campaigns.length)}&asset=${encodeURIComponent(config.assetCode)}`,
    });

    const campaign = campaigns[index % campaigns.length];
    requests.push({
      method: "GET",
      path: `/api/campaigns/${campaign.id}`,
    });
  }

  for (let index = 0; index < config.pledgeWeight; index += 1) {
    const campaign = campaigns[index % campaigns.length];
    const contributor = createStellarLikeAccount(`LOADPLEDGER${pledgeCounter}`);
    pledgeCounter += 1;

    requests.push({
      method: "POST",
      path: `/api/campaigns/${campaign.id}/pledges`,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contributor,
        amount: config.pledgeAmount,
      }),
    });
  }

  return requests;
}

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
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      },
    );

    autocannon.track(instance, {
      renderProgressBar: true,
      renderLatencyTable: true,
      renderResultsTable: true,
    });
  });
}

function formatFixed(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function printSummary(config, campaigns, result) {
  const successfulRequests = Math.max(0, result["2xx"] || 0);
  const failedRequests = (result.non2xx || 0) + (result.errors || 0) + (result.timeouts || 0);
  const totalRequests = successfulRequests + failedRequests;
  const errorRate = totalRequests === 0 ? 0 : (failedRequests / totalRequests) * 100;

  console.log("\nLoad test configuration");
  console.log(`- Base URL: ${config.baseUrl}`);
  console.log(`- Connections: ${config.connections}`);
  console.log(`- Duration: ${config.duration}s`);
  console.log(`- Seed campaigns: ${campaigns.length}`);
  console.log(`- Scenario mix: ${config.readWeight} read slots / ${config.pledgeWeight} pledge slots`);

  console.log("\nLatency percentiles (ms)");
  console.log(`- p50: ${formatFixed(result.latency.p50)}`);
  console.log(`- p90: ${formatFixed(result.latency.p90)}`);
  console.log(`- p97.5: ${formatFixed(result.latency.p97_5)}`);
  console.log(`- p99: ${formatFixed(result.latency.p99)}`);
  console.log(`- max: ${formatFixed(result.latency.max)}`);

  console.log("\nRequest summary");
  console.log(`- Total requests: ${totalRequests}`);
  console.log(`- 2xx responses: ${successfulRequests}`);
  console.log(`- Non-2xx responses: ${result.non2xx || 0}`);
  console.log(`- Errors: ${result.errors || 0}`);
  console.log(`- Timeouts: ${result.timeouts || 0}`);
  console.log(`- Error rate: ${formatFixed(errorRate)}%`);
  console.log(`- Avg req/sec: ${formatFixed(result.requests.average)}`);
  console.log(`- Avg throughput: ${formatFixed(result.throughput.average / 1024)} KiB/s`);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  await waitForHealthyBackend(config.baseUrl);
  const campaigns = await seedCampaigns(config);
  const requests = buildRequests(config, campaigns);
  const result = await runAutocannon(config, requests);
  printSummary(config, campaigns, result);
}

main().catch((error) => {
  console.error(`\nLoad test failed: ${error.message}`);
  process.exitCode = 1;
});
