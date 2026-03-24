import { getDb, initDb } from "./db";
import { getCampaignHistory, recordEvent } from "./eventHistory";

export type CampaignStatus = "open" | "funded" | "claimed" | "failed";

export interface CampaignInput {
  creator: string;
  title: string;
  description: string;
  assetCode: string;
  targetAmount: number;
  deadline: number;
  metadata?: {
    imageUrl?: string;
    externalLink?: string;
  };
}

export interface PledgeInput {
  contributor: string;
  amount: number;
}

export interface CampaignRecord {
  id: string;
  creator: string;
  title: string;
  description: string;
  assetCode: string;
  targetAmount: number;
  pledgedAmount: number;
  deadline: number;
  createdAt: number;
  claimedAt?: number;
  metadata?: {
    imageUrl?: string;
    externalLink?: string;
  };
}

export interface CampaignProgress {
  status: CampaignStatus;
  percentFunded: number;
  remainingAmount: number;
  pledgeCount: number;
  hoursLeft: number;
  canPledge: boolean;
  canClaim: boolean;
  canRefund: boolean;
}

export interface PledgeRecord {
  id: number;
  campaignId: string;
  contributor: string;
  amount: number;
  createdAt: number;
  refundedAt?: number;
}

interface CampaignRow {
  id: string;
  creator: string;
  title: string;
  description: string;
  asset_code: string;
  target_amount: number;
  pledged_amount: number;
  deadline: number;
  created_at: number;
  claimed_at: number | null;
  metadata_json: string | null;
}

interface PledgeRow {
  id: number;
  campaign_id: string;
  contributor: string;
  amount: number;
  created_at: number;
  refunded_at: number | null;
}

type ServiceError = Error & { statusCode?: number };

function toServiceError(message: string, statusCode: number): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function rowToCampaign(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    creator: row.creator,
    title: row.title,
    description: row.description,
    assetCode: row.asset_code,
    targetAmount: row.target_amount,
    pledgedAmount: row.pledged_amount,
    deadline: row.deadline,
    createdAt: row.created_at,
    claimedAt: row.claimed_at ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  };
}

function rowToPledge(row: PledgeRow): PledgeRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contributor: row.contributor,
    amount: row.amount,
    createdAt: row.created_at,
    refundedAt: row.refunded_at ?? undefined,
  };
}

function nextCampaignId(): string {
  const db = getDb();
  const row = db
    .prepare(`SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) AS latest FROM campaigns`)
    .get() as { latest: number };

  return String(row.latest + 1);
}

function getActivePledgeCount(campaignId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = ? AND refunded_at IS NULL`,
    )
    .get(campaignId) as { count: number };

  return row.count;
}

export function initCampaignStore(): void {
  initDb();
}

export function calculateProgress(
  campaign: CampaignRecord,
  at = nowInSeconds(),
): CampaignProgress {
  const deadlineReached = at >= campaign.deadline;
  const canClaim =
    campaign.claimedAt === undefined &&
    deadlineReached &&
    campaign.pledgedAmount >= campaign.targetAmount;
  const canRefund =
    campaign.claimedAt === undefined &&
    deadlineReached &&
    campaign.pledgedAmount < campaign.targetAmount;
  const canPledge = campaign.claimedAt === undefined && !deadlineReached;

  let status: CampaignStatus = "open";
  if (campaign.claimedAt !== undefined) {
    status = "claimed";
  } else if (campaign.pledgedAmount >= campaign.targetAmount) {
    status = "funded";
  } else if (deadlineReached) {
    status = "failed";
  }

  return {
    status,
    percentFunded: round((campaign.pledgedAmount / campaign.targetAmount) * 100),
    remainingAmount: round(Math.max(0, campaign.targetAmount - campaign.pledgedAmount)),
    pledgeCount: getActivePledgeCount(campaign.id),
    hoursLeft: round(Math.max(0, campaign.deadline - at) / 3600),
    canPledge,
    canClaim,
    canRefund,
  };
}

export function listCampaigns(): CampaignRecord[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM campaigns ORDER BY created_at DESC`)
    .all() as CampaignRow[];

  return rows.map(rowToCampaign);
}

export function getCampaign(campaignId: string): CampaignRecord | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM campaigns WHERE id = ?`)
    .get(campaignId) as CampaignRow | undefined;

  return row ? rowToCampaign(row) : undefined;
}

export function getPledges(campaignId: string): PledgeRecord[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC, id DESC`)
    .all(campaignId) as PledgeRow[];

  return rows.map(rowToPledge);
}

