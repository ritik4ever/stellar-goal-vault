import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = path.join(
  "/tmp",
  `stellar-goal-vault-pledges-endpoint-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";

type CampaignStoreModule = typeof import("./services/campaignStore");
type DbModule = typeof import("./services/db");
type ValidationModule = typeof import("./validation/schemas");

let createCampaign: CampaignStoreModule["createCampaign"];
let addPledge: CampaignStoreModule["addPledge"];
let getCampaignWithProgress: CampaignStoreModule["getCampaignWithProgress"];
let listCampaignPledges: CampaignStoreModule["listCampaignPledges"];
let initCampaignStore: CampaignStoreModule["initCampaignStore"];
let getPledges: CampaignStoreModule["getPledges"];
let getDb: DbModule["getDb"];
let parsePledgeListPaginationQuery: ValidationModule["parsePledgeListPaginationQuery"];

const CREATOR = `G${"A".repeat(55)}`;
const CONTRIBUTOR_A = `G${"B".repeat(55)}`;
const CONTRIBUTOR_B = `G${"C".repeat(55)}`;

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function createFixtureCampaign() {
  return createCampaign({
    creator: CREATOR,
    title: "Campaign with many pledges",
    description: "A campaign used to verify standalone pledge pagination and preview behavior.",
    assetCode: "USDC",
    targetAmount: 1000,
    deadline: nowInSeconds() + 86400,
  });
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,
    addPledge,
    getCampaignWithProgress,
    listCampaignPledges,
    initCampaignStore,
    getPledges,
  } = await import("./services/campaignStore"));
  ({ getDb } = await import("./services/db"));
  ({ parsePledgeListPaginationQuery } = await import("./validation/schemas"));

  initCampaignStore();
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe("campaign pledges flow", () => {
  it("returns paginated pledges in reverse chronological order with metadata-ready totals", () => {
    const campaign = createFixtureCampaign();

    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 50 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_B, amount: 75 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_A, amount: 100 });

    const db = getDb();
    const pledges = getPledges(campaign.id).sort((a, b) => a.id - b.id);
    const createdAtBase = nowInSeconds() - 500;
    db.prepare(`UPDATE pledges SET created_at = ? WHERE id = ?`).run(
      createdAtBase + 10,
      pledges[0].id,
    );
    db.prepare(`UPDATE pledges SET created_at = ? WHERE id = ?`).run(
      createdAtBase + 20,
      pledges[1].id,
    );
    db.prepare(`UPDATE pledges SET created_at = ? WHERE id = ?`).run(
      createdAtBase + 30,
      pledges[2].id,
    );

    const result = listCampaignPledges(campaign.id, { page: 1, limit: 2 });

    expect(result.pledges).toHaveLength(2);
    expect(result.pledges.map((pledge) => pledge.amount)).toEqual([100, 75]);
    expect(result.totalCount).toBe(3);
  });

  it("keeps a small pledge preview on campaign detail for compatibility", () => {
    const campaign = createFixtureCampaign();

    for (let index = 0; index < 7; index += 1) {
      addPledge(campaign.id, {
        contributor: index % 2 === 0 ? CONTRIBUTOR_A : CONTRIBUTOR_B,
        amount: 10 + index,
      });
    }

    const detail = getCampaignWithProgress(campaign.id, 5);

    expect(detail).toBeDefined();
    expect(detail?.pledges).toHaveLength(5);
    expect(detail?.pledges?.map((pledge) => pledge.amount)).toEqual([16, 15, 14, 13, 12]);
    expect(detail?.progress.pledgeCount).toBe(7);
  });
});

describe("pledge pagination query parsing", () => {
  it("defaults missing page and limit values", () => {
    const result = parsePledgeListPaginationQuery({});

    expect(result).toEqual({
      ok: true,
      page: 1,
      limit: 10,
    });
  });

  it("collects validation errors for invalid page and limit values", () => {
    const result = parsePledgeListPaginationQuery({ page: 0, limit: 101 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected invalid pagination result.");
    }

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["page"] }),
        expect.objectContaining({ path: ["limit"] }),
      ]),
    );
  });
});
