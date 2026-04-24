import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = path.join("/tmp", `stellar-goal-vault-campaign-filters-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";

type IndexModule = typeof import("./index");
type CampaignStoreModule = typeof import("./services/campaignStore");
type DbModule = typeof import("./services/db");

let listCampaigns: CampaignStoreModule["listCampaigns"];
let parseCampaignListFilters: IndexModule["parseCampaignListFilters"];
let createCampaign: CampaignStoreModule["createCampaign"];
let addPledge: CampaignStoreModule["addPledge"];
let calculateProgress: CampaignStoreModule["calculateProgress"];
let initCampaignStore: CampaignStoreModule["initCampaignStore"];
let getDb: DbModule["getDb"];

const CREATOR = `G${"A".repeat(55)}`;
const CONTRIBUTOR = `G${"B".repeat(55)}`;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ parseCampaignListFilters } = await import("./index"));

  ({ getDb } = await import("./services/db"));
  initCampaignStore();
}, 20000);


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

describe("campaign list filters and pagination", () => {
  it("filters campaigns by asset code case-insensitively via SQL", () => {
    const { fixtures } = buildCampaignList();

    const filters = parseCampaignListFilters({ asset: "usdc" });
    const { campaigns: filtered } = listCampaigns({ 
      ...filters, 
      assetCode: filters.asset, 
      page: 1, 
      limit: 10 
    });

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

  it("handles pagination correctly", () => {
    buildCampaignList(); // creates 5 campaigns

    const page1 = listCampaigns({ page: 1, limit: 2 });
    expect(page1.campaigns).toHaveLength(2);
    expect(page1.totalCount).toBe(5);

    const page2 = listCampaigns({ page: 2, limit: 2 });
    expect(page2.campaigns).toHaveLength(2);
    expect(page2.totalCount).toBe(5);

    const page3 = listCampaigns({ page: 3, limit: 2 });
    expect(page3.campaigns).toHaveLength(1);
    expect(page3.totalCount).toBe(5);

    // Verify disjoint sets
    const ids1 = page1.campaigns.map(c => c.id);
    const ids2 = page2.campaigns.map(c => c.id);
    const ids3 = page3.campaigns.map(c => c.id);
    
    expect(ids1.some(id => ids2.includes(id))).toBe(false);
    expect(ids2.some(id => ids3.includes(id))).toBe(false);
  });

  it("combines status and asset filtering correctly via SQL", () => {
    const { fixtures } = buildCampaignList();

    const filters = parseCampaignListFilters({ asset: "UsDc", status: "FuNdEd" });
    const { campaigns: filtered } = listCampaigns({
      ...filters,
      assetCode: filters.asset,
      page: 1,
      limit: 10
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(fixtures.fundedUsdc.id);
    expect(filtered[0].assetCode).toBe("USDC");
  });
});





