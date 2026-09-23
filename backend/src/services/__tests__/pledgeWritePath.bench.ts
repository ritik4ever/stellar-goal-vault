/**
 * pledgeWritePath.bench.ts
 *
 * Repeatable, in-process micro-benchmark for the pledge write path.
 *
 * Uses Vitest's built-in bench() runner so it can run without a live server,
 * without network I/O, and without external mutable data.  The database is an
 * in-memory SQLite instance that is fully seeded inside each benchmark suite.
 *
 * Documented input size (fixed — change here when intentionally altering scope):
 *   CAMPAIGNS  = 4   distinct campaigns
 *   BATCH_SIZE = 50  pledges per campaign (200 total per bench iteration)
 *   AMOUNT     = 5   USDC per pledge
 *   TARGET     = 10_000_000   (cap never reached)
 *
 * How to run locally:
 *   cd backend
 *   npx vitest bench src/services/__tests__/pledgeWritePath.bench.ts
 *
 * How to run in CI (manual dispatch or weekly schedule):
 *   See .github/workflows/pledge-write-benchmark.yml
 */

import { bench, describe, beforeAll, afterAll } from "vitest";
import { initDb, resetDbForTests } from "../db";
import { initCampaignStore, createCampaign, addPledge } from "../campaignStore";

// ---------------------------------------------------------------------------
// Deterministic synthetic accounts — no real keys generated
// ---------------------------------------------------------------------------
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function stellarId(seed: string): string {
  const norm = seed
    .toUpperCase()
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("");
  let body = norm;
  while (body.length < 55) body += ALPHABET[body.length % ALPHABET.length];
  return `G${body.slice(0, 55)}`;
}

// ---------------------------------------------------------------------------
// Fixed input size — documented here for reproducibility
// ---------------------------------------------------------------------------
const CAMPAIGNS = 4;
const BATCH_SIZE = 50; // pledges per campaign per bench iteration
const PLEDGE_AMOUNT = 5;
const TARGET_AMOUNT = 10_000_000; // large enough the cap is never hit
const ASSET_CODE = "USDC";

function makeCampaignInput(index: number) {
  return {
    creator: stellarId(`BENCHCREATOR${index}`),
    title: `Pledge Bench Campaign ${index}`,
    description: "Synthetic campaign for pledge write path benchmark.",
    acceptedTokens: [ASSET_CODE],
    targetAmount: TARGET_AMOUNT,
    deadline: Math.floor(Date.now() / 1000) + 86_400, // 24 h from now
  };
}

// ---------------------------------------------------------------------------
// Shared state set up once before all benchmarks in the suite
// ---------------------------------------------------------------------------
let campaignIds: string[] = [];

beforeAll(() => {
  // Use an isolated in-memory database — no files left on disk
  process.env.DB_PATH = ":memory:";
  initDb();
  initCampaignStore();

  campaignIds = Array.from({ length: CAMPAIGNS }, (_, i) => {
    const campaign = createCampaign(makeCampaignInput(i));
    return campaign.id;
  });
});

afterAll(() => {
  resetDbForTests();
});

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe("pledge write path — in-process SQLite", () => {
  /**
   * Sequential pledge writes: one pledge at a time, round-robin across campaigns.
   * Measures the raw throughput of the addPledge() transaction path.
   */
  bench(
    `sequential: ${CAMPAIGNS} campaigns × ${BATCH_SIZE} pledges (${CAMPAIGNS * BATCH_SIZE} total)`,
    () => {
      for (let i = 0; i < BATCH_SIZE; i += 1) {
        const campaignId = campaignIds[i % CAMPAIGNS];
        addPledge(campaignId, {
          contributor: stellarId(`BENCHPLEDGER-SEQ-${i}`),
          amount: PLEDGE_AMOUNT,
          assetCode: ASSET_CODE,
        });
      }
    },
  );

  /**
   * Concurrent pledge writes: all pledges fired as parallel promises.
   * Exercises SQLite WAL mode under concurrent write load.
   */
  bench(
    `concurrent: ${CAMPAIGNS} campaigns × ${BATCH_SIZE} pledges (${CAMPAIGNS * BATCH_SIZE} total)`,
    async () => {
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < BATCH_SIZE; i += 1) {
        const campaignId = campaignIds[i % CAMPAIGNS];
        promises.push(
          Promise.resolve().then(() =>
            addPledge(campaignId, {
              contributor: stellarId(`BENCHPLEDGER-CONC-${i}`),
              amount: PLEDGE_AMOUNT,
              assetCode: ASSET_CODE,
            }),
          ),
        );
      }
      await Promise.all(promises);
    },
  );

  /**
   * Single-campaign burst: all pledges directed at one campaign.
   * Stress-tests lock contention on a single campaign row.
   */
  bench(
    `single-campaign burst: 1 campaign × ${BATCH_SIZE * CAMPAIGNS} pledges`,
    async () => {
      const campaignId = campaignIds[0];
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < BATCH_SIZE * CAMPAIGNS; i += 1) {
        promises.push(
          Promise.resolve().then(() =>
            addPledge(campaignId, {
              contributor: stellarId(`BENCHPLEDGER-BURST-${i}`),
              amount: PLEDGE_AMOUNT,
              assetCode: ASSET_CODE,
            }),
          ),
        );
      }
      await Promise.all(promises);
    },
  );
});
