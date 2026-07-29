import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { initDb, resetDbForTests, getDb } from "../services/db";
import {
  initCampaignStore,
  createCampaign,
  addPledge,
  refundContributor,
  getCampaignTokenBalances,
  getCampaign,
} from "../services/campaignStore";
import { getCampaignHistory } from "../services/eventHistory";

const TEST_DB_PATH = path.join(
  "/tmp",
  `stellar-goal-vault-refund-test-${process.pid}-${Date.now()}.db`
);

const CREATOR = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const CONTRIBUTOR = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
const CONTRIBUTOR2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("Refund and Token Balances Logic", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    fs.rmSync(TEST_DB_PATH, { force: true });
    initDb();
    initCampaignStore();
  });

  afterEach(() => {
    resetDbForTests();
    try {
      fs.rmSync(TEST_DB_PATH, { force: true });
    } catch {
      // Ignore Windows file locks in cleanup
    }
  });

  it("should throw 404 NOT_FOUND when refunding a nonexistent campaign", () => {
    expect(() => {
      refundContributor("nonexistent-id", CONTRIBUTOR);
    }).toThrow(/Campaign not found/);
  });

  it("should throw 400 INVALID_CAMPAIGN_STATE if campaign is open and deadline has not passed", () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Active Campaign",
      description: "This campaign is active and cannot be refunded yet.",
      acceptedTokens: ["USDC"],
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 200, assetCode: "USDC" });

    expect(() => {
      refundContributor(campaign.id, CONTRIBUTOR);
    }).toThrow(/Refunds are not available/);
  });

  it("should throw 404 NOT_FOUND if contributor has no active pledges", () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Expired Failed Campaign",
      description: "This campaign is expired and failed.",
      acceptedTokens: ["USDC"],
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    // Manually expire campaign
    getDb()
      .prepare("UPDATE campaigns SET deadline = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 3600, campaign.id);

    expect(() => {
      refundContributor(campaign.id, CONTRIBUTOR);
    }).toThrow(/No refundable pledges found/);
  });

  it("should successfully refund contributor, update database state, and record event", () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Expired Failed Campaign",
      description: "This campaign is expired and failed.",
      acceptedTokens: ["USDC", "XLM"],
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    // Add pledges
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 100, assetCode: "USDC" });
    addPledge(campaign.id, { contributor: CONTRIBUTOR, amount: 150, assetCode: "XLM" });
    addPledge(campaign.id, { contributor: CONTRIBUTOR2, amount: 100, assetCode: "USDC" });

    // Manually expire campaign
    getDb()
      .prepare("UPDATE campaigns SET deadline = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 3600, campaign.id);

    const checkBalancesBefore = getCampaignTokenBalances(campaign.id);
    expect(checkBalancesBefore).toEqual({ USDC: 200, XLM: 150 });

    // Perform refund
    const result = refundContributor(campaign.id, CONTRIBUTOR, {
      source: "soroban-contract",
      txHash: "a".repeat(64),
      contractId: "C".repeat(56),
      networkPassphrase: "Test passphrase",
      rpcUrl: "https://rpc.example.com",
      walletAddress: CONTRIBUTOR,
      ledger: 100,
      latestLedger: 105,
    });

    expect(result.refundedAmount).toBe(250);
    expect(result.campaign.pledgedAmount).toBe(100); // 350 - 250

    // Verify token balances after refund
    const checkBalancesAfter = getCampaignTokenBalances(campaign.id);
    expect(checkBalancesAfter).toEqual({ USDC: 100 }); // XLM is now 0 so omitted or excluded

    // Verify database pledges are marked refunded
    const pledges = getDb()
      .prepare("SELECT * FROM pledges WHERE campaign_id = ? AND contributor = ?")
      .all(campaign.id, CONTRIBUTOR) as any[];

    expect(pledges).toHaveLength(2);
    expect(pledges[0].refunded_at).not.toBeNull();
    expect(pledges[1].refunded_at).not.toBeNull();

    // Verify events recorded
    const history = getCampaignHistory(campaign.id);
    const refundEvent = history.find((h) => h.eventType === "refunded");
    expect(refundEvent).toBeDefined();
    expect(refundEvent?.actor).toBe(CONTRIBUTOR);
    expect(refundEvent?.amount).toBe(250);
  });
});
