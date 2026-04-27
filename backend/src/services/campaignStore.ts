import { getDb, initDb } from "./db";
import { getCampaignHistory, recordEvent, BlockchainMetadata } from "./eventHistory";

export type CampaignStatus = "open" | "funded" | "claimed" | "failed";

export interface CampaignInput {
  creator: string;
  title: string;
  description: string;
  acceptedTokens?: string[];
  assetCode?: string; // Backward compatibility
  targetAmount: number;
  deadline: number;
  metadata?: {
    imageUrl?: string;
    externalLink?: string;
  };
  maxPerContributor?: number;
}

export interface PledgeInput {
  contributor: string;
  amount: number;
  assetCode?: string; // Optional for backward compatibility if only one token
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
  acceptedTokens: string[];
  assetCode: string; // Backward compatibility (first token)
  targetAmount: number;
  pledgedAmount: number;
  deadline: number;
  createdAt: number;
  claimedAt?: number;
  deletedAt?: number;
  metadata?: {
    imageUrl?: string;
    externalLink?: string;
  };
  maxPerContributor?: number;
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
  assetCode: string;
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
  accepted_tokens_json: string; // JSON array of strings
  target_amount: number;
  pledged_amount: number;
  deadline: number;
  created_at: number;
  claimed_at: number | null;
  deleted_at: number | null;
  metadata_json: string | null;
  max_per_contributor: number | null;
}

interface PledgeRow {
  id: number;
  campaign_id: string;
  contributor: string;
  amount: number;
  asset_code: string;
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
  const acceptedTokens = JSON.parse(row.accepted_tokens_json);
  return {
    id: row.id,
    creator: row.creator,
    title: row.title,
    description: row.description,
    acceptedTokens: acceptedTokens,
    assetCode: acceptedTokens[0] || "",
    targetAmount: row.target_amount,
    pledgedAmount: row.pledged_amount,
    deadline: row.deadline,
    createdAt: row.created_at,
    claimedAt: row.claimed_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    maxPerContributor: row.max_per_contributor ?? undefined,
  };
}

function rowToPledge(row: PledgeRow): PledgeRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contributor: row.contributor,
    amount: row.amount,
    assetCode: row.asset_code,
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

