import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = path.join("/tmp", `stellar-goal-vault-campaign-filters-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";

type IndexModule = typeof import("./index");
type CampaignStoreModule = typeof import("./services/campaignStore");
type DbModule = typeof import("./services/db");

let filterCampaignList: IndexModule["filterCampaignList"];
let parseCampaignListFilters: IndexModule["parseCampaignListFilters"];
let createCampaign: CampaignStoreModule["createCampaign"];
let addPledge: CampaignStoreModule["addPledge"];
let calculateProgress: CampaignStoreModule["calculateProgress"];
let getDb: DbModule["getDb"];

const CREATOR = `G${"A".repeat(55)}`;
const CONTRIBUTOR = `G${"B".repeat(55)}`;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({ filterCampaignList, parseCampaignListFilters } = await import("./index"));
  ({ createCampaign, addPledge, calculateProgress } = await import("./services/campaignStore"));
  ({ getDb } = await import("./services/db"));
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

function createCampaignFixtures() {
  const now = Math.floor(Date.now() / 1000);

  const openUsdc = createCampaign({
    creator: CREATOR,
    title: "Open USDC Campaign",
    description: "Open USDC campaign for checking unfiltered and asset-filtered results.",
    assetCode: "USDC",
    targetAmount: 150,
    deadline: now + 3600,
  });

  const fundedUsdcCampaign = createCampaign({
    creator: CREATOR,
    title: "Funded USDC Campaign",
    description: "Funded USDC campaign that should match combined asset and status filters.",
    assetCode: "usdc",
    targetAmount: 100,
    deadline: now + 7200,
  });
  const fundedUsdc = addPledge(fundedUsdcCampaign.id, { contributor: CONTRIBUTOR, amount: 100 });

  const fundedXlmCampaign = createCampaign({
    creator: CREATOR,
    title: "Funded XLM Campaign",
    description: "Funded XLM campaign that should be excluded when asset is filtered to USDC.",
    assetCode: "XLM",
    targetAmount: 75,
    deadline: now + 7200,
  });
  const fundedXlm = addPledge(fundedXlmCampaign.id, { contributor: CONTRIBUTOR, amount: 75 });

  const failedUsdc = createCampaign({
    creator: CREATOR,
    title: "Failed USDC Campaign",
    description: "Failed USDC campaign with a past deadline to exercise status-based filtering.",
    assetCode: "USDC",
    targetAmount: 200,
    deadline: now - 60,
  });

  const claimedUsdcCampaign = createCampaign({
    creator: CREATOR,
    title: "Claimed USDC Campaign",
    description: "Claimed USDC campaign to ensure other statuses are still returned correctly.",
    assetCode: "USDC",
    targetAmount: 50,
    deadline: now + 7200,
  });
  const claimedUsdcFunded = addPledge(claimedUsdcCampaign.id, {
    contributor: CONTRIBUTOR,
    amount: 50,
  });
  getDb()
    .prepare(`UPDATE campaigns SET claimed_at = ? WHERE id = ?`)
    .run(now, claimedUsdcFunded.id);

  const claimedUsdc = {
    ...claimedUsdcFunded,
    claimedAt: now,
  };

  return { openUsdc, fundedUsdc, fundedXlm, failedUsdc, claimedUsdc };
}

function buildCampaignList() {
  const fixtures = createCampaignFixtures();
  const campaigns = Object.values(fixtures).map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign),
  }));

  return { fixtures, campaigns };
}

describe("campaign list filters", () => {
  it("filters campaigns by asset code case-insensitively", () => {
    const { fixtures, campaigns } = buildCampaignList();

    const filtered = filterCampaignList(campaigns, parseCampaignListFilters({ asset: "usdc" }));

    expect(filtered).toHaveLength(4);
    expect(filtered.map((campaign) => campaign.id).sort()).toEqual(
      [
        fixtures.openUsdc.id,
        fixtures.fundedUsdc.id,
        fixtures.failedUsdc.id,
        fixtures.claimedUsdc.id,
      ].sort(),
    );
    expect(filtered.every((campaign) => campaign.assetCode === "USDC")).toBe(true);
  });

  it("ignores invalid or empty asset filters instead of failing", () => {
    const { campaigns } = buildCampaignList();

    const invalid = filterCampaignList(campaigns, parseCampaignListFilters({ asset: "doge" }));
    const empty = filterCampaignList(campaigns, parseCampaignListFilters({ asset: "   " }));

    expect(invalid).toHaveLength(5);
    expect(empty).toHaveLength(5);
  });

  it("combines status and asset filtering correctly", () => {
    const { fixtures, campaigns } = buildCampaignList();

    const filtered = filterCampaignList(
      campaigns,
      parseCampaignListFilters({ asset: "UsDc", status: "FuNdEd" }),
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(fixtures.fundedUsdc.id);
    expect(filtered[0].assetCode).toBe("USDC");
    expect(filtered[0].progress.status).toBe("funded");
  });
});
