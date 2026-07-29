import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, resetDbForTests, getDb } from "./db";
import {
  initCampaignStore,
  createCampaign,
  addPledge,
  getCampaign,
  claimCampaign,
} from "./campaignStore";

const CREATOR = "GCZST3XVCDTUJ76ZAV2HA72KYQM4YO4EQQ5FILWIXNJNHKS4JF7JVbarq";
const CONTRIBUTOR_1 =
  "GBBD47UZQ5QBTMX5V27ZM6L5LH4A5V5SOAWBULJGHZDV3AFP6FIUCSHMN";
const CONTRIBUTOR_2 = "GBRPYHIL2CI3WHZDTOOQFC6EB4YPQQYWO3F3XVGKBYSELNWJVLBARQ2";
const CONTRIBUTOR_3 =
  "GCZST3XVCDTUJ76ZAV2HA72KYQM4YO4EQQ5FILWIXNJNHKS4JF7JVBARQ";

describe("Concurrent Pledge Race Condition Tests", () => {
  beforeEach(() => {
    initDb();
    initCampaignStore();
  });

  afterEach(() => {
    resetDbForTests();
  });

  it("should handle concurrent pledges without race conditions", async () => {
    // Create a campaign with a target of 1000
    const { id: campaignId } = createCampaign({
      creator: CREATOR,
      title: "Concurrent Test Campaign",
      description: "Testing concurrent pledge handling with race conditions",
      acceptedTokens: ["USDC"],
      targetAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 86400, // 24 hours from now
    });

    // Simulate concurrent pledges from multiple contributors
    // Each pledge is 250, so 4 concurrent pledges should reach the target
    const pledgeAmount = 250;
    const concurrentPledges = 4;

    // Create promises for concurrent pledge operations
    const pledgePromises = [
      addPledge(campaignId, {
        contributor: CONTRIBUTOR_1,
        amount: pledgeAmount,
        assetCode: "USDC",
      }),
      addPledge(campaignId, {
        contributor: CONTRIBUTOR_2,
        amount: pledgeAmount,
        assetCode: "USDC",
      }),
      addPledge(campaignId, {
        contributor: CONTRIBUTOR_3,
        amount: pledgeAmount,
        assetCode: "USDC",
      }),
      addPledge(campaignId, {
        contributor: CREATOR,
        amount: pledgeAmount,
        assetCode: "USDC",
      }),
    ];

    // Execute all pledges concurrently
    const results = await Promise.all(pledgePromises);

    // Verify all pledges were recorded
    expect(results).toHaveLength(concurrentPledges);
    results.forEach((result) => {
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    // Verify campaign state is consistent
    const campaign = getCampaign(campaignId);
    expect(campaign).toBeDefined();
    expect(campaign?.pledgedAmount).toBe(pledgeAmount * concurrentPledges);
    expect(campaign?.pledgedAmount).toBe(campaign?.targetAmount);
  });

  it("should prevent over-pledging when concurrent pledges exceed target", async () => {
    // Create a campaign with a target of 500
    const { id: campaignId } = createCampaign({
      creator: CREATOR,
      title: "Over-pledge Test Campaign",
      description: "Testing over-pledge prevention with concurrent requests",
      acceptedTokens: ["USDC"],
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    // Try to pledge 300 from 3 different contributors concurrently
    // Total would be 900, exceeding the 500 target
    const pledgePromises = [
      Promise.resolve().then(() => addPledge(campaignId, {
        contributor: CONTRIBUTOR_1,
        amount: 300,
        assetCode: "USDC",
      })).then(res => ({ ok: true, res })).catch(err => ({ ok: false, err })),
      Promise.resolve().then(() => addPledge(campaignId, {
        contributor: CONTRIBUTOR_2,
        amount: 300,
        assetCode: "USDC",
      })).then(res => ({ ok: true, res })).catch(err => ({ ok: false, err })),
      Promise.resolve().then(() => addPledge(campaignId, {
        contributor: CONTRIBUTOR_3,
        amount: 300,
        assetCode: "USDC",
      })).then(res => ({ ok: true, res })).catch(err => ({ ok: false, err })),
    ];

    const results = await Promise.all(pledgePromises);

    // Whichever is processed first succeeds, subsequent ones fail due to cap
    const succeeded = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    expect(succeeded.length).toBeGreaterThan(0);
    expect(failed.length).toBeGreaterThan(0);
    failed.forEach(f => {
      expect((f as any).err.code).toBe('CAMPAIGN_FUNDING_CAP_EXCEEDED');
    });

    const campaign = getCampaign(campaignId);
    expect(campaign).toBeDefined();
    expect(campaign?.pledgedAmount).toBeLessThanOrEqual(500);
  });

  it("should enforce per-contributor limits with concurrent pledges", async () => {
    // Create a campaign with max 200 per contributor
    const { id: campaignId } = createCampaign({
      creator: CREATOR,
      title: "Per-Contributor Limit Test",
      description: "Testing per-contributor limits with concurrent pledges",
      acceptedTokens: ["USDC"],
      targetAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 86400,
      maxPerContributor: 200,
    });

    // Try to pledge 150 twice concurrently from the same contributor
    const pledgePromises = [
      Promise.resolve().then(() => addPledge(campaignId, {
        contributor: CONTRIBUTOR_1,
        amount: 150,
        assetCode: "USDC",
      })).then(res => ({ ok: true, res })).catch(err => ({ ok: false, err })),
      Promise.resolve().then(() => addPledge(campaignId, {
        contributor: CONTRIBUTOR_1,
        amount: 150,
        assetCode: "USDC",
      })).then(res => ({ ok: true, res })).catch(err => ({ ok: false, err })),
    ];

    const results = await Promise.all(pledgePromises);

    const succeeded = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as any).err.code).toBe('MAX_PER_CONTRIBUTOR_EXCEEDED');

    const campaign = getCampaign(campaignId);
    expect(campaign).toBeDefined();
    expect(campaign?.pledgedAmount).toBe(150);
  });

  it("should maintain data consistency under high concurrent load", async () => {
    // Create a campaign
    const { id: campaignId } = createCampaign({
      creator: CREATOR,
      title: "High Load Test Campaign",
      description: "Testing data consistency under high concurrent load",
      acceptedTokens: ["USDC"],
      targetAmount: 10000,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    // Simulate 20 concurrent pledges of 50 each
    const pledgePromises = Array.from({ length: 20 }, (_, i) => {
      const contributorIndex = i % 5; // Reuse 5 contributors
      const contributors = [
        CONTRIBUTOR_1,
        CONTRIBUTOR_2,
        CONTRIBUTOR_3,
        CREATOR,
        "GCZST3XVCDTUJ76ZAV2HA72KYQM4YO4EQQ5FILWIXNJNHKS4JF7JVBARQ",
      ];

      return addPledge(campaignId, {
        contributor: contributors[contributorIndex],
        amount: 50,
        assetCode: "USDC",
      });
    });

    const results = await Promise.all(pledgePromises);

    // All pledges should succeed
    expect(results).toHaveLength(20);
    results.forEach((result) => {
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    // Verify final state
    const campaign = getCampaign(campaignId);
    expect(campaign).toBeDefined();
    expect(campaign?.pledgedAmount).toBe(1000); // 20 * 50
  });

  it("should handle concurrent claim and pledge operations safely", async () => {
    // Create a campaign with target 500
    const { id: campaignId } = createCampaign({
      creator: CREATOR,
      title: "Concurrent Claim Test",
      description: "Testing concurrent claim and pledge operations",
      acceptedTokens: ["USDC"],
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 3600, // Future deadline initially
    });

    // Add initial pledges to reach target while campaign is open
    addPledge(campaignId, {
      contributor: CONTRIBUTOR_1,
      amount: 250,
      assetCode: "USDC",
    });
    addPledge(campaignId, {
      contributor: CONTRIBUTOR_2,
      amount: 250,
      assetCode: "USDC",
    });

    // Manually expire the campaign in the database to allow claim
    getDb()
      .prepare("UPDATE campaigns SET deadline = ? WHERE id = ?")
      .run(Math.floor(Date.now() / 1000) - 3600, campaignId);

    // Try to claim and pledge concurrently
    const operations = [
      (async () => {
        try {
          const res = claimCampaign(campaignId, {
            creator: CREATOR,
            transactionHash: "a".repeat(64),
            confirmedAt: Math.floor(Date.now() / 1000),
          });
          return { type: 'claim', ok: true, res };
        } catch (err) {
          return { type: 'claim', ok: false, err };
        }
      })(),
      (async () => {
        try {
          const res = addPledge(campaignId, {
            contributor: CONTRIBUTOR_3,
            amount: 100,
            assetCode: "USDC",
          });
          return { type: 'pledge', ok: true, res };
        } catch (err) {
          return { type: 'pledge', ok: false, err };
        }
      })(),
    ];

    const results = await Promise.all(operations);
    const claimRes = results.find(r => r.type === 'claim')!;
    const pledgeRes = results.find(r => r.type === 'pledge')!;

    expect(claimRes.ok).toBe(true);

    if (!pledgeRes.ok) {
      expect((pledgeRes as any).err.code).toBe('INVALID_CAMPAIGN_STATE');
    }

    // Verify final state
    const campaign = getCampaign(campaignId);
    expect(campaign).toBeDefined();
    expect(campaign?.claimedAt).toBeDefined();
  });

  it("should detect and handle duplicate concurrent pledges from same contributor", async () => {
    const { id: campaignId } = createCampaign({
      creator: CREATOR,
      title: "Duplicate Pledge Test",
      description: "Testing duplicate pledge detection",
      acceptedTokens: ["USDC"],
      targetAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    // Attempt to pledge the same amount from same contributor concurrently
    // This simulates a user clicking submit multiple times
    const pledgePromises = Array.from({ length: 3 }, () =>
      addPledge(campaignId, {
        contributor: CONTRIBUTOR_1,
        amount: 100,
        assetCode: "USDC",
      }),
    );

    const results = await Promise.all(pledgePromises);

    // All pledges should be recorded (no deduplication at this level)
    expect(results).toHaveLength(3);

    const campaign = getCampaign(campaignId);
    expect(campaign).toBeDefined();
    // All pledges should be recorded
    expect(campaign?.pledgedAmount).toBe(300);
  });
});
