import { AxiosInstance } from "axios";

/**
 * Test Utilities & Fixtures
 *
 * Common test helpers and fixture generators to ensure consistent
 * test behavior across the integration test suite.
 */

// ============================================================================
// MOCK DATA & FIXTURES
// ============================================================================

export const MOCK_CREATORS = {
  alice: `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
  bob: `GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`,
  charlie: `GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC`,
};

export const MOCK_CONTRIBUTORS = {
  dave: `GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD`,
  eve: `GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE`,
  frank: `GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF`,
  grace: `GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG`,
  henry: `GHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH`,
};

export const MOCK_ASSETS = {
  USDC: "USDC",
  XLM: "XLM",
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get current timestamp in seconds (matching backend convention)
 */
export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generate a unique transaction hash for testing
 */
export function generateTxHash(prefix = "tx"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Sleep helper for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Round number to 2 decimal places (matching backend convention)
 */
export function roundAmount(value: number): number {
  return Number(value.toFixed(2));
}

// ============================================================================
// API REQUEST HELPERS
// ============================================================================

/**
 * Campaign creation helper with sensible defaults
 */
export async function createCampaign(
  apiClient: AxiosInstance,
  overrides?: Partial<any>,
) {
  const baseTime = nowInSeconds();
  return apiClient.post("/api/campaigns", {
    creator: MOCK_CREATORS.alice,
    title: "Test Campaign",
    description: "A test campaign",
    assetCode: MOCK_ASSETS.USDC,
    targetAmount: 1000,
    deadline: baseTime + 86400,
    ...overrides,
  });
}

/**
 * Add a pledge to a campaign
 */
export async function addPledge(
  apiClient: AxiosInstance,
  campaignId: string,
  contributor: string,
  amount: number,
) {
  return apiClient.post(`/api/campaigns/${campaignId}/pledges`, {
    contributor,
    amount,
  });
}

/**
 * Add multiple pledges to a campaign
 */
export async function addMultiplePledges(
  apiClient: AxiosInstance,
  campaignId: string,
  pledges: Array<{ contributor: string; amount: number }>,
) {
  const results = [];
  for (const pledge of pledges) {
    const result = await addPledge(apiClient, campaignId, pledge.contributor, pledge.amount);
    results.push(result);
  }
  return results;
}

/**
 * Claim a campaign
 */
export async function claimCampaign(
  apiClient: AxiosInstance,
  campaignId: string,
  creator: string,
  txHash?: string,
) {
  return apiClient.post(`/api/campaigns/${campaignId}/claim`, {
    creator,
    transactionHash: txHash || generateTxHash("claim"),
  });
}

/**
 * Reconcile an on-chain pledge
 */
export async function reconcilePledge(
  apiClient: AxiosInstance,
  campaignId: string,
  contributor: string,
  amount: number,
  transactionHash?: string,
) {
  return apiClient.post(`/api/campaigns/${campaignId}/pledges/reconcile`, {
    contributor,
    amount,
    transactionHash: transactionHash || generateTxHash("pledge"),
  });
}

/**
 * Refund a contributor
 */
export async function refundContributor(
  apiClient: AxiosInstance,
  campaignId: string,
  contributor: string,
) {
  return apiClient.post(`/api/campaigns/${campaignId}/refund`, {
    contributor,
  });
}

/**
 * Get campaign details
 */
export async function getCampaign(
  apiClient: AxiosInstance,
  campaignId: string,
) {
  return apiClient.get(`/api/campaigns/${campaignId}`);
}

/**
 * Get campaign history
 */
export async function getCampaignHistory(
  apiClient: AxiosInstance,
  campaignId: string,
) {
  return apiClient.get(`/api/campaigns/${campaignId}/history`);
}

/**
 * List campaigns with optional filters
 */
export async function listCampaigns(
  apiClient: AxiosInstance,
  filters?: {
    asset?: string;
    status?: string;
    q?: string;
    page?: number;
    limit?: number;
  },
) {
  return apiClient.get("/api/campaigns", { params: filters });
}

/**
 * Get API health status
 */
export async function getHealth(apiClient: AxiosInstance) {
  return apiClient.get("/api/health");
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Verify campaign has expected status and state
 */
export function assertCampaignState(
  campaign: any,
  expectedState: {
    status?: "open" | "funded" | "claimed" | "failed";
    pledgedAmount?: number;
    canPledge?: boolean;
    canClaim?: boolean;
    canRefund?: boolean;
  },
) {
  if (expectedState.status) {
    if (campaign.progress.status !== expectedState.status) {
      throw new Error(
        `Expected campaign status "${expectedState.status}", got "${campaign.progress.status}"`,
      );
    }
  }

  if (expectedState.pledgedAmount !== undefined) {
    if (campaign.pledgedAmount !== expectedState.pledgedAmount) {
      throw new Error(
        `Expected pledgedAmount "${expectedState.pledgedAmount}", got "${campaign.pledgedAmount}"`,
      );
    }
  }

  if (expectedState.canPledge !== undefined) {
    if (campaign.progress.canPledge !== expectedState.canPledge) {
      throw new Error(
        `Expected canPledge "${expectedState.canPledge}", got "${campaign.progress.canPledge}"`,
      );
    }
  }

  if (expectedState.canClaim !== undefined) {
    if (campaign.progress.canClaim !== expectedState.canClaim) {
      throw new Error(
        `Expected canClaim "${expectedState.canClaim}", got "${campaign.progress.canClaim}"`,
      );
    }
  }

  if (expectedState.canRefund !== undefined) {
    if (campaign.progress.canRefund !== expectedState.canRefund) {
      throw new Error(
        `Expected canRefund "${expectedState.canRefund}", got "${campaign.progress.canRefund}"`,
      );
    }
  }
}

/**
 * Verify event history contains expected event types
 */
export function assertHistoryContains(
  history: any[],
  expectedEvents: Array<{
    eventType: "created" | "pledged" | "claimed" | "refunded";
    actor?: string;
    amount?: number;
  }>,
) {
  if (history.length !== expectedEvents.length) {
    throw new Error(
      `Expected ${expectedEvents.length} events, got ${history.length}: ${history
        .map((e) => e.eventType)
        .join(", ")}`,
    );
  }

  for (let i = 0; i < expectedEvents.length; i++) {
    const expected = expectedEvents[i];
    const actual = history[i];

    if (actual.eventType !== expected.eventType) {
      throw new Error(
        `Event ${i}: expected type "${expected.eventType}", got "${actual.eventType}"`,
      );
    }

    if (expected.actor && actual.actor !== expected.actor) {
      throw new Error(
        `Event ${i}: expected actor "${expected.actor}", got "${actual.actor}"`,
      );
    }

    if (expected.amount !== undefined && actual.amount !== expected.amount) {
      throw new Error(
        `Event ${i}: expected amount "${expected.amount}", got "${actual.amount}"`,
      );
    }
  }
}

/**
 * Verify response indicates an error
 */
export function assertError(
  response: any,
  expectedCode: string,
  expectedStatus?: number,
) {
  if (expectedStatus && response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}. Response: ${JSON.stringify(
        response.data,
      )}`,
    );
  }

  if (!response.data.error || response.data.error.code !== expectedCode) {
    throw new Error(
      `Expected error code "${expectedCode}", got "${response.data.error?.code}". Response: ${JSON.stringify(
        response.data,
      )}`,
    );
  }
}

/**
 * Verify response indicates success
 */
export function assertSuccess(
  response: any,
  expectedStatus?: number,
) {
  if (expectedStatus && response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}. Response: ${JSON.stringify(
        response.data,
      )}`,
    );
  }

  if (response.status >= 400) {
    throw new Error(
      `Expected success response, got status ${response.status}. Response: ${JSON.stringify(
        response.data,
      )}`,
    );
  }
}
