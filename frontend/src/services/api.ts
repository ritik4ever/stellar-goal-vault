import {
  AppConfig,
  Campaign,
  CampaignEvent,
  CreateCampaignPayload,
  CreatePledgePayload,
  OpenIssue,
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
