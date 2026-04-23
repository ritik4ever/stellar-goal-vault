import { getDb, initDb } from "./db";
import { getCampaignHistory, recordEvent, BlockchainMetadata } from "./eventHistory";

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

export interface ReconciledPledgeInput extends PledgeInput {
  transactionHash: string;
  confirmedAt?: number;
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
  transactionHash?: string;
}

export interface RefundReconciliationInput {
  txHash: string;
  contractId?: string;
  networkPassphrase?: string;
  rpcUrl?: string;
  walletAddress?: string;
  ledger?: number;
  createdAt?: number;
  latestLedger?: number;
  source?: "local" | "soroban-contract";
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
  transaction_hash: string | null;
}

type ServiceError = Error & {
  statusCode?: number;
  code?: string;
};

function toServiceError(message: string, statusCode: number, code = "BAD_REQUEST"): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  error.code = code;
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
    transactionHash: row.transaction_hash ?? undefined,
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

function getPledgeByTransactionHash(transactionHash: string): PledgeRecord | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM pledges WHERE transaction_hash = ?`)
    .get(transactionHash) as PledgeRow | undefined;

  return row ? rowToPledge(row) : undefined;
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

export interface ListCampaignsOptions {
  searchQuery?: string;
  assetCode?: string;
  status?: CampaignStatus;
  page?: number;
  limit?: number;
}

export interface ListCampaignsResult {
  campaigns: CampaignRecord[];
  totalCount: number;
}

export function listCampaigns(options?: ListCampaignsOptions): ListCampaignsResult {
  const db = getDb();
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 10;
  const offset = (page - 1) * limit;

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (options?.searchQuery && options.searchQuery.trim()) {
    const searchTerm = `%${options.searchQuery.trim().toLowerCase()}%`;
    whereClauses.push(`(
      LOWER(id) LIKE ? OR 
      LOWER(title) LIKE ? OR 
      LOWER(creator) LIKE ?
    )`);
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (options?.assetCode) {
    whereClauses.push(`asset_code = ?`);
    params.push(options.assetCode.toUpperCase());
  }

  if (options?.status) {
    const now = Math.floor(Date.now() / 1000);
    switch (options.status) {
      case "claimed":
        whereClauses.push(`claimed_at IS NOT NULL`);
        break;
      case "funded":
        whereClauses.push(`claimed_at IS NULL AND pledged_amount >= target_amount`);
        break;
      case "failed":
        whereClauses.push(
          `claimed_at IS NULL AND pledged_amount < target_amount AND deadline <= ?`,
        );
        params.push(now);
        break;
      case "open":
        whereClauses.push(
          `claimed_at IS NULL AND pledged_amount < target_amount AND deadline > ?`,
        );
        params.push(now);
        break;
    }
  }

  let baseQuery = `FROM campaigns`;

  if (whereClauses.length > 0) {
    baseQuery += ` WHERE ` + whereClauses.join(" AND ");
  }

  const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
  const totalCount = (db.prepare(countQuery).get(...params) as { total: number }).total;

  const dataQuery = `SELECT * ${baseQuery} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(dataQuery).all(...params, limit, offset) as CampaignRow[];

  return {
    campaigns: rows.map(rowToCampaign),
    totalCount,
  };
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

  recordEvent(
    campaign.id,
    "created",
    campaign.createdAt,
    campaign.creator,
    undefined,
    {
      title: campaign.title,
      assetCode: campaign.assetCode,
      targetAmount: campaign.targetAmount,
      deadline: campaign.deadline,
    },
    { source: "local" } as BlockchainMetadata,
  );

  return campaign;
}

export interface UpdateCampaignInput {
  creator: string;
  title?: string;
  description?: string;
  targetAmount?: number;
}

