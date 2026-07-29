const autocannon = require("autocannon");

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:3001",
  assetCode: "USDC",
  targetAmount: 1000000,
  pledgeAmount: 5,
  deadlineHours: 24,
};

const SLO = {
  p95: 200,
  errorRate: 0.5,
};

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
    throw new Error(`Backend is not reachable at ${baseUrl}. Start it before running the load test.\n${error.message}`);
  }
}

async function createCampaign(baseUrl) {
  const createdAt = new Date();
  const deadline = Math.floor(createdAt.getTime() / 1000) + Math.floor(DEFAULTS.deadlineHours * 3600);
  const suffix = `${createdAt.getTime()}-${Math.random().toString(36).substring(7)}`;
  const payload = {
    creator: createStellarLikeAccount(`LOADCREATOR${suffix}`),
    title: `Load Test Campaign ${suffix}`,
    description: "Synthetic campaign for advanced load test.",
    acceptedTokens: [DEFAULTS.assetCode],
    targetAmount: DEFAULTS.targetAmount,
    deadline,
  };
  const response = await requestJson(baseUrl, "/api/campaigns", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.data;
}

function runAutocannon(options) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
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

function checkSLOs(result) {
  const successfulRequests = Math.max(0, result["2xx"] || 0);
  const failedRequests = (result.non2xx || 0) + (result.errors || 0) + (result.timeouts || 0);
  const totalRequests = successfulRequests + failedRequests;
  const errorRate = totalRequests === 0 ? 0 : (failedRequests / totalRequests) * 100;
  const p95 = result.latency.p97_5; // Autocannon doesn't have exact p95 by default in track, it has p97_5, p90, etc. Wait, we can get p90, p97_5, p99. Actually p97.5 is stricter than p95. But let's use result.latency.p97_5 as p95 approximation, or autocannon does have p95? Let's check keys: it has p90, p97_5, p99. Let's just use p97_5. Actually `autocannon`'s result object has `latency.p95` if we look at `result.latency` keys, it includes p90, p97_5, p99, but maybe not p95. Let's just use p97_5 for p95 threshold. Or we can just use `result.latency.p99` or check if `p90` is < 200. Let's assume `result.latency.p97_5` is proxy for p95. No, wait, if SLO is p95 < 200ms, let's just use `result.latency.p90` and `result.latency.p97_5`.

  // Actually, Autocannon result.latency has p50, p75, p90, p97_5, p99, p99_9.
  // We will check p97.5 since it's the closest to 95 that is >= 95.
  const proxyP95 = result.latency.p97_5;
  const p95Pass = proxyP95 <= SLO.p95;
  const errorRatePass = errorRate <= SLO.errorRate;
  
  console.log(`\nSLO Check:`);
  console.log(`- p95 (using p97.5 proxy): ${formatFixed(proxyP95)}ms ${p95Pass ? "✅" : "❌"} (threshold: ${SLO.p95}ms)`);
  console.log(`- Error rate: ${formatFixed(errorRate)}% ${errorRatePass ? "✅" : "❌"} (threshold: ${SLO.errorRate}%)`);
  
  return { p95Pass, errorRatePass, totalRequests, successfulRequests, failedRequests, proxyP95, errorRate };
}

async function runScenario1(baseUrl) {
  console.log("\n--- Scenario 1: 200 concurrent pledges on same campaign ---");
  const campaign = await createCampaign(baseUrl);
  const requests = [];
  for (let i = 0; i < 200; i++) {
    requests.push({
      method: "POST",
      path: `/api/campaigns/${campaign.id}/pledges`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contributor: createStellarLikeAccount(`PLEDGER${i}`),
        amount: DEFAULTS.pledgeAmount,
      }),
    });
  }
  const result = await runAutocannon({
    url: baseUrl,
    connections: 200,
    amount: 200, // Exactly 200 requests total
    requests,
  });

  const sloResult = checkSLOs(result);
  
  // Verify no pledge corruption
  const updatedCampaign = await requestJson(baseUrl, `/api/campaigns/${campaign.id}`);
  const expectedPledged = sloResult.successfulRequests * DEFAULTS.pledgeAmount;
  console.log(`\nCorruption Check:`);
  console.log(`- Expected Pledged: ${expectedPledged}`);
  console.log(`- Actual Pledged: ${updatedCampaign.data.totalPledged}`);
  if (updatedCampaign.data.totalPledged === expectedPledged) {
    console.log("- Result: PASS ✅ (No corruption)");
  } else {
    console.log("- Result: FAIL ❌ (Data corruption detected)");
    throw new Error("Pledge corruption detected in Scenario 1");
  }
  
  if (!sloResult.p95Pass || !sloResult.errorRatePass) {
    throw new Error("SLOs breached in Scenario 1");
  }
}

async function runScenario2(baseUrl) {
  console.log("\n--- Scenario 2: Campaign creation flood (100 campaigns/second) ---");
  const deadline = Math.floor(Date.now() / 1000) + Math.floor(DEFAULTS.deadlineHours * 3600);
  const result = await runAutocannon({
    url: baseUrl,
    connections: 10,
    connectionRate: 100, // 100 requests per second total
    duration: 10, // run for 10 seconds
    requests: [{
      method: "POST",
      path: "/api/campaigns",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creator: createStellarLikeAccount("FLOODCREATOR"),
        title: "Flood Campaign",
        description: "Created during flood test.",
        acceptedTokens: [DEFAULTS.assetCode],
        targetAmount: DEFAULTS.targetAmount,
        deadline,
      })
    }]
  });

  const sloResult = checkSLOs(result);
  if (!sloResult.p95Pass || !sloResult.errorRatePass) {
    throw new Error("SLOs breached in Scenario 2");
  }
}

async function runScenario3(baseUrl) {
  console.log("\n--- Scenario 3: Mixed read/write (80% reads, 20% pledges) ---");
  const campaigns = [];
  for (let i = 0; i < 5; i++) campaigns.push(await createCampaign(baseUrl));

  const requests = [];
  let pledgeCounter = 0;
  // 80% reads
  for (let i = 0; i < 8; i++) {
    const campaign = campaigns[i % campaigns.length];
    requests.push({ method: "GET", path: `/api/campaigns/${campaign.id}` });
  }
  // 20% pledges
  for (let i = 0; i < 2; i++) {
    const campaign = campaigns[i % campaigns.length];
    requests.push({
      method: "POST",
      path: `/api/campaigns/${campaign.id}/pledges`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contributor: createStellarLikeAccount(`MIXED${pledgeCounter++}`), amount: DEFAULTS.pledgeAmount })
    });
  }

  const result = await runAutocannon({
    url: baseUrl,
    connections: 20,
    duration: 15,
    pipelining: 1,
    requests,
  });

  const sloResult = checkSLOs(result);
  if (!sloResult.p95Pass || !sloResult.errorRatePass) {
    throw new Error("SLOs breached in Scenario 3");
  }
}

async function main() {
  const baseUrl = process.argv.includes("--base-url") ? process.argv[process.argv.indexOf("--base-url") + 1] : DEFAULTS.baseUrl;
  await waitForHealthyBackend(baseUrl);
  
  console.log("Starting Advanced Load Test Scenarios...");
  
  try {
    await runScenario1(baseUrl);
    await runScenario2(baseUrl);
    await runScenario3(baseUrl);
    console.log("\nAll advanced scenarios completed successfully. ✅");
  } catch (error) {
    console.error(`\nTest failed: ${error.message}`);
    process.exit(1);
  }
}

main();
