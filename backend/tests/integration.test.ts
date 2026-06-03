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

// Mock wallet addresses (56 characters each - G + 55 more)
const CREATOR_1 = `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const CREATOR_2 = `GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`;
const CONTRIBUTOR_1 = `GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC`;
const CONTRIBUTOR_2 = `GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD`;
const CONTRIBUTOR_3 = `GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE`;

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
 * Generate a valid 64-character hex transaction hash for testing
 */
function generateTxHash(prefix: string = "tx"): string {
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = Math.random().toString(16).substring(2).padStart(52, "0");
  return (timestamp + random).substring(0, 64);
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
    description: "A test campaign for integration testing purposes",
    acceptedTokens: ["USDC"],
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
    assetCode: "USDC",
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
    transactionHash: txHash || generateTxHash(),
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
  
  // Import and initialize campaign store
  const { initCampaignStore } = await import("../src/services/campaignStore");
  initCampaignStore();

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
    expect(history.data.data).toHaveLength(1);
    expect(history.data.data[0].eventType).toBe("created");
    expect(history.data.data[0].actor).toBe(CREATOR_1);

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
    expect(history.data.data).toHaveLength(4); // created + 3 pledges
    expect(history.data.data[1].eventType).toBe("pledged");
    expect(history.data.data[1].amount).toBe(400);
    expect(history.data.data[1].actor).toBe(CONTRIBUTOR_1);
    expect(history.data.data[2].eventType).toBe("pledged");
    expect(history.data.data[2].amount).toBe(350);
    expect(history.data.data[3].eventType).toBe("pledged");
    expect(history.data.data[3].amount).toBe(250);

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
    expect(history.data.data).toHaveLength(5); // created + 3 pledges + claim
    expect(history.data.data[4].eventType).toBe("claimed");
    expect(history.data.data[4].actor).toBe(CREATOR_1);
    expect(history.data.data[4].amount).toBe(1000); // Full pledged amount

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
    const claimEvents = history.data.data.filter((e: any) => e.eventType === "claimed");
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
    const refundEvents = history.data.data.filter((e: any) => e.eventType === "refunded");
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
    const claimEvents = history.data.data.filter((e: any) => e.eventType === "claimed");
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
    expect(history.data.data).toHaveLength(5); // created + 3 pledges + claim

    // Verify event order and types
    expect(history.data.data[0].eventType).toBe("created");
    expect(history.data.data[1].eventType).toBe("pledged");
    expect(history.data.data[2].eventType).toBe("pledged");
    expect(history.data.data[3].eventType).toBe("pledged");
    expect(history.data.data[4].eventType).toBe("claimed");

    // Verify timestamps are in order
    for (let i = 1; i < history.data.data.length; i++) {
      expect(history.data.data[i].timestamp).toBeGreaterThanOrEqual(history.data.data[i - 1].timestamp);
    }

    // Verify actors
    expect(history.data.data[0].actor).toBe(CREATOR_1);
    expect(history.data.data[1].actor).toBe(CONTRIBUTOR_1);
    expect(history.data.data[2].actor).toBe(CONTRIBUTOR_2);
    expect(history.data.data[3].actor).toBe(CONTRIBUTOR_3);
    expect(history.data.data[4].actor).toBe(CREATOR_1);

    // Verify amounts
    expect(history.data.data[1].amount).toBe(300);
    expect(history.data.data[2].amount).toBe(400);
    expect(history.data.data[3].amount).toBe(300);
    expect(history.data.data[4].amount).toBe(1000); // Total claimed
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

    expect(history1.data.data).toHaveLength(3); // created + 1 pledge + claim
    expect(history2.data.data).toHaveLength(4); // created + 2 pledges + claim
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

  it("should reject payloads larger than the configured limit (413 Payload Too Large)", async () => {
    // Generate a ~20KB payload
    const largeDescription = "A".repeat(20 * 1024);
    
    const res = await apiClient.post("/api/campaigns", {
      creator: CREATOR_1,
      title: "Oversized Campaign",
      description: largeDescription,
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: nowInSeconds() + 86400,
    });

    expect(res.status).toBe(413);
    expect(res.data.success).toBe(false);
    expect(res.data.error.code).toBe("PAYLOAD_TOO_LARGE");
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

describe("Pledge Reconcile Flow - Integration", () => {
  it("should complete full reconcile flow: Create -> Pledge -> Reconcile -> Verify History", async () => {
    // Step 1: CREATE CAMPAIGN
    const creationRes = await createTestCampaign({
      creator: CREATOR_1,
      title: "On-Chain Reconcile Campaign",
      description: "Testing full reconcile flow with blockchain integration",
      acceptedTokens: ["USDC"],
      targetAmount: 1000,
      deadline: nowInSeconds() + 86400, // 24 hours from now
    });

    expect(creationRes.status).toBe(201);
    const campaign = creationRes.data.data;
    const campaignId = campaign.id;

    expect(campaign.creator).toBe(CREATOR_1);
    expect(campaign.progress.status).toBe("open");
    expect(campaign.pledgedAmount).toBe(0);

    // Verify creation event recorded
    let history = await getCampaignHistory(campaignId);
    expect(history.data.data).toHaveLength(1);
    expect(history.data.data[0].eventType).toBe("created");
    expect(history.data.data[0].actor).toBe(CREATOR_1);

    // Step 2: ADD OFF-CHAIN PLEDGE
    const offChainPledgeRes = await addTestPledge(campaignId, CONTRIBUTOR_1, 300);
    expect(offChainPledgeRes.status).toBe(201);
    expect(offChainPledgeRes.data.data.pledgedAmount).toBe(300);

    // Verify off-chain pledge event
    history = await getCampaignHistory(campaignId);
    expect(history.data.data).toHaveLength(2);
    expect(history.data.data[1].eventType).toBe("pledged");
    expect(history.data.data[1].actor).toBe(CONTRIBUTOR_1);
    expect(history.data.data[1].amount).toBe(300);

    // Step 3: RECONCILE ON-CHAIN PLEDGE
    const txHash = generateTxHash();
    const reconcileRes = await apiClient.post(
      `/api/campaigns/${campaignId}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_2,
        amount: 450,
        assetCode: "USDC",
        transactionHash: txHash,
        confirmedAt: nowInSeconds(),
      },
    );

    expect(reconcileRes.status).toBe(201);
    expect(reconcileRes.data.data.campaign.pledgedAmount).toBe(750); // 300 + 450
    expect(reconcileRes.data.data.transactionHash).toBe(txHash);

    // Step 4: VERIFY RECONCILE EVENT IN HISTORY
    history = await getCampaignHistory(campaignId);
    expect(history.data.data).toHaveLength(3); // created + off-chain pledge + reconciled pledge

    const reconcileEvent = history.data.data[2];
    expect(reconcileEvent.eventType).toBe("pledged");
    expect(reconcileEvent.actor).toBe(CONTRIBUTOR_2);
    expect(reconcileEvent.amount).toBe(450);
    expect(reconcileEvent.metadata?.onChain).toBe(true);
    expect(reconcileEvent.metadata?.reconciled).toBe(true);
    expect(reconcileEvent.blockchainMetadata?.txHash).toBe(txHash);
    expect(reconcileEvent.blockchainMetadata?.source).toBe("soroban");

    // Step 5: VERIFY CAMPAIGN STATE
    const campaignDetails = await getCampaignDetails(campaignId);
    expect(campaignDetails.status).toBe(200);
    expect(campaignDetails.data.data.pledgedAmount).toBe(750);
    expect(campaignDetails.data.data.progress.percentFunded).toBe(75);

    // Step 6: IDEMPOTENCY CHECK - Second reconcile with same hash returns existing pledge
    const secondReconcileRes = await apiClient.post(
      `/api/campaigns/${campaignId}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_2,
        amount: 450, // Same amount
        assetCode: "USDC",
        transactionHash: txHash, // Same transaction hash
        confirmedAt: nowInSeconds(),
      },
    );

    expect(secondReconcileRes.status).toBe(201);
    expect(secondReconcileRes.data.data.campaign.pledgedAmount).toBe(750); // Still 750, not 1200

    // Verify no duplicate event was created
    history = await getCampaignHistory(campaignId);
    expect(history.data.data).toHaveLength(3); // Still only 3 events
    const pledgeEvents = history.data.data.filter((e: any) => e.eventType === "pledged");
    expect(pledgeEvents).toHaveLength(2); // Still only 2 pledge events

    // Step 7: VERIFY PLEDGES LIST
    const pledgesRes = await apiClient.get(`/api/campaigns/${campaignId}/pledges`);
    expect(pledgesRes.status).toBe(200);
    expect(pledgesRes.data.data).toHaveLength(2);

    // Find the reconciled pledge
    const reconciledPledge = pledgesRes.data.data.find(
      (p: any) => p.transactionHash === txHash,
    );
    expect(reconciledPledge).toBeDefined();
    expect(reconciledPledge.contributor).toBe(CONTRIBUTOR_2);
    expect(reconciledPledge.amount).toBe(450);
    expect(reconciledPledge.transactionHash).toBe(txHash);
  });

  it("should prevent reconciling pledge that exceeds campaign target", async () => {
    // Create campaign with low target
    const creationRes = await createTestCampaign({
      targetAmount: 500,
      deadline: nowInSeconds() + 86400,
    });
    const campaignId = creationRes.data.data.id;

    // Add pledge close to target
    await addTestPledge(campaignId, CONTRIBUTOR_1, 400);

    // Try to reconcile pledge that would exceed target
    const txHash = generateTxHash();
    const reconcileRes = await apiClient.post(
      `/api/campaigns/${campaignId}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_2,
        amount: 200, // Would make total 600, exceeding 500 target
        assetCode: "USDC",
        transactionHash: txHash,
        confirmedAt: nowInSeconds(),
      },
    );

    expect(reconcileRes.status).toBe(400);
    expect(reconcileRes.data.error.code).toBe("CAMPAIGN_FUNDING_CAP_EXCEEDED");

    // Verify campaign state unchanged
    const campaignDetails = await getCampaignDetails(campaignId);
    expect(campaignDetails.data.data.pledgedAmount).toBe(400);

    // Verify no reconcile event was recorded
    const history = await getCampaignHistory(campaignId);
    const pledgeEvents = history.data.data.filter((e: any) => e.eventType === "pledged");
    expect(pledgeEvents).toHaveLength(1); // Only the first pledge
  });

  it("should prevent reconciling pledge to closed campaign", async () => {
    // Create campaign with short deadline
    const creationRes = await createTestCampaign({
      targetAmount: 1000,
      deadline: nowInSeconds() + 2, // Very short deadline (2 seconds)
    });
    const campaignId = creationRes.data.data.id;

    // Add pledge to reach target
    await addTestPledge(campaignId, CONTRIBUTOR_1, 1000);

    // Wait for deadline to pass
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Claim the campaign (should succeed since target is reached and deadline passed)
    const claimRes = await claimTestCampaign(campaignId, CREATOR_1);
    expect(claimRes.status).toBe(200);

    // Verify campaign is claimed
    const campaignDetails = await getCampaignDetails(campaignId);
    expect(campaignDetails.data.data.progress.status).toBe("claimed");

    // Try to reconcile pledge to claimed campaign
    const txHash = generateTxHash();
    const reconcileRes = await apiClient.post(
      `/api/campaigns/${campaignId}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_2,
        amount: 100,
        assetCode: "USDC",
        transactionHash: txHash,
        confirmedAt: nowInSeconds(),
      },
    );

    expect(reconcileRes.status).toBe(400);
    expect(reconcileRes.data.error.code).toBe("INVALID_CAMPAIGN_STATE");

    // Verify campaign state unchanged
    const finalDetails = await getCampaignDetails(campaignId);
    expect(finalDetails.data.data.pledgedAmount).toBe(1000);
  });

  it("should reject reconcile with transaction hash from different campaign", async () => {
    // Create two campaigns
    const campaign1Res = await createTestCampaign({
      creator: CREATOR_1,
      title: "Campaign 1",
      targetAmount: 500,
      deadline: nowInSeconds() + 86400,
    });
    const campaign1Id = campaign1Res.data.data.id;

    const campaign2Res = await createTestCampaign({
      creator: CREATOR_2,
      title: "Campaign 2",
      targetAmount: 800,
      deadline: nowInSeconds() + 86400,
    });
    const campaign2Id = campaign2Res.data.data.id;

    // Reconcile pledge to campaign 1
    const txHash = generateTxHash();
    const reconcile1Res = await apiClient.post(
      `/api/campaigns/${campaign1Id}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_1,
        amount: 200,
        assetCode: "USDC",
        transactionHash: txHash,
        confirmedAt: nowInSeconds(),
      },
    );
    expect(reconcile1Res.status).toBe(201);

    // Try to use same transaction hash for campaign 2
    const reconcile2Res = await apiClient.post(
      `/api/campaigns/${campaign2Id}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_2,
        amount: 300,
        assetCode: "USDC",
        transactionHash: txHash, // Same hash
        confirmedAt: nowInSeconds(),
      },
    );

    expect(reconcile2Res.status).toBe(409);
    expect(reconcile2Res.data.error.code).toBe("TRANSACTION_HASH_CONFLICT");

    // Verify campaign 2 state unchanged
    const campaign2Details = await getCampaignDetails(campaign2Id);
    expect(campaign2Details.data.data.pledgedAmount).toBe(0);
  });

  it("should handle multiple reconciled pledges from different contributors", async () => {
    // Create campaign
    const creationRes = await createTestCampaign({
      targetAmount: 1000,
      deadline: nowInSeconds() + 86400,
    });
    const campaignId = creationRes.data.data.id;

    // Reconcile multiple pledges
    const txHash1 = generateTxHash();
    const txHash2 = generateTxHash();
    const txHash3 = generateTxHash();

    const reconcile1 = await apiClient.post(
      `/api/campaigns/${campaignId}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_1,
        amount: 250,
        assetCode: "USDC",
        transactionHash: txHash1,
        confirmedAt: nowInSeconds(),
      },
    );
    expect(reconcile1.status).toBe(201);

    const reconcile2 = await apiClient.post(
      `/api/campaigns/${campaignId}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_2,
        amount: 350,
        assetCode: "USDC",
        transactionHash: txHash2,
        confirmedAt: nowInSeconds() + 1,
      },
    );
    expect(reconcile2.status).toBe(201);

    const reconcile3 = await apiClient.post(
      `/api/campaigns/${campaignId}/pledges/reconcile`,
      {
        contributor: CONTRIBUTOR_3,
        amount: 400,
        assetCode: "USDC",
        transactionHash: txHash3,
        confirmedAt: nowInSeconds() + 2,
      },
    );
    expect(reconcile3.status).toBe(201);

    // Verify total pledged amount
    const campaignDetails = await getCampaignDetails(campaignId);
    expect(campaignDetails.data.data.pledgedAmount).toBe(1000);
    expect(campaignDetails.data.data.progress.status).toBe("funded");

    // Verify all events in history
    const history = await getCampaignHistory(campaignId);
    expect(history.data.data).toHaveLength(4); // created + 3 reconciled pledges

    const pledgeEvents = history.data.data.filter((e: any) => e.eventType === "pledged");
    expect(pledgeEvents).toHaveLength(3);

    // Verify all are marked as on-chain and reconciled
    pledgeEvents.forEach((event: any) => {
      expect(event.metadata?.onChain).toBe(true);
      expect(event.metadata?.reconciled).toBe(true);
      expect(event.blockchainMetadata?.source).toBe("soroban");
      expect(event.blockchainMetadata?.txHash).toBeDefined();
    });

    // Verify transaction hashes are unique
    const txHashes = pledgeEvents.map((e: any) => e.blockchainMetadata?.txHash);
    expect(new Set(txHashes).size).toBe(3);
  });
});
