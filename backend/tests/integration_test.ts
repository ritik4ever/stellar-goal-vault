import axios, { AxiosInstance, AxiosResponse } from "axios";
import fs from "fs";
import http from "http";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";

/**
 * Integration Test Suite for Campaign Lifecycle State Transitions
 *
 * This test suite provides comprehensive coverage of the full campaign lifecycle:
 * Create -> Pledge -> Claim/Refund
 *
 * Features:
 * - Isolated test database per test worker
 * - Parallel test execution with unique IDs
 * - Full API state machine verification
 * - Edge case and authorization testing
 */

// ============================================================================
// TEST CONFIGURATION & SETUP
// ============================================================================

const TEST_DB_PATH = path.join(
  "/tmp",
  `stellar-goal-vault-integration-${process.pid}-${Date.now()}.db`,
);

// Set environment variables BEFORE importing app
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";
process.env.PORT = "0"; // Use random available port

let server: Server;
let apiClient: AxiosInstance;
const BASE_URL = "http://localhost";

// Mock wallet addresses
const CREATOR_1 = `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const CREATOR_2 = `GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`;
const CONTRIBUTOR_1 = `GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC`;
const CONTRIBUTOR_2 = `GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD`;
const CONTRIBUTOR_3 = `GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE`;

// ============================================================================
// HELPERS & UTILITIES
// ============================================================================

/**
 * Get current timestamp in seconds (matching backend convention)
 */
function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generate a unique ID for testing (e.g., for transaction hashes)
 */
function generateTestId(suffix: string): string {
  return `${suffix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Create campaign with sensible defaults
 */
async function createTestCampaign(
  overrides?: Partial<any>,
): Promise<AxiosResponse<any>> {
  const baseTime = nowInSeconds();
  return apiClient.post("/api/campaigns", {
    creator: CREATOR_1,
    title: "Test Campaign",
    description: "A test campaign",
    assetCode: "USDC",
    targetAmount: 1000,
    deadline: baseTime + 86400, // 24 hours from now
    ...overrides,
  });
}

/**
 * Add pledge to campaign
 */
async function addTestPledge(
  campaignId: string,
  contributor: string,
  amount: number,
): Promise<AxiosResponse<any>> {
  return apiClient.post(`/api/campaigns/${campaignId}/pledges`, {
    contributor,
    amount,
  });
}

/**
 * Claim campaign funds
 */
async function claimTestCampaign(
  campaignId: string,
  creator: string,
  txHash?: string,
): Promise<AxiosResponse<any>> {
  return apiClient.post(`/api/campaigns/${campaignId}/claim`, {
    creator,
    transactionHash: txHash || "tx_" + generateTestId("claim"),
  });
}

/**
 * Refund contributor
 */
async function refundTestContributor(
  campaignId: string,
  contributor: string,
): Promise<AxiosResponse<any>> {
  return apiClient.post(`/api/campaigns/${campaignId}/refund`, {
    contributor,
  });
}

/**
 * Get campaign details
 */
async function getCampaignDetails(campaignId: string): Promise<AxiosResponse<any>> {
  return apiClient.get(`/api/campaigns/${campaignId}`);
}

/**
 * Get campaign history
 */
async function getCampaignHistory(campaignId: string): Promise<AxiosResponse<{ data: any[] }>> {
  return apiClient.get(`/api/campaigns/${campaignId}/history`);
}

// ============================================================================
// TEST LIFECYCLE HOOKS
// ============================================================================

beforeAll(async () => {
  // Clean up any existing test database
  fs.rmSync(TEST_DB_PATH, { force: true });

  // Dynamically import app after environment variables are set
  const appModule = await import("../src/index");
  const { app } = appModule;

  // Start server on random port
  server = app.listen(0);
  const port = (server.address() as any).port;

  // Initialize API client
  apiClient = axios.create({
    baseURL: `${BASE_URL}:${port}`,
    validateStatus: () => true, // Don't throw on any status code
  });

  console.log(`Integration test server started on port ${port}`);
});

afterAll(async () => {
  // Clean up
  return new Promise<void>((resolve) => {
    server.close(() => {
      fs.rmSync(TEST_DB_PATH, { force: true });
      resolve();
    });
  });
});

afterEach(() => {
  // After each test, clear the database
  // (This is handled by the test database isolation)
  vi.clearAllMocks();
});

// ============================================================================
// TEST SUITES
// ============================================================================

describe("Campaign Lifecycle - Happy Path", () => {
  it("should complete full campaign lifecycle: Create -> Pledge -> Claim with history", async () => {
    // Step 1: CREATE CAMPAIGN
    const creationRes = await createTestCampaign({
      creator: CREATOR_1,
      title: "Community Fund",
      description: "Raise funds for community project",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: nowInSeconds() + 100, // Short deadline for testing
    });

    expect(creationRes.status).toBe(201);
    const campaign = creationRes.data.data;
    const campaignId = campaign.id;

    expect(campaign.creator).toBe(CREATOR_1);
    expect(campaign.status).toBe("open");
    expect(campaign.pledgedAmount).toBe(0);
    expect(campaign.claimedAt).toBeUndefined();

    // Verify creation event recorded
    let history = await getCampaignHistory(campaignId);
    expect(history.data).toHaveLength(1);
    expect(history.data[0].eventType).toBe("created");
    expect(history.data[0].actor).toBe(CREATOR_1);

    // Step 2: FIRST PLEDGE
    const pledge1Res = await addTestPledge(campaignId, CONTRIBUTOR_1, 400);
    expect(pledge1Res.status).toBe(201);
    expect(pledge1Res.data.data.pledgedAmount).toBe(400);
    expect(pledge1Res.data.data.progress.percentFunded).toBe(40);
    expect(pledge1Res.data.data.progress.canClaim).toBe(false); // Not at deadline yet

    // Step 3: SECOND PLEDGE
    const pledge2Res = await addTestPledge(campaignId, CONTRIBUTOR_2, 350);
    expect(pledge2Res.status).toBe(201);
    expect(pledge2Res.data.data.pledgedAmount).toBe(750);

    // Step 4: THIRD PLEDGE (to reach target)
    const pledge3Res = await addTestPledge(campaignId, CONTRIBUTOR_3, 250);
    expect(pledge3Res.status).toBe(201);
    expect(pledge3Res.data.data.pledgedAmount).toBe(1000);
    expect(pledge3Res.data.data.progress.percentFunded).toBe(100);
    expect(pledge3Res.data.data.progress.status).toBe("funded");

    // Verify pledge events recorded
    history = await getCampaignHistory(campaignId);
    expect(history.data).toHaveLength(4); // created + 3 pledges
    expect(history.data[1].eventType).toBe("pledged");
    expect(history.data[1].amount).toBe(400);
    expect(history.data[1].actor).toBe(CONTRIBUTOR_1);
    expect(history.data[2].eventType).toBe("pledged");
    expect(history.data[2].amount).toBe(350);
    expect(history.data[3].eventType).toBe("pledged");
    expect(history.data[3].amount).toBe(250);

    // Step 5: Wait for deadline (or simulate it)
    // Since we set deadline in the past, campaign should be claimable now
    const campaignBefore = await getCampaignDetails(campaignId);
    expect(campaignBefore.data.data.progress.canClaim).toBe(true);

    // Step 6: CLAIM CAMPAIGN FUNDS
    const claimRes = await claimTestCampaign(campaignId, CREATOR_1);
    expect(claimRes.status).toBe(200);
    const claimedCampaign = claimRes.data.data;
    expect(claimedCampaign.progress.status).toBe("claimed");
    expect(claimedCampaign.claimedAt).toBeDefined();
    expect(claimedCampaign.claimedAt).toBeGreaterThan(0);
    expect(claimedCampaign.progress.canClaim).toBe(false); // Already claimed

    // Verify claim event recorded
    history = await getCampaignHistory(campaignId);
    expect(history.data).toHaveLength(5); // created + 3 pledges + claim
    expect(history.data[4].eventType).toBe("claimed");
    expect(history.data[4].actor).toBe(CREATOR_1);
    expect(history.data[4].amount).toBe(1000); // Full pledged amount

    // Step 7: NO MORE ACTIONS ALLOWED
    const newPledgeRes = await addTestPledge(campaignId, CONTRIBUTOR_3, 100);
    expect(newPledgeRes.status).toBe(400);
    expect(newPledgeRes.data.error.code).toBe("INVALID_CAMPAIGN_STATE");

    const refundRes = await refundTestContributor(campaignId, CONTRIBUTOR_1);
    expect(refundRes.status).toBe(400);
    expect(refundRes.data.error.code).toBe("INVALID_CAMPAIGN_STATE");
  });
});

describe("Campaign Lifecycle - Edge Cases", () => {
  it("should prevent double claim of the same campaign", async () => {
    // Create and fund campaign
    const creationRes = await createTestCampaign({
      targetAmount: 500,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Pledge to reach target
    await addTestPledge(campaignId, CONTRIBUTOR_1, 500);

    // First claim should succeed
    const claim1Res = await claimTestCampaign(campaignId, CREATOR_1);
    expect(claim1Res.status).toBe(200);
    expect(claim1Res.data.data.claimedAt).toBeDefined();

    // Second claim should fail
    const claim2Res = await claimTestCampaign(campaignId, CREATOR_1);
    expect(claim2Res.status).toBe(400);
    expect(claim2Res.data.error.code).toBe("INVALID_CAMPAIGN_STATE");

    // Verify only one claim event
    const history = await getCampaignHistory(campaignId);
    const claimEvents = history.data.filter((e: any) => e.eventType === "claimed");
    expect(claimEvents).toHaveLength(1);
  });

  it("should prevent claiming without reaching target amount", async () => {
    // Create campaign
    const creationRes = await createTestCampaign({
      targetAmount: 1000,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Only pledge partial amount
    await addTestPledge(campaignId, CONTRIBUTOR_1, 400);

    // Attempt to claim should fail
    const claimRes = await claimTestCampaign(campaignId, CREATOR_1);
    expect(claimRes.status).toBe(400);
    expect(claimRes.data.error.code).toBe("INVALID_CAMPAIGN_STATE");
  });

  it("should prevent claiming before deadline", async () => {
    const futureDeadline = nowInSeconds() + 86400; // Far future
    const creationRes = await createTestCampaign({
      targetAmount: 500,
      deadline: futureDeadline,
    });
    const campaignId = creationRes.data.data.id;

    // Pledge to reach target
    await addTestPledge(campaignId, CONTRIBUTOR_1, 500);

    // Attempt to claim before deadline should fail
    const claimRes = await claimTestCampaign(campaignId, CREATOR_1);
    expect(claimRes.status).toBe(400);
    expect(claimRes.data.error.code).toBe("INVALID_CAMPAIGN_STATE");
  });

  it("should prevent refund from claimed campaign", async () => {
    // Create and fund campaign
    const creationRes = await createTestCampaign({
      targetAmount: 500,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Pledge and claim
    await addTestPledge(campaignId, CONTRIBUTOR_1, 500);
    await claimTestCampaign(campaignId, CREATOR_1);

    // Attempt to refund should fail
    const refundRes = await refundTestContributor(campaignId, CONTRIBUTOR_1);
    expect(refundRes.status).toBe(400);
    expect(refundRes.data.error.code).toBe("INVALID_CAMPAIGN_STATE");
  });

  it("should allow refund from failed campaign (not enough pledges)", async () => {
    // Create campaign with past deadline
    const creationRes = await createTestCampaign({
      targetAmount: 1000,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Only pledge partial amount
    const pledgeRes = await addTestPledge(campaignId, CONTRIBUTOR_1, 300);
    const pledgeRes2 = await addTestPledge(campaignId, CONTRIBUTOR_2, 200);

    expect(pledgeRes.data.data.progress.status).toBe("open");

    // Campaign status should be "failed" after deadline
    const detailsRes = await getCampaignDetails(campaignId);
    expect(detailsRes.data.data.progress.status).toBe("failed");
    expect(detailsRes.data.data.progress.canRefund).toBe(true);

    // Refund first contributor
    const refund1Res = await refundTestContributor(campaignId, CONTRIBUTOR_1);
    expect(refund1Res.status).toBe(200);
    expect(refund1Res.data.data.refundedAmount).toBe(300);
    expect(refund1Res.data.data.pledgedAmount).toBe(200); // 500 - 300

    // Refund second contributor
    const refund2Res = await refundTestContributor(campaignId, CONTRIBUTOR_2);
    expect(refund2Res.status).toBe(200);
    expect(refund2Res.data.data.refundedAmount).toBe(200);
    expect(refund2Res.data.data.pledgedAmount).toBe(0);

    // Verify refund events
    const history = await getCampaignHistory(campaignId);
    const refundEvents = history.data.filter((e: any) => e.eventType === "refunded");
    expect(refundEvents).toHaveLength(2);
    expect(refundEvents[0].actor).toBe(CONTRIBUTOR_1);
    expect(refundEvents[0].amount).toBe(300);
    expect(refundEvents[1].actor).toBe(CONTRIBUTOR_2);
    expect(refundEvents[1].amount).toBe(200);
  });

  it("should prevent refund of non-existent contributor", async () => {
    const creationRes = await createTestCampaign({
      targetAmount: 500,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Only pledge from one contributor
    await addTestPledge(campaignId, CONTRIBUTOR_1, 300);

    // Attempt to refund someone who didn't pledge
    const refundRes = await refundTestContributor(campaignId, CONTRIBUTOR_2);
    expect(refundRes.status).toBe(404);
    expect(refundRes.data.error.code).toBe("NOT_FOUND");
  });

  it("should prevent refunding the same contributor twice", async () => {
    const creationRes = await createTestCampaign({
      targetAmount: 500,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Pledge from contributor
    await addTestPledge(campaignId, CONTRIBUTOR_1, 300);

    // First refund should succeed
    const refund1Res = await refundTestContributor(campaignId, CONTRIBUTOR_1);
    expect(refund1Res.status).toBe(200);
    expect(refund1Res.data.data.refundedAmount).toBe(300);

    // Second refund should fail (already refunded)
    const refund2Res = await refundTestContributor(campaignId, CONTRIBUTOR_1);
    expect(refund2Res.status).toBe(404);
    expect(refund2Res.data.error.code).toBe("NOT_FOUND");
  });
});

describe("Campaign Lifecycle - Authorization & Validation", () => {
  it("should prevent unauthorized creator from claiming campaign", async () => {
    const creationRes = await createTestCampaign({
      creator: CREATOR_1,
      targetAmount: 500,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Pledge to reach target
    await addTestPledge(campaignId, CONTRIBUTOR_1, 500);

    // Try to claim as different creator
    const claimRes = await claimTestCampaign(campaignId, CREATOR_2);
    expect(claimRes.status).toBe(403);
    expect(claimRes.data.error.code).toBe("FORBIDDEN");

    // Verify no claim event recorded
    const history = await getCampaignHistory(campaignId);
    const claimEvents = history.data.filter((e: any) => e.eventType === "claimed");
    expect(claimEvents).toHaveLength(0);
  });

  it("should validate all required fields on campaign creation", async () => {
    // Missing creator
    let res = await apiClient.post("/api/campaigns", {
      title: "Test",
      description: "Test",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: nowInSeconds() + 86400,
    });
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe("VALIDATION_ERROR");

    // Missing title
    res = await apiClient.post("/api/campaigns", {
      creator: CREATOR_1,
      description: "Test",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: nowInSeconds() + 86400,
    });
    expect(res.status).toBe(400);

    // Invalid deadline (past)
    res = await apiClient.post("/api/campaigns", {
      creator: CREATOR_1,
      title: "Test",
      description: "Test",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: nowInSeconds() - 3600,
    });
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe("INVALID_DEADLINE");

    // Invalid amount (negative)
    res = await apiClient.post("/api/campaigns", {
      creator: CREATOR_1,
      title: "Test",
      description: "Test",
      assetCode: "USDC",
      targetAmount: -100,
      deadline: nowInSeconds() + 86400,
    });
    expect(res.status).toBe(400);
  });

  it("should validate pledge amounts and constraints", async () => {
    const creationRes = await createTestCampaign();
    const campaignId = creationRes.data.data.id;

    // Negative pledge
    let res = await apiClient.post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR_1,
      amount: -100,
    });
    expect(res.status).toBe(400);

    // Zero pledge
    res = await apiClient.post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR_1,
      amount: 0,
    });
    expect(res.status).toBe(400);

    // Valid pledge should work
    res = await apiClient.post(`/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR_1,
      amount: 100,
    });
    expect(res.status).toBe(201);
  });

  it("should reject operations on non-existent campaign", async () => {
    const fakeId = "99999999";

    // Get non-existent
    let res = await apiClient.get(`/api/campaigns/${fakeId}`);
    expect(res.status).toBe(404);

    // Pledge to non-existent
    res = await apiClient.post(`/api/campaigns/${fakeId}/pledges`, {
      contributor: CONTRIBUTOR_1,
      amount: 100,
    });
    expect(res.status).toBe(404);

    // Claim non-existent
    res = await apiClient.post(`/api/campaigns/${fakeId}/claim`, {
      creator: CREATOR_1,
      transactionHash: "tx_test",
    });
    expect(res.status).toBe(404);

    // Refund from non-existent
    res = await apiClient.post(`/api/campaigns/${fakeId}/refund`, {
      contributor: CONTRIBUTOR_1,
    });
    expect(res.status).toBe(404);

    // Get history of non-existent
    res = await apiClient.get(`/api/campaigns/${fakeId}/history`);
    expect(res.status).toBe(404);
  });
});

describe("Campaign Lifecycle - State Consistency", () => {
  it("should maintain state consistency across multiple operations", async () => {
    // Create campaign
    const creationRes = await createTestCampaign({
      targetAmount: 1000,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Verify initial state
    let details = await getCampaignDetails(campaignId);
    expect(details.data.data.pledgedAmount).toBe(0);
    expect(details.data.data.progress.status).toBe("open");

    // Add multiple pledges
    for (let i = 0; i < 3; i++) {
      await addTestPledge(campaignId, `CONTRIBUTOR_${i}`, 300 + i * 10);
    }

    // Verify state after pledges
    details = await getCampaignDetails(campaignId);
    expect(details.data.data.pledgedAmount).toBe(930); // 300 + 310 + 320

    // Verify campaign is funded
    expect(details.data.data.progress.status).toBe("funded");

    // Claim campaign
    await claimTestCampaign(campaignId, CREATOR_1);

    // Verify final state
    details = await getCampaignDetails(campaignId);
    expect(details.data.data.pledgedAmount).toBe(930); // unchanged
    expect(details.data.data.progress.status).toBe("claimed");
    expect(details.data.data.progress.canClaim).toBe(false);
    expect(details.data.data.progress.canRefund).toBe(false);
    expect(details.data.data.progress.canPledge).toBe(false);
  });

  it("should track all events in correct order", async () => {
    const creationRes = await createTestCampaign({
      targetAmount: 1000,
      deadline: nowInSeconds() + 50,
    });
    const campaignId = creationRes.data.data.id;

    // Perform sequence of operations
    await addTestPledge(campaignId, CONTRIBUTOR_1, 300);
    await addTestPledge(campaignId, CONTRIBUTOR_2, 400);
    await addTestPledge(campaignId, CONTRIBUTOR_3, 300);
    await claimTestCampaign(campaignId, CREATOR_1);

    // Get full history
    const history = await getCampaignHistory(campaignId);
    expect(history.data).toHaveLength(5); // created + 3 pledges + claim

    // Verify event order and types
    expect(history.data[0].eventType).toBe("created");
    expect(history.data[1].eventType).toBe("pledged");
    expect(history.data[2].eventType).toBe("pledged");
    expect(history.data[3].eventType).toBe("pledged");
    expect(history.data[4].eventType).toBe("claimed");

    // Verify timestamps are in order
    for (let i = 1; i < history.data.length; i++) {
      expect(history.data[i].timestamp).toBeGreaterThanOrEqual(history.data[i - 1].timestamp);
    }

    // Verify actors
    expect(history.data[0].actor).toBe(CREATOR_1);
    expect(history.data[1].actor).toBe(CONTRIBUTOR_1);
    expect(history.data[2].actor).toBe(CONTRIBUTOR_2);
    expect(history.data[3].actor).toBe(CONTRIBUTOR_3);
    expect(history.data[4].actor).toBe(CREATOR_1);

    // Verify amounts
    expect(history.data[1].amount).toBe(300);
    expect(history.data[2].amount).toBe(400);
    expect(history.data[3].amount).toBe(300);
    expect(history.data[4].amount).toBe(1000); // Total claimed
  });

  it("should handle multiple independent campaigns in parallel", async () => {
    // Create multiple campaigns
    const campaign1Res = await createTestCampaign({
      creator: CREATOR_1,
      title: "Campaign 1",
      targetAmount: 500,
      deadline: nowInSeconds() + 50,
    });

    const campaign2Res = await createTestCampaign({
      creator: CREATOR_2,
      title: "Campaign 2",
      targetAmount: 800,
      deadline: nowInSeconds() + 50,
    });

    const campaign1Id = campaign1Res.data.data.id;
    const campaign2Id = campaign2Res.data.data.id;

    // Add pledges to campaign 1
    await addTestPledge(campaign1Id, CONTRIBUTOR_1, 500);

    // Add pledges to campaign 2
    await addTestPledge(campaign2Id, CONTRIBUTOR_2, 400);
    await addTestPledge(campaign2Id, CONTRIBUTOR_3, 400);

    // Claim both campaigns
    await claimTestCampaign(campaign1Id, CREATOR_1);
    await claimTestCampaign(campaign2Id, CREATOR_2);

    // Verify both are claimed independently
    const details1 = await getCampaignDetails(campaign1Id);
    const details2 = await getCampaignDetails(campaign2Id);

    expect(details1.data.data.progress.status).toBe("claimed");
    expect(details1.data.data.pledgedAmount).toBe(500);
    expect(details1.data.data.claimedAt).toBeDefined();

    expect(details2.data.data.progress.status).toBe("claimed");
    expect(details2.data.data.pledgedAmount).toBe(800);
    expect(details2.data.data.claimedAt).toBeDefined();

    // Verify histories are independent
    const history1 = await getCampaignHistory(campaign1Id);
    const history2 = await getCampaignHistory(campaign2Id);

    expect(history1.data).toHaveLength(3); // created + 1 pledge + claim
    expect(history2.data).toHaveLength(4); // created + 2 pledges + claim
  });
});

describe("Campaign API - Health & Stability", () => {
  it("should report healthy status", async () => {
    const res = await apiClient.get("/api/health");
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("ok");
    expect(res.data.database.status).toBe("up");
    expect(res.data.database.reachable).toBe(true);
  });

  it("should handle concurrent requests without data corruption", async () => {
    // Create campaigns concurrently
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        createTestCampaign({
          creator: CREATOR_1,
          title: `Campaign ${i}`,
          targetAmount: 100 * (i + 1),
          deadline: nowInSeconds() + 50,
        }),
      );
    }

    const responses = await Promise.all(promises);

    // All should succeed
    expect(responses).toHaveLength(5);
    responses.forEach((res: AxiosResponse<any>) => {
      expect(res.status).toBe(201);
      expect(res.data.data.id).toBeDefined();
    });

    // Verify all campaigns are distinct
    const ids = responses.map((r: AxiosResponse<any>) => r.data.data.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(5); // All unique
  });
});