export function updateCampaign(campaignId: string, input: UpdateCampaignInput): CampaignRecord {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404, "NOT_FOUND");
  }

  if (campaign.creator !== input.creator) {
    throw toServiceError(
      "Only the campaign creator can update the campaign.",
      403,
      "FORBIDDEN",
    );
  }

  const progress = calculateProgress(campaign);
  if (progress.status !== "open") {
    throw toServiceError(
      "Campaign can only be updated while in open state.",
      400,
      "INVALID_CAMPAIGN_STATE",
    );
  }

  const updates: Partial<CampaignRecord> = {};
  const eventMetadata: Record<string, unknown> = {};

  if (input.title !== undefined) {
    updates.title = input.title.trim();
    eventMetadata.title = updates.title;
  }
  if (input.description !== undefined) {
    updates.description = input.description.trim();
    eventMetadata.description = updates.description;
  }
  if (input.targetAmount !== undefined) {
    updates.targetAmount = round(input.targetAmount);
    eventMetadata.targetAmount = updates.targetAmount;
  }

  if (Object.keys(updates).length === 0) {
    throw toServiceError("No valid updates provided.", 400, "NO_UPDATES");
  }

  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.title !== undefined) {
    setClauses.push("title = ?");
    params.push(updates.title);
  }
  if (updates.description !== undefined) {
    setClauses.push("description = ?");
    params.push(updates.description);
  }
  if (updates.targetAmount !== undefined) {
    setClauses.push("target_amount = ?");
    params.push(updates.targetAmount);
  }

  params.push(campaignId);

  db.prepare(`UPDATE campaigns SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);

  const updatedAt = nowInSeconds();
  recordEvent(
    campaignId,
    "updated",
    updatedAt,
    input.creator,
    undefined,
    eventMetadata,
    { source: "local" } as BlockchainMetadata,
  );

  return getCampaign(campaignId)!;
}

export function addPledge(campaignId: string, input: PledgeInput): CampaignRecord {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404, "NOT_FOUND");
  }

  const progress = calculateProgress(campaign);
  if (!progress.canPledge) {
    throw toServiceError(
      "Campaign is no longer accepting pledges.",
      400,
      "INVALID_CAMPAIGN_STATE",
    );
  }

  const createdAt = nowInSeconds();
  const roundedAmount = round(input.amount);
  db.prepare(
    `INSERT INTO pledges (campaign_id, contributor, amount, created_at, refunded_at, transaction_hash)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  ).run(campaignId, input.contributor, roundedAmount, createdAt);

  db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount + ? WHERE id = ?`).run(
    roundedAmount,
    campaignId,
  );

  recordEvent(
    campaignId,
    "pledged",
    createdAt,
    input.contributor,
    roundedAmount,
    {
      newTotalPledged: round(campaign.pledgedAmount + roundedAmount),
      source: "backend-mvp",
    },
    { source: "local" } as BlockchainMetadata,
  );

  return getCampaign(campaignId)!;
}

export function reconcileOnChainPledge(
  campaignId: string,
  input: ReconciledPledgeInput,
): CampaignRecord {
  const existingPledge = getPledgeByTransactionHash(input.transactionHash);
  if (existingPledge) {
    if (existingPledge.campaignId !== campaignId) {
      throw toServiceError(
        "transactionHash already belongs to a different campaign.",
        409,
        "TRANSACTION_HASH_CONFLICT",
      );
    }

    return getCampaign(campaignId)!;
  }

  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404, "NOT_FOUND");
  }

  const progress = calculateProgress(campaign);
  if (!progress.canPledge) {
    throw toServiceError(
      "Campaign is no longer accepting pledges.",
      400,
      "INVALID_CAMPAIGN_STATE",
    );
  }

  const db = getDb();
  const createdAt = input.confirmedAt ?? nowInSeconds();
  const roundedAmount = round(input.amount);

  const reconcile = db.transaction(() => {
    db.prepare(
      `INSERT INTO pledges (
        campaign_id, contributor, amount, created_at, refunded_at, transaction_hash
      ) VALUES (?, ?, ?, ?, NULL, ?)`,
    ).run(campaignId, input.contributor, roundedAmount, createdAt, input.transactionHash);

    db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount + ? WHERE id = ?`).run(
      roundedAmount,
      campaignId,
    );

    recordEvent(
      campaignId,
      "pledged",
      createdAt,
      input.contributor,
      roundedAmount,
      {
        newTotalPledged: round(campaign.pledgedAmount + roundedAmount),
        onChain: true,
        reconciled: true,
      },
      {
        source: "soroban",
        txHash: input.transactionHash,
      } as BlockchainMetadata,
    );
  });

  reconcile();
  return getCampaign(campaignId)!;
}

