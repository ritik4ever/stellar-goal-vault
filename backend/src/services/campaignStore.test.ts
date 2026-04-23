import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = path.join(
  "/tmp",
  `stellar-goal-vault-campaign-store-${process.pid}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";

type CampaignStoreModule = typeof import("./campaignStore");
type DbModule = typeof import("./db");
type EventHistoryModule = typeof import("./eventHistory");

let createCampaign: CampaignStoreModule["createCampaign"];
let initCampaignStore: CampaignStoreModule["initCampaignStore"];
let listCampaigns: CampaignStoreModule["listCampaigns"];
let reconcileOnChainPledge: CampaignStoreModule["reconcileOnChainPledge"];
let updateCampaign: CampaignStoreModule["updateCampaign"];
let getCampaign: CampaignStoreModule["getCampaign"];
let getPledges: CampaignStoreModule["getPledges"];
let getDb: DbModule["getDb"];
let getCampaignHistory: EventHistoryModule["getCampaignHistory"];

const CREATOR = `G${"A".repeat(55)}`;
const CONTRIBUTOR = `G${"B".repeat(55)}`;
const TX_HASH = "a".repeat(64);

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,
    initCampaignStore,
    listCampaigns,
    reconcileOnChainPledge,
    updateCampaign,
    getCampaign,
    getPledges,
  } = await import("./campaignStore"));
  ({ getDb } = await import("./db"));
  ({ getCampaignHistory } = await import("./eventHistory"));
  initCampaignStore();
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe("campaign store search", () => {
  it("returns all campaigns when no search query is provided", () => {
    const result = listCampaigns();
    expect(Array.isArray(result.campaigns)).toBe(true);
  });

  it("returns empty array when search query matches nothing", () => {
    const result = listCampaigns({ searchQuery: "nonexistent-campaign-xyz-123" });
    expect(result.campaigns).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("handles empty search query gracefully", () => {
    const allCampaigns = listCampaigns();
    const emptySearchCampaigns = listCampaigns({ searchQuery: "" });
    expect(emptySearchCampaigns.campaigns.length).toBe(allCampaigns.campaigns.length);
  });

  it("handles whitespace-only search query gracefully", () => {
    const allCampaigns = listCampaigns();
    const whitespaceSearchCampaigns = listCampaigns({ searchQuery: "   " });
    expect(whitespaceSearchCampaigns.campaigns.length).toBe(allCampaigns.campaigns.length);
  });

  it("searches campaigns by title, creator, and id case-insensitively", () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Build a Rocket Ship",
      description: "We need funding to build an amazing rocket ship for space exploration.",
      assetCode: "USDC",
      targetAmount: 10000,
      deadline: futureDeadline,
    });

    expect(listCampaigns({ searchQuery: "rocket" }).campaigns[0].id).toBe(campaign.id);
    expect(
      listCampaigns({ searchQuery: "gaaa" }).campaigns.some((row) => row.id === campaign.id),
    ).toBe(true);
    expect(listCampaigns({ searchQuery: campaign.id }).campaigns[0].id).toBe(campaign.id);
  });
});

describe("on-chain pledge reconciliation", () => {
  it("records a reconciled pledge with transaction metadata", () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Real Soroban campaign",
      description: "A campaign used to verify Freighter-signed pledge reconciliation.",
      assetCode: "USDC",
      targetAmount: 250,
      deadline: futureDeadline,
    });

    const updatedCampaign = reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 25.5,
      transactionHash: TX_HASH,
      confirmedAt: futureDeadline - 300,
    });

    expect(updatedCampaign.pledgedAmount).toBe(25.5);
    expect(getCampaign(campaign.id)?.pledgedAmount).toBe(25.5);

    const pledges = getPledges(campaign.id);
    expect(pledges).toHaveLength(1);
    expect(pledges[0].transactionHash).toBe(TX_HASH);

    const history = getCampaignHistory(campaign.id);
    const pledgeEvent = history.find((event) => event.eventType === "pledged");
    expect(pledgeEvent?.blockchainMetadata?.txHash).toBe(TX_HASH);
    expect(pledgeEvent?.blockchainMetadata?.source).toBe("soroban");
    expect(pledgeEvent?.metadata?.onChain).toBe(true);
  });

  it("treats duplicate transaction hashes as idempotent", () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Idempotent campaign",
      description: "A campaign used to verify duplicate transaction hashes are ignored.",
      assetCode: "USDC",
      targetAmount: 250,
      deadline: futureDeadline,
    });

    reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
      confirmedAt: futureDeadline - 120,
    });

    const secondResult = reconcileOnChainPledge(campaign.id, {
      contributor: CONTRIBUTOR,
      amount: 10,
      transactionHash: TX_HASH,
      confirmedAt: futureDeadline - 100,
    });

    expect(secondResult.pledgedAmount).toBe(10);
    expect(getPledges(campaign.id)).toHaveLength(1);
    expect(
      getCampaignHistory(campaign.id).filter((event) => event.eventType === "pledged"),
    ).toHaveLength(1);
  });
});

describe("campaign updates", () => {
  it("allows creator to update title, description, and targetAmount for open campaigns", () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Original Title",
      description: "Original description that is long enough to meet requirements.",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: futureDeadline,
    });

    const updatedCampaign = updateCampaign(campaign.id, {
      creator: CREATOR,
      title: "Updated Title",
      description: "Updated description that is also long enough to meet requirements.",
      targetAmount: 1500,
    });

    expect(updatedCampaign.title).toBe("Updated Title");
    expect(updatedCampaign.description).toBe("Updated description that is also long enough to meet requirements.");
    expect(updatedCampaign.targetAmount).toBe(1500);

    const history = getCampaignHistory(campaign.id);
    const updateEvent = history.find((event) => event.eventType === "updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent?.actor).toBe(CREATOR);
    expect(updateEvent?.metadata?.title).toBe("Updated Title");
    expect(updateEvent?.metadata?.description).toBe("Updated description that is also long enough to meet requirements.");
    expect(updateEvent?.metadata?.targetAmount).toBe(1500);
  });

  it("rejects updates from non-creators", () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Test Campaign",
      description: "Test description that is long enough to meet requirements.",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: futureDeadline,
    });

    expect(() => {
      updateCampaign(campaign.id, {
        creator: CONTRIBUTOR, // Wrong creator
        title: "Hacked Title",
      });
    }).toThrow("Only the campaign creator can update the campaign.");
  });

  it("rejects updates for non-open campaigns", () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Expired Campaign",
      description: "Test description that is long enough to meet requirements.",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: pastDeadline, // Already expired
    });

    expect(() => {
      updateCampaign(campaign.id, {
        creator: CREATOR,
        title: "Should Fail",
      });
    }).toThrow("Campaign can only be updated while in open state.");
  });

  it("requires at least one field to update", () => {
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Test Campaign",
      description: "Test description that is long enough to meet requirements.",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: futureDeadline,
    });

    expect(() => {
      updateCampaign(campaign.id, {
        creator: CREATOR,
        // No updates provided
      });
    }).toThrow("No valid updates provided.");
  });
});
