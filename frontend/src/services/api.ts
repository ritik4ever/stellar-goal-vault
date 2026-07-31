import {
  AppConfig,
  Campaign,
  CampaignEvent,
  ContributorBadge,
  ContributorBackedCampaign,
  ContributorProfile,
  ContributorRefundEntry,
  CreateCampaignPayload,
  CreatePledgePayload,
  LeaderboardEntry,
  OpenIssue,
  Pledge,
  ReconcilePledgePayload,
  SorobanRefundMetadata,
} from '../types/campaign';
import { apiRequest } from './httpClient';

export type CampaignListResponse = {
  data: Campaign[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

export async function listCampaigns(filters?: {
  includeDeleted?: boolean;
  search?: string;
  asset?: string;
  status?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
}): Promise<CampaignListResponse> {
  const params = new URLSearchParams();
  if (filters?.includeDeleted) {
    params.set('includeDeleted', 'true');
  }
  if (filters?.search?.trim()) {
    params.set('search', filters.search.trim());
  }
  if (filters?.asset) {
    params.set('asset', filters.asset);
  }
  if (filters?.status) {
    params.set('status', filters.status);
  }
  if (filters?.page !== undefined) {
    params.set('page', String(filters.page));
  }
  if (filters?.limit !== undefined) {
    params.set('limit', String(filters.limit));
  }
  if (filters?.sort) {
    params.set('sort', filters.sort);
  }
  if (filters?.order) {
    params.set('order', filters.order);
  }

  const query = params.toString();
  return apiRequest<CampaignListResponse>({
    url: `/campaigns${query ? `?${query}` : ''}`,
    method: 'GET',
  });
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  const body = await apiRequest<{ data: Campaign }>({
    url: `/campaigns/${campaignId}`,
    method: 'GET',
  });
  return body.data;
}

export async function getAppConfig(): Promise<AppConfig> {
  const body = await apiRequest<{ data: AppConfig }>({
    url: '/config',
    method: 'GET',
  });
  return body.data;
}

export async function createCampaign(payload: CreateCampaignPayload): Promise<Campaign> {
  const body = await apiRequest<{ data: Campaign }>({
    url: '/campaigns',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: payload,
  });
  return body.data;
}

export async function addPledge(
  campaignId: string,
  payload: CreatePledgePayload,
): Promise<Campaign> {
  const body = await apiRequest<{ data: Campaign }>({
    url: `/campaigns/${campaignId}/pledges`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: payload,
  });
  return body.data;
}

export async function reconcilePledge(
  campaignId: string,
  payload: ReconcilePledgePayload,
): Promise<{ campaign: Campaign; transactionHash: string }> {
  const body = await apiRequest<{
    data: { campaign: Campaign; transactionHash: string };
  }>({
    url: `/campaigns/${campaignId}/pledges/reconcile`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: payload,
  });
  return body.data;
}

export async function claimCampaign(
  campaignId: string,
  creator: string,
  transactionHash: string,
  confirmedAt: number,
): Promise<Campaign> {
  const body = await apiRequest<{ data: Campaign }>({
    url: `/campaigns/${campaignId}/claim`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { creator, transactionHash, confirmedAt },
  });
  return body.data;
}

export async function softDeleteCampaign(campaignId: string): Promise<void> {
  const response = await apiRequest<unknown>({
    url: `/campaigns/${campaignId}/soft-delete`,
    method: 'POST',
  });
  void response;
}

export async function refundCampaign(
  campaignId: string,
  contributor: string,
  soroban: SorobanRefundMetadata,
): Promise<Campaign> {
  const body = await apiRequest<{ data: Campaign }>({
    url: `/campaigns/${campaignId}/refund`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { contributor, soroban },
  });
  return body.data;
}

export async function getCampaignHistory(campaignId: string): Promise<CampaignEvent[]> {
  const allEvents: CampaignEvent[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const body = await apiRequest<{
      data: CampaignEvent[];
      hasMore: boolean;
    }>({
      url: `/campaigns/${campaignId}/history`,
      method: 'GET',
      params: { page, pageSize: 100 },
    });

    allEvents.push(...body.data);
    hasMore = body.hasMore;
    page += 1;
  }

  return allEvents.sort((left, right) => left.timestamp - right.timestamp || left.id - right.id);
}

export async function listOpenIssues(): Promise<OpenIssue[]> {
  const body = await apiRequest<{ data: OpenIssue[] }>({
    url: '/open-issues',
    method: 'GET',
  });
  return body.data;
}

export async function getDistinctAssetCodes(): Promise<string[]> {
  const body = await apiRequest<{ data: string[] }>({
    url: '/campaigns/assets',
    method: 'GET',
  });
  return body.data;
}

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const body = await apiRequest<{ data: LeaderboardEntry[] }>({
    url: `/leaderboard?limit=${limit}`,
    method: 'GET',
  });
  return body.data;
}

function buildBadges(profile: {
  campaignCount: number;
  totalPledged: number;
  refundedAmount: number;
  rank: number;
}): ContributorBadge[] {
  const badges: ContributorBadge[] = [];
  const now = Math.floor(Date.now() / 1000);

  if (profile.campaignCount >= 1) {
    badges.push({
      name: 'First Backer',
      description: 'Backed their first campaign',
      earnedAt: now,
      icon: '🎯',
    });
  }
  if (profile.campaignCount >= 5) {
    badges.push({
      name: 'Serial Supporter',
      description: 'Backed 5 or more campaigns',
      earnedAt: now,
      icon: '⭐',
    });
  }
  if (profile.campaignCount >= 10) {
    badges.push({
      name: 'Campaign Veteran',
      description: 'Backed 10 or more campaigns',
      earnedAt: now,
      icon: '🏆',
    });
  }
  if (profile.totalPledged >= 1000) {
    badges.push({
      name: 'Whale Pledger',
      description: 'Pledged over 1,000 tokens total',
      earnedAt: now,
      icon: '🐋',
    });
  }
  if (profile.rank > 0 && profile.rank <= 10) {
    badges.push({
      name: 'Top 10 Contributor',
      description: 'Ranked in the global top 10',
      earnedAt: now,
      icon: '👑',
    });
  }
  if (profile.refundedAmount > 0 && profile.refundedAmount < profile.totalPledged) {
    badges.push({
      name: 'Mixed Portfolio',
      description: 'Has both active pledges and refunds',
      earnedAt: now,
      icon: '🔄',
    });
  }

  return badges;
}

export async function getContributorProfile(address: string): Promise<ContributorProfile> {
  const leaderboard = await getLeaderboard(100);
  const entry = leaderboard.find((e) => e.contributor === address);
  const rank = entry?.rank ?? 0;

  const { data: campaigns } = await apiRequest<{ data: Campaign[] }>({
    url: '/campaigns?limit=100',
    method: 'GET',
  });

  const backedCampaigns: ContributorBackedCampaign[] = [];
  const refundHistory: ContributorRefundEntry[] = [];
  let totalPledged = 0;
  let refundedAmount = 0;

  for (const campaign of campaigns) {
    let pledges: Pledge[] = [];
    if (campaign.pledges) {
      pledges = campaign.pledges.filter((p) => p.contributor === address);
    } else {
      try {
        const body = await apiRequest<{ data: Pledge[] }>({
          url: `/campaigns/${campaign.id}/pledges`,
          method: 'GET',
          params: { limit: 500 },
        });
        pledges = body.data.filter((p) => p.contributor === address);
      } catch {
        // skip campaigns where pledges can't be fetched
        continue;
      }
    }

    if (pledges.length === 0) continue;

    let campaignPledged = 0;
    let campaignRefunded = 0;
    let earliestPledgeAt = Infinity;

    for (const pledge of pledges) {
      if (pledge.refundedAt) {
        campaignRefunded += pledge.amount;
        refundHistory.push({
          campaignId: campaign.id,
          title: campaign.title,
          amount: pledge.amount,
          assetCode: pledge.assetCode,
          refundedAt: pledge.refundedAt,
        });
      } else {
        campaignPledged += pledge.amount;
      }
      if (pledge.createdAt < earliestPledgeAt) {
        earliestPledgeAt = pledge.createdAt;
      }
    }

    totalPledged += campaignPledged + campaignRefunded;
    refundedAmount += campaignRefunded;

    backedCampaigns.push({
      campaignId: campaign.id,
      title: campaign.title,
      status: campaign.progress.status,
      pledgedAmount: campaignPledged,
      refundedAmount: campaignRefunded,
      assetCode: campaign.assetCode,
      pledgedAt: earliestPledgeAt === Infinity ? 0 : earliestPledgeAt,
    });
  }

  const campaignCount = backedCampaigns.length;
  const badges = buildBadges({ campaignCount, totalPledged, refundedAmount, rank });

  return {
    address,
    totalPledged,
    refundedAmount,
    campaignCount,
    rank,
    badges,
    backedCampaigns: backedCampaigns.sort((a, b) => b.pledgedAt - a.pledgedAt),
    refundHistory: refundHistory.sort((a, b) => b.refundedAt - a.refundedAt),
  };
}
