import {
  AppConfig,
  Campaign,
  CampaignEvent,
  CreateCampaignPayload,
  CreatePledgePayload,
  OpenIssue,
  ReconcilePledgePayload,
  SorobanRefundMetadata,
} from "../types/campaign";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

type ApiErrorBody = {
  error?: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    requestId?: string;
  };
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;

  if (!response.ok) {
    const errorMsg = body.error?.message ?? "Unexpected API error";
    const error = new Error(errorMsg);
    if (body.error) {
      (error as Error & { code?: string }).code = body.error.code;
      (
        error as Error & { details?: Array<{ field: string; message: string }> }
      ).details = body.error.details;
      (error as Error & { requestId?: string }).requestId = body.error.requestId;
    }
    throw error;
  }

  return body;
}

export async function listCampaigns(filters?: { includeDeleted?: boolean }): Promise<Campaign[]> {
  const params = new URLSearchParams();
  if (filters?.includeDeleted) {
    params.set('includeDeleted', 'true');
  }
  const url = `${API_BASE}/campaigns${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);
  const body = await parseResponse<{ data: Campaign[] }>(response);
  return body.data;
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}`);
  const body = await parseResponse<{ data: Campaign }>(response);
  return body.data;
}

export async function getAppConfig(): Promise<AppConfig> {
  const response = await fetch(`${API_BASE}/config`);
  const body = await parseResponse<{ data: AppConfig }>(response);
  return body.data;
}

export async function createCampaign(payload: CreateCampaignPayload): Promise<Campaign> {
  const response = await fetch(`${API_BASE}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseResponse<{ data: Campaign }>(response);
  return body.data;
}

export async function addPledge(
  campaignId: string,
  payload: CreatePledgePayload,
): Promise<Campaign> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/pledges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseResponse<{ data: Campaign }>(response);
  return body.data;
}

export async function reconcilePledge(
  campaignId: string,
  payload: ReconcilePledgePayload,
): Promise<{ campaign: Campaign; transactionHash: string }> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/pledges/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseResponse<{
    data: { campaign: Campaign; transactionHash: string };
  }>(response);
  return body.data;
}

export async function claimCampaign(
  campaignId: string,
  creator: string,
  transactionHash: string,
  confirmedAt: number,
): Promise<Campaign> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creator, transactionHash, confirmedAt }),
  });
  const body = await parseResponse<{ data: Campaign }>(response);
  return body.data;
}

export async function softDeleteCampaign(campaignId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/soft-delete`, {
    method: "POST",
  });
  if (!response.ok) {
    const content = await response.text();
    throw new Error(content || 'Soft delete failed');
  }
}

export async function refundCampaign(
  campaignId: string,
  contributor: string,
  soroban: SorobanRefundMetadata,
): Promise<Campaign> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contributor, soroban }),
  });
  const body = await parseResponse<{ data: Campaign }>(response);
  return body.data;
}

export async function getCampaignHistory(campaignId: string): Promise<CampaignEvent[]> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/history`);
  const body = await parseResponse<{ data: CampaignEvent[] }>(response);
  return body.data;
}

export async function listOpenIssues(): Promise<OpenIssue[]> {
  const response = await fetch(`${API_BASE}/open-issues`);
  const body = await parseResponse<{ data: OpenIssue[] }>(response);
  return body.data;
}
