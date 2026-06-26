import { getDb, initDb } from './db';
import { getCampaignHistory, recordEvent, BlockchainMetadata } from './eventHistory';

export type CampaignStatus = 'open' | 'funded' | 'claimed' | 'failed';

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
  failedAt?: number;
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
  source?: 'local' | 'soroban-contract';
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
  failed_at: number | null;
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

function toServiceError(message: string, statusCode: number, code = 'BAD_REQUEST'): ServiceError {
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
    assetCode: acceptedTokens[0] || '',
    targetAmount: row.target_amount,
    pledgedAmount: row.pledged_amount,
    deadline: row.deadline,
    createdAt: row.created_at,
    claimedAt: row.claimed_at ?? undefined,
    failedAt: row.failed_at ?? undefined,
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
    .prepare(`SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = ? AND refunded_at IS NULL`)
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

/**
 * Initializes the campaign store by setting up the underlying SQLite database.
 * Must be called once at application startup before any store functions are used.
 */
export function initCampaignStore(): void {
  initDb();
}

function checkContributorLimit(
  campaign: CampaignRecord,
  contributor: string,
  amount: number,
): void {
  if (campaign.maxPerContributor !== undefined && campaign.maxPerContributor > 0) {
    const existingPledged = getContributorPledgedTotal(campaign.id, contributor);
    if (existingPledged + amount > campaign.maxPerContributor) {
      throw toServiceError(
        'Pledge exceeds maximum allowed per contributor.',
        400,
        'MAX_PER_CONTRIBUTOR_EXCEEDED',
      );
    }
  }
}

/**
 * Derives the current progress and lifecycle state of a campaign.
 *
 * @param campaign - The campaign record to evaluate.
 * @param at - Unix timestamp (seconds) to evaluate state against; defaults to now.
 * @param pledgeCountOverride - Optional pledge count to use instead of querying database.
 * @returns A {@link CampaignProgress} object with status, funding percentages, and action flags.
 */
export function calculateProgress(campaign: CampaignRecord, at = nowInSeconds()): CampaignProgress {
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

  let status: CampaignStatus = 'open';
  if (campaign.claimedAt !== undefined) {
    status = 'claimed';
  } else if (campaign.pledgedAmount >= campaign.targetAmount) {
    status = 'funded';
  } else if (deadlineReached) {
    status = 'failed';
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

export type CampaignSortField = 'newest' | 'deadline' | 'percentFunded' | 'totalPledged';
export type SortOrder = 'asc' | 'desc';

export interface ListCampaignsOptions {
  searchQuery?: string;
  assetCode?: string;
  assetCodes?: string[];
  status?: CampaignStatus;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
  sort?: CampaignSortField;
  order?: SortOrder;
  createdAfter?: number;
  createdBefore?: number;
}

export interface ListCampaignsResult {
  campaigns: CampaignRecord[];
  totalCount: number;
  pledgeCounts: Record<string, number>;
}

export interface ListCampaignPledgesOptions {
  page: number;
  limit: number;
}

export interface ListCampaignPledgesResult {
  pledges: PledgeRecord[];
  totalCount: number;
}

export interface ContributorSummary {
  contributor: string;
  totalPledged: number;
  refundedAmount: number;
  isFullyRefunded: boolean;
}

export interface GlobalStats {
  totalCampaigns: number;
  campaignCountByStatus: Record<CampaignStatus, number>;
  totalPledgedAmount: number;
  totalContributors: number;
}

export interface LeaderboardEntry {
  rank: number;
  contributor: string;
  totalPledged: number;
  campaignCount: number;
  averagePledgeAmount: number;
}

const MAX_CAMPAIGN_DURATION_SECONDS = 60 * 60 * 24 * 180;

/**
 * Retrieves a paginated, filtered list of campaigns from the database.
 *
 * @param options - Optional filters: `searchQuery`, `assetCode`, `status`, `includeDeleted`, `page`, `limit`.
 * @returns A {@link ListCampaignsResult} with the matching campaign records and the total count.
 */
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
    const exactTerm = options.searchQuery.trim();
    whereClauses.push(`(LOWER(campaigns.title) LIKE ? OR LOWER(campaigns.creator) LIKE ? OR campaigns.id = ?)`);
    params.push(searchTerm, searchTerm, exactTerm);
  }

  if (options?.assetCode) {
    whereClauses.push(`campaigns.accepted_tokens_json LIKE ?`);
    params.push(`%${options.assetCode.toUpperCase()}%`);
  }

  if (options?.assetCodes && options.assetCodes.length > 0) {
    const conditions = options.assetCodes.map(() => `campaigns.accepted_tokens_json LIKE ?`).join(' OR ');
    whereClauses.push(`(${conditions})`);
    options.assetCodes.forEach(code => {
      params.push(`%${code.toUpperCase()}%`);
    });
  }

  if (options?.status) {
    const now = Math.floor(Date.now() / 1000);
    switch (options.status) {
      case 'claimed':
        whereClauses.push(`claimed_at IS NOT NULL`);
        break;
      case 'funded':
        whereClauses.push(`claimed_at IS NULL AND pledged_amount >= target_amount`);
        break;
      case 'failed':
        whereClauses.push(
          `campaigns.claimed_at IS NULL AND campaigns.pledged_amount < campaigns.target_amount AND campaigns.deadline <= ?`,
        );
        params.push(now);
        break;
      case 'open':
        whereClauses.push(`claimed_at IS NULL AND pledged_amount < target_amount AND deadline > ?`);
        params.push(now);
        break;
    }
  }

  if (options?.createdAfter !== undefined) {
    whereClauses.push(`campaigns.created_at >= ?`);
    params.push(options.createdAfter);
  }

  if (options?.createdBefore !== undefined) {
    whereClauses.push(`campaigns.created_at <= ?`);
    params.push(options.createdBefore);
  }

  if (!options?.includeDeleted) {
    whereClauses.push(`campaigns.deleted_at IS NULL`);
  }

  let whereClause = '';
  if (whereClauses.length > 0) {
    whereClause = ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const countQuery = `SELECT COUNT(DISTINCT campaigns.id) as total FROM campaigns LEFT JOIN pledges ON campaigns.id = pledges.campaign_id AND pledges.refunded_at IS NULL${whereClause}`;
  const totalCount = (db.prepare(countQuery).get(...params) as { total: number }).total;

  // Build ORDER BY clause from sort options
  const sortField = options?.sort ?? 'newest';
  const sortOrder = options?.order ?? 'desc';
  const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';
  let orderByClause: string;
  switch (sortField) {
    case 'deadline':
      orderByClause = `campaigns.deadline ${sortOrder === 'desc' ? 'DESC' : 'ASC'}`;
      break;
    case 'percentFunded':
      orderByClause = `(CAST(campaigns.pledged_amount AS REAL) / CAST(campaigns.target_amount AS REAL)) ${orderDir}`;
      break;
    case 'totalPledged':
      orderByClause = `campaigns.pledged_amount ${orderDir}`;
      break;
    case 'newest':
    default:
      orderByClause = `campaigns.created_at ${orderDir}`;
      break;
  }

  const dataQuery = paginate
    ? `SELECT campaigns.*, COUNT(pledges.id) as pledge_count FROM campaigns LEFT JOIN pledges ON campaigns.id = pledges.campaign_id AND pledges.refunded_at IS NULL${whereClause} GROUP BY campaigns.id ORDER BY ${orderByClause} LIMIT ? OFFSET ?`
    : `SELECT campaigns.*, COUNT(pledges.id) as pledge_count FROM campaigns LEFT JOIN pledges ON campaigns.id = pledges.campaign_id AND pledges.refunded_at IS NULL${whereClause} GROUP BY campaigns.id ORDER BY ${orderByClause}`;

  const rows = (
    paginate
      ? db.prepare(dataQuery).all(...params, limit, offset)
      : db.prepare(dataQuery).all(...params)
  ) as Array<CampaignRow & { pledge_count: number }>;

  const pledgeCounts: Record<string, number> = {};
  const campaigns = rows.map((row) => {
    pledgeCounts[row.id] = row.pledge_count;
    const { pledge_count, ...campaignRow } = row;
    
    const now = Math.floor(Date.now() / 1000);
    if (campaignRow.claimed_at === null && campaignRow.pledged_amount < campaignRow.target_amount && now >= campaignRow.deadline && campaignRow.failed_at === null) {
        campaignRow.failed_at = campaignRow.deadline;
        db.prepare(`UPDATE campaigns SET failed_at = ? WHERE id = ?`).run(campaignRow.deadline, campaignRow.id);
    }
    
    return rowToCampaign(campaignRow as CampaignRow);
  });

  return {
    campaigns,
    totalCount,
    pledgeCounts,
  };
}

/**
 * Fetches a single campaign by its ID.
 *
 * @param campaignId - The unique campaign identifier.
 * @returns The {@link CampaignRecord} if found, or `undefined` if it does not exist.
 */
export function getCampaign(campaignId: string): CampaignRecord | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(campaignId) as
    | CampaignRow
    | undefined;

  if (row) {
    const now = Math.floor(Date.now() / 1000);
    if (row.claimed_at === null && row.pledged_amount < row.target_amount && now >= row.deadline && row.failed_at === null) {
        row.failed_at = row.deadline;
        db.prepare(`UPDATE campaigns SET failed_at = ? WHERE id = ?`).run(row.deadline, row.id);
    }
    return rowToCampaign(row);
  }
  return undefined;
}

/**
 * Returns all pledges for a campaign, ordered by most recent first.
 *
 * @param campaignId - The unique campaign identifier.
 * @returns An array of {@link PledgeRecord} objects (may be empty).
 */
export function getPledges(campaignId: string): PledgeRecord[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM pledges WHERE campaign_id = ? ORDER BY created_at DESC, id DESC`)
    .all(campaignId) as PledgeRow[];

  return rows.map(rowToPledge);
}

/**
 * Returns a paginated list of pledges for a specific campaign.
 *
 * @param campaignId - The unique campaign identifier.
 * @param options - Pagination options: `page` (1-based) and `limit` (records per page).
 * @returns A {@link ListCampaignPledgesResult} with pledge records and the total count.
 */
export function listCampaignPledges(
  campaignId: string,
  options: ListCampaignPledgesOptions,
): ListCampaignPledgesResult {
  const db = getDb();
  const offset = (options.page - 1) * options.limit;

  const totalCount = (
    db.prepare(`SELECT COUNT(*) AS total FROM pledges WHERE campaign_id = ?`).get(campaignId) as {
      total: number;
    }
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

/**
 * Aggregates pledge totals per contributor for a campaign, including refunded amounts.
 *
 * @param campaignId - The unique campaign identifier.
 * @returns An array of {@link ContributorSummary} objects sorted by total pledged (descending),
 *          or an empty array if the campaign does not exist.
 */
export function getContributorSummary(
  campaignId: string,
): ContributorSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT 
      contributor,
      COALESCE(SUM(CASE WHEN refunded_at IS NULL THEN amount ELSE 0 END), 0) as totalPledged,
      COALESCE(SUM(CASE WHEN refunded_at IS NOT NULL THEN amount ELSE 0 END), 0) as refundedAmount
    FROM pledges 
    WHERE campaign_id = ?
    GROUP BY contributor 
    ORDER BY totalPledged DESC
  `,
    )
    .all(campaignId) as Array<{
    contributor: string;
    totalPledged: number;
    refundedAmount: number;
  }>;

  const campaign = getCampaign(campaignId);
  if (!campaign) {
    return [];
  }

  return rows.map((row) => ({
    contributor: row.contributor,
    totalPledged: Number(row.totalPledged),
    refundedAmount: Number(row.refundedAmount),
    isFullyRefunded: row.refundedAmount > 0 && row.totalPledged === 0,
  }));
}

