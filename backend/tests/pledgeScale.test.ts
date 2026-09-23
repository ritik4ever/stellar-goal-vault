import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Large-dataset regression coverage for the pledge write path (issue #1005).
 *
 * Exercises `addPledge` with a realistic larger fixture (1,000 pledges across
 * 100 contributors) and asserts the accounting stays correct at scale. It also
 * records a stable performance signal: the wall-clock duration is logged and
 * bounded by a deliberately generous threshold, so the test flags algorithmic
 * regressions without asserting flaky micro-timings.
 *
 * Deterministic, in-process, no network or external mutable data.
 */

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `stellar-goal-vault-pledge-scale-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';
process.env.NODE_ENV = 'test';

const CREATOR = `G${'A'.repeat(55)}`;
const PLEDGE_COUNT = 1_000;
const CONTRIBUTOR_COUNT = 100;
const GENEROUS_BUDGET_MS = 30_000;

let store: typeof import('../src/services/campaignStore');
let dbModule: typeof import('../src/services/db');

/** Deterministic contributor address (valid 56-char G-address, unique per index). */
function contributorAddress(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const high = alphabet[Math.floor(index / alphabet.length) % alphabet.length];
  const low = alphabet[index % alphabet.length];
  return `G${high}${low}${'B'.repeat(53)}`;
}

/** Deterministic pledge amount in [10, 99]. */
function pledgeAmount(index: number): number {
  return 10 + (index % 90);
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  store = await import('../src/services/campaignStore');
  dbModule = await import('../src/services/db');
  store.initCampaignStore();
});

afterAll(() => {
  dbModule.resetDbForTests();
  try {
    fs.rmSync(TEST_DB_PATH, { force: true });
  } catch {
    // Windows can briefly hold the SQLite file handle; a leftover temp file is harmless.
  }
});

function createLargeCampaign() {
  return store.createCampaign({
    creator: CREATOR,
    title: 'Large pledge-scale campaign',
    description: 'Deterministic large fixture used to exercise the pledge write path at scale.',
    acceptedTokens: ['USDC'],
    targetAmount: 10_000_000,
    deadline: Math.floor(Date.now() / 1000) + 86_400,
  });
}

describe('pledge write path at scale', () => {
  it('keeps accounting correct for 1,000 pledges across 100 contributors', () => {
    const campaign = createLargeCampaign();
    const expectedByContributor = new Map<string, number>();
    let expectedTotal = 0;

    const startedAt = Date.now();
    for (let index = 0; index < PLEDGE_COUNT; index += 1) {
      const contributor = contributorAddress(index % CONTRIBUTOR_COUNT);
      const amount = pledgeAmount(index);
      store.addPledge(campaign.id, { contributor, amount, assetCode: 'USDC' });
      expectedByContributor.set(
        contributor,
        (expectedByContributor.get(contributor) ?? 0) + amount,
      );
      expectedTotal += amount;
    }
    const elapsedMs = Date.now() - startedAt;

    // Correctness at scale.
    const stored = store.getCampaignWithProgress(campaign.id);
    expect(stored).toBeDefined();
    expect(stored?.pledgedAmount).toBeCloseTo(expectedTotal, 2);
    expect(stored?.progress.pledgeCount).toBe(PLEDGE_COUNT);

    for (const [contributor, expected] of expectedByContributor) {
      expect(store.getContributorPledgedTotal(campaign.id, contributor)).toBeCloseTo(expected, 2);
    }

    const balances = store.getCampaignTokenBalances(campaign.id);
    expect(balances.USDC).toBeCloseTo(expectedTotal, 2);

    expect(store.getContributorSummary(campaign.id)).toHaveLength(CONTRIBUTOR_COUNT);
    expect(store.getPledges(campaign.id)).toHaveLength(PLEDGE_COUNT);

    // Stable performance signal: log measured throughput, assert a generous bound.
    const perPledge = elapsedMs / PLEDGE_COUNT;
    console.info(
      `[pledge-scale] ${PLEDGE_COUNT} pledges in ${elapsedMs}ms ` +
        `(${perPledge.toFixed(3)}ms/pledge, ${Math.round(PLEDGE_COUNT / (elapsedMs / 1000))}/s)`,
    );
    expect(elapsedMs).toBeLessThan(GENEROUS_BUDGET_MS);
  });

  it('paginates a large pledge set correctly', () => {
    const campaign = createLargeCampaign();
    for (let index = 0; index < PLEDGE_COUNT; index += 1) {
      store.addPledge(campaign.id, {
        contributor: contributorAddress(index % CONTRIBUTOR_COUNT),
        amount: pledgeAmount(index),
        assetCode: 'USDC',
      });
    }

    const firstPage = store.listCampaignPledges(campaign.id, { page: 1, limit: 50 });
    expect(firstPage.totalCount).toBe(PLEDGE_COUNT);
    expect(firstPage.pledges).toHaveLength(50);

    const lastPage = store.listCampaignPledges(campaign.id, { page: 20, limit: 50 });
    expect(lastPage.pledges).toHaveLength(50);

    const beyond = store.listCampaignPledges(campaign.id, { page: 21, limit: 50 });
    expect(beyond.pledges).toHaveLength(0);
  });
});