export function getCampaignWithProgress(campaignId: string) {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    return undefined;
  }

  return {
    ...campaign,
    progress: calculateProgress(campaign),
    pledges: getPledges(campaignId),
    history: getCampaignHistory(campaignId),
  };
}

export function createCampaign(input: CampaignInput): CampaignRecord {
  const db = getDb();
  const campaign: CampaignRecord = {
    id: nextCampaignId(),
    creator: input.creator,
    title: input.title.trim(),
    description: input.description.trim(),
    assetCode: input.assetCode.trim().toUpperCase(),
    targetAmount: round(input.targetAmount),
    pledgedAmount: 0,
    deadline: input.deadline,
    createdAt: nowInSeconds(),
    metadata: input.metadata,
  };

  db.prepare(
    `INSERT INTO campaigns (
      id, creator, title, description, asset_code, target_amount, pledged_amount, deadline, created_at, claimed_at, metadata_json
    ) VALUES (
      @id, @creator, @title, @description, @assetCode, @targetAmount, @pledgedAmount, @deadline, @createdAt, @claimedAt, @metadataJson
    )`,
  ).run({
    ...campaign,
    claimedAt: null,
    metadataJson: campaign.metadata ? JSON.stringify(campaign.metadata) : null,
  });

  recordEvent(campaign.id, "created", campaign.createdAt, campaign.creator, undefined, {
    title: campaign.title,
    assetCode: campaign.assetCode,
    targetAmount: campaign.targetAmount,
    deadline: campaign.deadline,
  });

  return campaign;
}

export function addPledge(campaignId: string, input: PledgeInput): CampaignRecord {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404);
  }

  const progress = calculateProgress(campaign);
  if (!progress.canPledge) {
    throw toServiceError("Campaign is no longer accepting pledges.", 400);
  }

  const createdAt = nowInSeconds();
  db.prepare(
    `INSERT INTO pledges (campaign_id, contributor, amount, created_at, refunded_at)
     VALUES (?, ?, ?, ?, NULL)`,
  ).run(campaignId, input.contributor, round(input.amount), createdAt);

  db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount + ? WHERE id = ?`).run(
    round(input.amount),
    campaignId,
  );

  recordEvent(campaignId, "pledged", createdAt, input.contributor, round(input.amount), {
    newTotalPledged: round(campaign.pledgedAmount + input.amount),
  });

  return getCampaign(campaignId)!;
}

export function claimCampaign(campaignId: string, creator: string): CampaignRecord {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404);
  }
  if (campaign.creator !== creator) {
    throw toServiceError("Only the campaign creator can claim funds.", 403);
  }

  const progress = calculateProgress(campaign);
  if (!progress.canClaim) {
    throw toServiceError("Campaign cannot be claimed yet.", 400);
  }

  const claimedAt = nowInSeconds();
  db.prepare(`UPDATE campaigns SET claimed_at = ? WHERE id = ?`).run(claimedAt, campaignId);

  recordEvent(campaignId, "claimed", claimedAt, creator, campaign.pledgedAmount, {
    targetAmount: campaign.targetAmount,
  });

  return getCampaign(campaignId)!;
}

export function refundContributor(campaignId: string, contributor: string): {
  campaign: CampaignRecord;
  refundedAmount: number;
} {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404);
  }

  const progress = calculateProgress(campaign);
  if (!progress.canRefund) {
    throw toServiceError("Refunds are not available for this campaign.", 400);
  }

  const refundablePledges = db
    .prepare(
      `SELECT * FROM pledges
       WHERE campaign_id = ? AND contributor = ? AND refunded_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    )
    .all(campaignId, contributor) as PledgeRow[];

  if (refundablePledges.length === 0) {
    throw toServiceError("No refundable pledges found for this contributor.", 404);
  }

  const refundedAmount = round(
    refundablePledges.reduce((sum, pledge) => sum + pledge.amount, 0),
  );
  const refundedAt = nowInSeconds();

  db.prepare(
    `UPDATE pledges SET refunded_at = ? WHERE campaign_id = ? AND contributor = ? AND refunded_at IS NULL`,
  ).run(refundedAt, campaignId, contributor);

  db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount - ? WHERE id = ?`).run(
    refundedAmount,
    campaignId,
  );

  recordEvent(campaignId, "refunded", refundedAt, contributor, refundedAmount, {
    refundedPledgeCount: refundablePledges.length,
  });

  return {
    campaign: getCampaign(campaignId)!,
    refundedAmount,
  };
}
