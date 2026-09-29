import { APIRequestContext, expect } from '@playwright/test';

export type CampaignStatus = 'open' | 'funded' | 'claimed' | 'failed';

export interface CampaignProgress {
  status: CampaignStatus;
  percentageFunded: number;
  remainingAmount: number;
  pledgeCount: number;
  canPledge: boolean;
  canClaim: boolean;
  canRefund: boolean;
}

export interface Campaign {
  id: string;
  creator: string;
  title: string;
  description: string;
  acceptedTokens: string[];
  targetAmount: number;
  pledgedAmount: number;
  deadline: number;
  createdAt: number;
  claimedAt?: number;
  progress: CampaignProgress;
}

export interface ContributorSummary {
  contributor: string;
  totalPledged: number;
  refundedAmount: number;
  isFullyRefunded: boolean;
}

export interface CreateCampaignPayload {
  creator: string;
  title: string;
  description: string;
  acceptedTokens: string[];
  targetAmount: number;
  deadline: number;
}

export interface PledgePayload {
  contributor: string;
  amount: number;
  assetCode?: string;
}

export interface ClaimPayload {
  creator: string;
  transactionHash: string;
}

/**
 * Thin request helpers over the backend REST API. The backend caches the
 * campaign list by query string (30s), so list reads append a `cb` value to
 * guarantee fresh data for deadline-driven waits.
 */
export function createApi(request: APIRequestContext) {
  return {
    async createCampaign(payload: CreateCampaignPayload): Promise<Campaign> {
      const response = await request.post('/api/campaigns', { data: payload });
      expect(response.status()).toBe(201);
      return (await response.json()).data;
    },

    async listCampaigns(title?: string): Promise<Campaign[]> {
      const params = new URLSearchParams();
      if (title) params.set('q', title);
      params.set('cb', String(Date.now()));
      const response = await request.get(`/api/campaigns?${params}`);
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    },

    async addPledge(campaignId: string, payload: PledgePayload): Promise<Campaign> {
      const response = await request.post(`/api/campaigns/${campaignId}/pledges`, {
        data: { ...payload, assetCode: payload.assetCode ?? 'USDC' },
      });
      expect(response.status()).toBe(201);
      return (await response.json()).data;
    },

    async claimCampaign(campaignId: string, payload: ClaimPayload): Promise<Campaign> {
      const response = await request.post(`/api/campaigns/${campaignId}/claim`, {
        data: payload,
      });
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    },

    async getContributors(campaignId: string): Promise<ContributorSummary[]> {
      const response = await request.get(`/api/campaigns/${campaignId}/contributors`);
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    },
  };
}