function getContributorPledgedTotal(campaignId: string, contributor: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM pledges
       WHERE campaign_id = ? AND contributor = ? AND refunded_at IS NULL`,
    )
    .get(campaignId, contributor) as { total: number };

  return row.total;
}

export function initCampaignStore(): void {
  initDb();
}

function checkContributorLimit(campaign: CampaignRecord, contributor: string, amount: number): void {
  if (campaign.maxPerContributor !== undefined && campaign.maxPerContributor > 0) {
    const existingPledged = getContributorPledgedTotal(campaign.id, contributor);
    if (existingPledged + amount > campaign.maxPerContributor) {
      throw toServiceError(
        "Pledge exceeds maximum allowed per contributor.",
        400,
        "MAX_PER_CONTRIBUTOR_EXCEEDED"
      );
    }
  }
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
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
}

export interface ListCampaignsResult {
  campaigns: CampaignRecord[];
  totalCount: number;
}

export interface ListCampaignPledgesOptions {
  page: number;
  limit: number;
}

export interface ListCampaignPledgesResult {
  pledges: PledgeRecord[];
  totalCount: number;
}

export interface GlobalStats {
  totalCampaigns: number;
  campaignCountByStatus: Record<CampaignStatus, number>;
  totalPledgedAmount: number;
  totalContributors: number;
}

const MAX_CAMPAIGN_DURATION_SECONDS = 60 * 60 * 24 * 180;

export function listCampaigns(options?: ListCampaignsOptions): ListCampaignsResult {
  const db = getDb();
  const paginate = options?.page !== undefined && options?.limit !== undefined;
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 10;
  const offset = paginate ? (page - 1) * limit : 0;

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
    whereClauses.push(`accepted_tokens_json LIKE ?`);
    params.push(`%${options.assetCode.toUpperCase()}%`);
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

  if (!options?.includeDeleted) {
    whereClauses.push(`deleted_at IS NULL`);
  }

  if (whereClauses.length > 0) {
    baseQuery += ` WHERE ` + whereClauses.join(" AND ");
  }

  const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
  const totalCount = (db.prepare(countQuery).get(...params) as { total: number }).total;

  const dataQuery = paginate
    ? `SELECT * ${baseQuery} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    : `SELECT * ${baseQuery} ORDER BY created_at DESC`;
  const rows = (
    paginate
      ? db.prepare(dataQuery).all(...params, limit, offset)
      : db.prepare(dataQuery).all(...params)
  ) as CampaignRow[];

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

export function listCampaignPledges(
  campaignId: string,
  options: ListCampaignPledgesOptions,
): ListCampaignPledgesResult {
  const db = getDb();
  const offset = (options.page - 1) * options.limit;

  const totalCount = (
    db
      .prepare(`SELECT COUNT(*) AS total FROM pledges WHERE campaign_id = ?`)
      .get(campaignId) as { total: number }
  ).total;

  const rows = db
    .prepare(
      `SELECT *
       FROM pledges
       WHERE campaign_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(campaignId, options.limit, offset) as PledgeRow[];

  return {
    pledges: rows.map(rowToPledge),
    totalCount,
  };
}

export function getCampaignWithProgress(campaignId: string, pledgePreviewLimit = 5) {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    return undefined;
  }

  return {
    ...campaign,
    progress: calculateProgress(campaign),
    pledges: getPledges(campaignId).slice(0, pledgePreviewLimit),
    history: getCampaignHistory(campaignId),
  };
}

export function createCampaign(input: CampaignInput): CampaignRecord {
  const db = getDb();
  const now = nowInSeconds();
  if (input.deadline - now > MAX_CAMPAIGN_DURATION_SECONDS) {
    throw toServiceError(
      `Campaign duration exceeds maximum of ${MAX_CAMPAIGN_DURATION_SECONDS} seconds.`,
      400,
      "MAX_CAMPAIGN_DURATION_EXCEEDED",
    );
  }

  const acceptedTokens = input.acceptedTokens 
    ? input.acceptedTokens.map(code => code.trim().toUpperCase())
    : (input.assetCode ? [input.assetCode.trim().toUpperCase()] : []);

  if (acceptedTokens.length === 0) {
    throw toServiceError("At least one accepted token is required.", 400, "INVALID_INPUT");
  }

  const campaign: CampaignRecord = {
    id: nextCampaignId(),
    creator: input.creator,
    title: input.title.trim(),
    description: input.description.trim(),
    acceptedTokens,
    targetAmount: round(input.targetAmount),
    pledgedAmount: 0,
    deadline: input.deadline,
    createdAt: now,
    metadata: input.metadata,
    maxPerContributor: input.maxPerContributor,
  };

  db.prepare(
    `INSERT INTO campaigns (
      id, creator, title, description, accepted_tokens_json, target_amount, pledged_amount, deadline, created_at, claimed_at, metadata_json, max_per_contributor
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
  ).run(
    campaign.id,
    campaign.creator,
    campaign.title,
    campaign.description,
    JSON.stringify(campaign.acceptedTokens),
    campaign.targetAmount,
    campaign.pledgedAmount,
    campaign.deadline,
    campaign.createdAt,
    null,
    campaign.metadata ? JSON.stringify(campaign.metadata) : null,
    campaign.maxPerContributor ?? null,
  );

  recordEvent(
    campaign.id,
    "created",
    campaign.createdAt,
    campaign.creator,
    undefined,
    {
      title: campaign.title,
      acceptedTokens: campaign.acceptedTokens,
      targetAmount: campaign.targetAmount,
      deadline: campaign.deadline,
    },
    { source: "local" } as BlockchainMetadata,
  );

  return campaign;
}

export function addPledge(campaignId: string, input: PledgeInput): CampaignRecord {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404, "NOT_FOUND");
  }

  const assetCode = (input.assetCode || campaign.assetCode).toUpperCase();

  if (!campaign.acceptedTokens.includes(assetCode)) {
    throw toServiceError(
      `Asset ${assetCode} is not accepted by this campaign.`,
      400,
      "INVALID_ASSET",
    );
  }

  const progress = calculateProgress(campaign);
  if (!progress.canPledge) {
    throw toServiceError(
      "Campaign is no longer accepting pledges.",
      400,
      "INVALID_CAMPAIGN_STATE",
    );
  }

  checkContributorLimit(campaign, input.contributor, input.amount);

  const createdAt = nowInSeconds();
  const roundedAmount = round(input.amount);
  const nextPledgedAmount = round(campaign.pledgedAmount + roundedAmount);
  if (nextPledgedAmount > campaign.targetAmount) {
    throw toServiceError(
      "Pledge exceeds campaign funding cap.",
      400,
      "CAMPAIGN_FUNDING_CAP_EXCEEDED",
    );
  }
  db.prepare(
    `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at, refunded_at, transaction_hash)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(campaignId, input.contributor, roundedAmount, assetCode, createdAt);

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
      newTotalPledged: nextPledgedAmount,
      assetCode,
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

  checkContributorLimit(campaign, input.contributor, input.amount);

  const db = getDb();
  const createdAt = input.confirmedAt ?? nowInSeconds();
  const roundedAmount = round(input.amount);
  const assetCode = (input.assetCode || campaign.assetCode).toUpperCase();
  const nextPledgedAmount = round(campaign.pledgedAmount + roundedAmount);

  if (nextPledgedAmount > campaign.targetAmount) {
    throw toServiceError(
      "Pledge exceeds campaign funding cap.",
      400,
      "CAMPAIGN_FUNDING_CAP_EXCEEDED",
    );
  }

  const reconcile = db.transaction(() => {
    db.prepare(
      `INSERT INTO pledges (
        campaign_id, contributor, amount, asset_code, created_at, refunded_at, transaction_hash
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(campaignId, input.contributor, roundedAmount, assetCode, createdAt, input.transactionHash);

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
        newTotalPledged: nextPledgedAmount,
        assetCode: assetCode,
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

export function getGlobalStats(at = nowInSeconds()): GlobalStats {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS total_campaigns,
        SUM(CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END) AS claimed_count,
        SUM(CASE WHEN claimed_at IS NULL AND pledged_amount >= target_amount THEN 1 ELSE 0 END) AS funded_count,
        SUM(CASE WHEN claimed_at IS NULL AND pledged_amount < target_amount AND deadline <= ? THEN 1 ELSE 0 END) AS failed_count,
        SUM(CASE WHEN claimed_at IS NULL AND pledged_amount < target_amount AND deadline > ? THEN 1 ELSE 0 END) AS open_count,
        COALESCE(SUM(pledged_amount), 0) AS total_pledged
      FROM campaigns`,
    )
    .get(at, at) as {
    total_campaigns: number;
    claimed_count: number;
    funded_count: number;
    failed_count: number;
    open_count: number;
    total_pledged: number;
  };

  const contributorRow = db
    .prepare(
      `SELECT COUNT(DISTINCT contributor) AS total_contributors
       FROM pledges
       WHERE refunded_at IS NULL`,
    )
    .get() as { total_contributors: number };

  return {
    totalCampaigns: row.total_campaigns ?? 0,
    campaignCountByStatus: {
      open: row.open_count ?? 0,
      funded: row.funded_count ?? 0,
      claimed: row.claimed_count ?? 0,
      failed: row.failed_count ?? 0,
    },
    totalPledgedAmount: round(row.total_pledged ?? 0),
    totalContributors: contributorRow.total_contributors ?? 0,
  };
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

export function softDeleteCampaign(campaignId: string): void {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError("Campaign not found.", 404, "NOT_FOUND");
  }
  if (campaign.deletedAt) {
    throw toServiceError("Campaign already soft-deleted.", 409, "ALREADY_DELETED");
  }

  const deletedAt = nowInSeconds();
  const changes = db.prepare(`UPDATE campaigns SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(deletedAt, campaignId);

  if (changes.changes === 0) {
    throw toServiceError("Campaign not found or already deleted.", 404, "NOT_FOUND");
  }
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