export interface ReconciledClaimInput {
  creator: string;
  transactionHash: string;
  confirmedAt?: number;
}

function reconcileOnChainClaim(
  campaignId: string,
  input: ReconciledClaimInput,
): CampaignRecord {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404, "NOT_FOUND");
  }
  if (campaign.creator !== input.creator) {
    throw toServiceError(
      "Only the campaign creator can claim funds.",
      403,
      "FORBIDDEN",
    );
  }

  // Idempotency: if already claimed with this tx hash, return current state
  if (campaign.claimedAt) {
    return campaign;
  }

  const progress = calculateProgress(campaign);
  if (!progress.canClaim) {
    throw toServiceError("Campaign cannot be claimed yet.", 400, "INVALID_CAMPAIGN_STATE");
  }

  const claimedAt = input.confirmedAt ?? nowInSeconds();
  const db = getDb();

  const commit = db.transaction(() => {
    db.prepare(`UPDATE campaigns SET claimed_at = ? WHERE id = ?`).run(claimedAt, campaignId);

    recordEvent(
      campaignId,
      "claimed",
      claimedAt,
      input.creator,
      campaign.pledgedAmount,
      { targetAmount: campaign.targetAmount },
      {
        source: "soroban",
        txHash: input.transactionHash,
      } as BlockchainMetadata,
    );
  });

  commit();
  return getCampaign(campaignId)!;
}

export function claimCampaign(
  campaignId: string,
  input: ReconciledClaimInput,
): CampaignRecord {
  return reconcileOnChainClaim(campaignId, input);
}

export function refundContributor(
  campaignId: string,
  contributor: string,
  reconciliation?: RefundReconciliationInput,
): {
  campaign: CampaignRecord;
  refundedAmount: number;
} {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404, "NOT_FOUND");
  }

  const progress = calculateProgress(campaign);
  if (!progress.canRefund) {
    throw toServiceError(
      "Refunds are not available for this campaign.",
      400,
      "INVALID_CAMPAIGN_STATE",
    );
  }

  const refundablePledges = db
    .prepare(
      `SELECT * FROM pledges
       WHERE campaign_id = ? AND contributor = ? AND refunded_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    )
    .all(campaignId, contributor) as PledgeRow[];

  if (refundablePledges.length === 0) {
    throw toServiceError("No refundable pledges found for this contributor.", 404, "NOT_FOUND");
  }

  const refundedAmount = round(
    refundablePledges.reduce((sum, pledge) => sum + pledge.amount, 0),
  );
  const refundedAt = reconciliation?.createdAt ?? nowInSeconds();

  db.prepare(
    `UPDATE pledges SET refunded_at = ? WHERE campaign_id = ? AND contributor = ? AND refunded_at IS NULL`,
  ).run(refundedAt, campaignId, contributor);

  db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount - ? WHERE id = ?`).run(
    refundedAmount,
    campaignId,
  );

  recordEvent(campaignId, "refunded", refundedAt, contributor, refundedAmount, {
    refundedPledgeCount: refundablePledges.length,
    refundSource: reconciliation?.source ?? "local",
    txHash: reconciliation?.txHash,
    contractId: reconciliation?.contractId,
    networkPassphrase: reconciliation?.networkPassphrase,
    rpcUrl: reconciliation?.rpcUrl,
    walletAddress: reconciliation?.walletAddress,
    ledger: reconciliation?.ledger,
    latestLedger: reconciliation?.latestLedger,
  });

  return {
    campaign: getCampaign(campaignId)!,
    refundedAmount,
  };
}