/**
 * Fetches a campaign enriched with its calculated progress, recent pledges, and event history.
 *
 * @param campaignId - The unique campaign identifier.
 * @param pledgePreviewLimit - Maximum number of recent pledges to include (default: 5).
 * @returns The enriched campaign object, or `undefined` if the campaign does not exist.
 */
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

/**
 * Creates a new campaign and records a "created" lifecycle event.
 *
 * @param input - The campaign creation payload (see {@link CampaignInput}).
 * @returns The newly created {@link CampaignRecord}.
 * @throws {ServiceError} 400 `MAX_CAMPAIGN_DURATION_EXCEEDED` if the deadline is too far in the future.
 * @throws {ServiceError} 400 `INVALID_INPUT` if no accepted tokens are provided.
 */
export function createCampaign(input: CampaignInput): CampaignRecord {
  const db = getDb();
  const now = nowInSeconds();
  if (input.deadline - now > MAX_CAMPAIGN_DURATION_SECONDS) {
    throw toServiceError(
      `Campaign duration exceeds maximum of ${MAX_CAMPAIGN_DURATION_SECONDS} seconds.`,
      400,
      'MAX_CAMPAIGN_DURATION_EXCEEDED',
    );
  }

  const acceptedTokens = input.acceptedTokens
    ? input.acceptedTokens.map((code) => code.trim().toUpperCase())
    : input.assetCode
      ? [input.assetCode.trim().toUpperCase()]
      : [];

  if (acceptedTokens.length === 0) {
    throw toServiceError('At least one accepted token is required.', 400, 'INVALID_INPUT');
  }

  const campaign: CampaignRecord = {
    id: nextCampaignId(),
    creator: input.creator,
    title: input.title.trim(),
    description: input.description.trim(),
    acceptedTokens,
    assetCode: acceptedTokens[0] || "",
    targetAmount: round(input.targetAmount),
    pledgedAmount: 0,
    deadline: input.deadline,
    createdAt: now,
    metadata: input.metadata,
    maxPerContributor: input.maxPerContributor,
  };

  db.prepare(
    `INSERT INTO campaigns (
      id, creator, title, description, accepted_tokens_json, target_amount, pledged_amount, deadline, created_at, claimed_at, failed_at, metadata_json, max_per_contributor
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    null,
    campaign.metadata ? JSON.stringify(campaign.metadata) : null,
    campaign.maxPerContributor ?? null,
  );

  recordEvent(
    campaign.id,
    'created',
    campaign.createdAt,
    campaign.creator,
    undefined,
    {
      title: campaign.title,
      acceptedTokens: campaign.acceptedTokens,
      targetAmount: campaign.targetAmount,
      deadline: campaign.deadline,
    },
    { source: 'local' } as BlockchainMetadata,
  );

  return campaign;
}

/**
 * Records an off-chain pledge for a campaign and updates the pledged total.
 *
 * @param campaignId - The ID of the campaign to pledge to.
 * @param input - The pledge payload (contributor address, amount, optional asset code).
 * @returns The updated {@link CampaignRecord} after the pledge is applied.
 * @throws {ServiceError} 404 `NOT_FOUND` if the campaign does not exist.
 * @throws {ServiceError} 400 `INVALID_ASSET` if the token is not accepted by the campaign.
 * @throws {ServiceError} 400 `INVALID_CAMPAIGN_STATE` if the campaign is no longer accepting pledges.
 * @throws {ServiceError} 400 `MAX_PER_CONTRIBUTOR_EXCEEDED` if the contributor limit is breached.
 * @throws {ServiceError} 400 `CAMPAIGN_FUNDING_CAP_EXCEEDED` if the pledge would exceed the target amount.
 */
export function addPledge(campaignId: string, input: PledgeInput): CampaignRecord {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const assetCode = (input.assetCode || campaign.assetCode).toUpperCase();

  if (!campaign.acceptedTokens.includes(assetCode)) {
    throw toServiceError(
      `Asset ${assetCode} is not accepted by this campaign.`,
      400,
      'INVALID_ASSET',
    );
  }

  const progress = calculateProgress(campaign);
  if (!progress.canPledge) {
    throw toServiceError('Campaign is no longer accepting pledges.', 400, 'INVALID_CAMPAIGN_STATE');
  }

  checkContributorLimit(campaign, input.contributor, input.amount);

  const createdAt = nowInSeconds();
  const roundedAmount = round(input.amount);
  const nextPledgedAmount = round(campaign.pledgedAmount + roundedAmount);
  if (nextPledgedAmount > campaign.targetAmount) {
    throw toServiceError(
      'Pledge exceeds campaign funding cap.',
      400,
      'CAMPAIGN_FUNDING_CAP_EXCEEDED',
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
    'pledged',
    createdAt,
    input.contributor,
    roundedAmount,
    {
      newTotalPledged: nextPledgedAmount,
      assetCode,
      source: 'backend-mvp',
    },
    { source: 'local' } as BlockchainMetadata,
  );

  // Check if contributor has reached their limit and record event
  if (
    campaign.maxPerContributor !== undefined &&
    campaign.maxPerContributor > 0
  ) {
    const newContributorTotal = round(
      getContributorPledgedTotal(campaignId, input.contributor),
    );
    if (newContributorTotal >= campaign.maxPerContributor) {
      recordEvent(
        campaignId,
        "pledge_limit_reached",
        createdAt,
        input.contributor,
        newContributorTotal,
        {
          maxPerContributor: campaign.maxPerContributor,
          assetCode,
        },
        { source: "local" } as BlockchainMetadata,
      );
    }
  }

  return getCampaign(campaignId)!;
}

/**
 * Reconciles an on-chain Soroban pledge into the local database, deduplicating by transaction hash.
 *
 * @param campaignId - The ID of the campaign the pledge belongs to.
 * @param input - The reconciled pledge payload including a mandatory `transactionHash`.
 * @returns The updated {@link CampaignRecord} after the pledge is applied (or the existing record if already reconciled).
 * @throws {ServiceError} 409 `TRANSACTION_HASH_CONFLICT` if the tx hash belongs to a different campaign.
 * @throws {ServiceError} 404 `NOT_FOUND` if the campaign does not exist.
 * @throws {ServiceError} 400 `INVALID_CAMPAIGN_STATE` if the campaign is no longer accepting pledges.
 * @throws {ServiceError} 400 `MAX_PER_CONTRIBUTOR_EXCEEDED` if the contributor limit is breached.
 * @throws {ServiceError} 400 `CAMPAIGN_FUNDING_CAP_EXCEEDED` if the pledge would exceed the target amount.
 */
export function reconcileOnChainPledge(
  campaignId: string,
  input: ReconciledPledgeInput,
): CampaignRecord {
  const existingPledge = getPledgeByTransactionHash(input.transactionHash);
  if (existingPledge) {
    if (existingPledge.campaignId !== campaignId) {
      throw toServiceError(
        'transactionHash already belongs to a different campaign.',
        409,
        'TRANSACTION_HASH_CONFLICT',
      );
    }

    return getCampaign(campaignId)!;
  }

  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const progress = calculateProgress(campaign);
  if (!progress.canPledge) {
    throw toServiceError('Campaign is no longer accepting pledges.', 400, 'INVALID_CAMPAIGN_STATE');
  }

  checkContributorLimit(campaign, input.contributor, input.amount);

  const db = getDb();
  const createdAt = input.confirmedAt ?? nowInSeconds();
  const roundedAmount = round(input.amount);
  const assetCode = (input.assetCode || campaign.assetCode).toUpperCase();
  const nextPledgedAmount = round(campaign.pledgedAmount + roundedAmount);

  if (nextPledgedAmount > campaign.targetAmount) {
    throw toServiceError(
      'Pledge exceeds campaign funding cap.',
      400,
      'CAMPAIGN_FUNDING_CAP_EXCEEDED',
    );
  }

  const reconcile = db.transaction(() => {
    db.prepare(
      `INSERT INTO pledges (
        campaign_id, contributor, amount, asset_code, created_at, refunded_at, transaction_hash
      ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      campaignId,
      input.contributor,
      roundedAmount,
      assetCode,
      createdAt,
      input.transactionHash,
    );

    db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount + ? WHERE id = ?`).run(
      roundedAmount,
      campaignId,
    );

    recordEvent(
      campaignId,
      'pledged',
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
        source: 'soroban',
        txHash: input.transactionHash,
      } as BlockchainMetadata,
    );
  });

  reconcile();
  return getCampaign(campaignId)!;
}

/**
 * Returns aggregated statistics across all campaigns and pledges.
 *
 * @param at - Unix timestamp (seconds) used to classify campaign statuses; defaults to now.
 * @returns A {@link GlobalStats} object with total campaigns, per-status counts, total pledged, and unique contributor count.
 */
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

function reconcileOnChainClaim(campaignId: string, input: ReconciledClaimInput): CampaignRecord {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError('Campaign not found.', 404, 'NOT_FOUND');
  }
  if (campaign.creator !== input.creator) {
    throw toServiceError('Only the campaign creator can claim funds.', 403, 'FORBIDDEN');
  }

  if (campaign.claimedAt) {
    return campaign;
  }

  const progress = calculateProgress(campaign);
  if (!progress.canClaim) {
    throw toServiceError('Campaign cannot be claimed yet.', 400, 'INVALID_CAMPAIGN_STATE');
  }

  const claimedAt = input.confirmedAt ?? nowInSeconds();
  const db = getDb();

  const commit = db.transaction(() => {
    db.prepare(`UPDATE campaigns SET claimed_at = ? WHERE id = ?`).run(claimedAt, campaignId);

    recordEvent(
      campaignId,
      'claimed',
      claimedAt,
      input.creator,
      campaign.pledgedAmount,
      { targetAmount: campaign.targetAmount },
      {
        source: 'soroban',
        txHash: input.transactionHash,
      } as BlockchainMetadata,
    );
  });

  commit();
  return getCampaign(campaignId)!;
}

/**
 * Claims the funded balance of a campaign for its creator by reconciling an on-chain Soroban transaction.
 *
 * @param campaignId - The ID of the campaign to claim.
 * @param input - Claim payload with `creator` address and on-chain `transactionHash`.
 * @returns The updated {@link CampaignRecord} with `claimedAt` set.
 * @throws {ServiceError} 404 `NOT_FOUND` if the campaign does not exist.
 * @throws {ServiceError} 403 `FORBIDDEN` if the caller is not the campaign creator.
 * @throws {ServiceError} 400 `INVALID_CAMPAIGN_STATE` if the campaign cannot be claimed yet.
 */
export function claimCampaign(campaignId: string, input: ReconciledClaimInput): CampaignRecord {
  return reconcileOnChainClaim(campaignId, input);
}

/**
 * Soft-deletes a campaign by setting its `deleted_at` timestamp.
 * The record remains in the database but is excluded from normal queries.
 *
 * @param campaignId - The unique campaign identifier.
 * @throws {ServiceError} 404 `NOT_FOUND` if the campaign does not exist.
 * @throws {ServiceError} 409 `ALREADY_DELETED` if the campaign has already been soft-deleted.
 */
export function softDeleteCampaign(campaignId: string): void {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw toServiceError('Campaign not found.', 404, 'NOT_FOUND');
  }
  if (campaign.deletedAt) {
    throw toServiceError('Campaign already soft-deleted.', 409, 'ALREADY_DELETED');
  }

  const deletedAt = nowInSeconds();
  const changes = db
    .prepare(`UPDATE campaigns SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(deletedAt, campaignId);

  if (changes.changes === 0) {
    throw toServiceError('Campaign not found or already deleted.', 404, 'NOT_FOUND');
  }
}

/**
 * Marks all active pledges for a contributor as refunded and decrements the campaign's pledged total.
 *
 * @param campaignId - The ID of the campaign containing the pledges to refund.
 * @param contributor - The wallet address of the contributor to refund.
 * @param reconciliation - Optional on-chain reconciliation data (tx hash, ledger info, contract ID).
 * @returns An object with the updated {@link CampaignRecord} and the total `refundedAmount`.
 * @throws {ServiceError} 404 `NOT_FOUND` if the campaign or any refundable pledges do not exist.
 * @throws {ServiceError} 400 `INVALID_CAMPAIGN_STATE` if refunds are not available for this campaign.
 */
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
    throw toServiceError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const progress = calculateProgress(campaign);
  if (!progress.canRefund) {
    throw toServiceError(
      'Refunds are not available for this campaign.',
      400,
      'INVALID_CAMPAIGN_STATE',
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
    throw toServiceError('No refundable pledges found for this contributor.', 404, 'NOT_FOUND');
  }

  const refundedAmount = round(refundablePledges.reduce((sum, pledge) => sum + pledge.amount, 0));
  const refundedAt = reconciliation?.createdAt ?? nowInSeconds();

  db.prepare(
    `UPDATE pledges SET refunded_at = ? WHERE campaign_id = ? AND contributor = ? AND refunded_at IS NULL`,
  ).run(refundedAt, campaignId, contributor);

  db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount - ? WHERE id = ?`).run(
    refundedAmount,
    campaignId,
  );

  recordEvent(campaignId, 'refunded', refundedAt, contributor, refundedAmount, {
    refundedPledgeCount: refundablePledges.length,
    refundSource: reconciliation?.source ?? 'local',
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

/**
 * Retrieves the top contributors globally, ranked by total pledged amount.
 *
 * @param limit - Maximum number of top contributors to return (default: 10).
 * @returns An array of {@link LeaderboardEntry} objects sorted by total pledged amount (descending).
 */
export function getTopContributors(limit: number = 10): LeaderboardEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT 
         contributor,
         COALESCE(SUM(amount), 0) AS total_pledged,
         COUNT(DISTINCT campaign_id) AS campaign_count,
         COALESCE(AVG(amount), 0) AS avg_pledge
       FROM pledges
       WHERE refunded_at IS NULL
       GROUP BY contributor
       ORDER BY total_pledged DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    contributor: string;
    total_pledged: number;
    campaign_count: number;
    avg_pledge: number;
  }>;

  return rows.map((row, index) => ({
    rank: index + 1,
    contributor: row.contributor,
    totalPledged: round(row.total_pledged),
    campaignCount: row.campaign_count,
    averagePledgeAmount: round(row.avg_pledge),
  }));
}
