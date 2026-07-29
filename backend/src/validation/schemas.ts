import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { config } from '../config';
import { isValidStellarPublicKey } from './stellarAddress';
import { httpsOnlyUrlSchema } from './urlSafety';
import type { CampaignStatus, CampaignSortField, SortOrder } from "../services/campaignStore";

extendZodWithOpenApi(z);

export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
export const CAMPAIGN_ID_REGEX = /^[1-9]\d*$/;
export const TX_HASH_REGEX = /^[A-Fa-f0-9]{64}$/;

// Reusable schemas for URL-like fields that may be persisted verbatim
// and (eventually) fetched by the backend for OG image generation,
// link previews, or thumbnail rendering. See `./urlSafety.ts` for the
// full SSRF rationale and blocked-range list.

export const campaignIdSchema = z
  .string()
  .trim()
  .regex(CAMPAIGN_ID_REGEX, 'Campaign ID must be a positive integer.');

export const stellarAccountIdSchema = z
  .string()
  .trim()
  .regex(
    STELLAR_ACCOUNT_REGEX,
    'Must be a valid Stellar account ID (starts with G and is exactly 56 characters).',
  )
  .refine(isValidStellarPublicKey, {
    message: 'creator must be a valid Stellar public key',
  });

export const assetCodeSchema = z
  .string()
  .trim()
  .regex(ASSET_CODE_REGEX, 'Asset code must be 1-12 alphanumeric characters.')
  .transform((value: string) => value.toUpperCase())
  .refine((code: string) => config.allowedAssets.includes(code), {
    message: `Asset code is not supported. Supported assets: ${config.allowedAssets.join(', ')}`,
  });

export const positiveAmountSchema = z.coerce
  .number()
  .finite('Amount must be a valid number.')
  .positive('Amount must be greater than zero.');

export const optionalPositiveIntSchema = z.coerce
  .number()
  .finite('Value must be a valid number.')
  .int('Value must be an integer.')
  .nonnegative('Value must be non-negative.')
  .optional();

export const unixTimestampSchema = z.coerce
  .number()
  .int('deadline must be a valid UNIX timestamp in seconds.')
  .positive('deadline must be a valid UNIX timestamp in seconds.');

function sanitizeInput(val: string): string {
  return val
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\//g, "&sol;");
}

const containsSqlComment = (val: string) => /--|\/\*|\*\//.test(val);
const containsScriptTag = (val: string) => /<script/i.test(val);

export const createCampaignPayloadSchema = z.object({
  creator: stellarAccountIdSchema,
  title: z
    .string()
    .trim()
    .min(4, 'Title must be at least 4 characters.')
    .max(80)
    .transform(sanitizeInput)
    .refine((val) => !containsScriptTag(val), { message: 'Title cannot contain script tags.' })
    .refine((val) => !containsSqlComment(val), { message: 'Title cannot contain SQL comment sequences.' }),
  description: z
    .string()
    .trim()
    .min(20, 'Description must be at least 20 characters.')
    .max(500)
    .transform(sanitizeInput)
    .refine((val) => !containsScriptTag(val), { message: 'Description cannot contain script tags.' })
    .refine((val) => !containsSqlComment(val), { message: 'Description cannot contain SQL comment sequences.' }),
  acceptedTokens: z
    .array(assetCodeSchema)
    .min(1, 'At least one accepted token is required.'),
  targetAmount: positiveAmountSchema,
  deadline: unixTimestampSchema,
  // Campaign metadata URLs are user-controllable (issue #308). The
  // shared `httpsOnlyUrlSchema` enforces HTTPS-only and rejects host
  // literals that target private/loopback CIDRs. Pair with
  // `assertSafeRemoteUrl` whenever the backend actually fetches these.
  metadata: z
    .object({
      imageUrl: httpsOnlyUrlSchema.optional(),
      externalLink: httpsOnlyUrlSchema.optional(),
    })
    .optional(),
  maxPerContributor: optionalPositiveIntSchema,
});

export const createPledgePayloadSchema = z.object({
  contributor: stellarAccountIdSchema,
  amount: positiveAmountSchema,
  assetCode: assetCodeSchema,
});

export const reconcilePledgePayloadSchema = z.object({
  contributor: stellarAccountIdSchema,
  amount: positiveAmountSchema,
  assetCode: assetCodeSchema,
  transactionHash: z
    .string()
    .trim()
    .regex(TX_HASH_REGEX, 'transactionHash must be a 64-character hex hash.'),
  confirmedAt: unixTimestampSchema.optional(),
});

export const claimCampaignPayloadSchema = z.object({
  creator: stellarAccountIdSchema,
  transactionHash: z
    .string()
    .trim()
    .regex(TX_HASH_REGEX, 'transactionHash must be a 64-character hex hash.'),
  confirmedAt: unixTimestampSchema.optional(),
});

const stellarTransactionHashSchema = z
  .string()
  .trim()
  .regex(/^[A-Fa-f0-9]{64}$/, 'txHash must be a 64-character hex string.');

const sorobanRefundMetadataSchema = z.object({
  txHash: stellarTransactionHashSchema,
  contractId: z.string().trim().min(1, 'contractId is required.'),
  networkPassphrase: z.string().trim().min(1, 'networkPassphrase is required.'),
  rpcUrl: z.string().trim().url('rpcUrl must be a valid URL.'),
  walletAddress: stellarAccountIdSchema,
  ledger: z.coerce.number().int().positive().optional(),
  createdAt: unixTimestampSchema.optional(),
  latestLedger: z.coerce.number().int().positive().optional(),
});

export const refundPayloadSchema = z.object({
  contributor: stellarAccountIdSchema,
  soroban: sorobanRefundMetadataSchema,
});

function singleCampaignListQueryParam(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return undefined;
  }
  const s = String(raw).trim();
  return s === '' ? undefined : s;
}

function parsePositiveIntegerQueryParam(
  value: unknown,
  field: string,
  max?: number,
): { ok: true; value?: number } | { ok: false; issues: z.ZodIssue[] } {
  const raw = singleCampaignListQueryParam(value);
  if (raw === undefined) {
    return { ok: true };
  }

  const parsed = Number(raw);
  const issues: z.ZodIssue[] = [];

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    issues.push({
      code: 'custom',
      message: `${field} must be a positive integer.`,
      path: [field],
    } as any);
  } else if (max !== undefined && parsed > max) {
    issues.push({
      code: 'custom',
      message: `${field} must be an integer from 1 to ${max}.`,
      path: [field],
    } as any);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: parsed };
}

/**
 * Parses optional `page` and `limit` for GET /api/campaigns.
 * Omitting both means no pagination (caller lists the full filtered set).
 * Supplying only one is invalid (400).
 */
export function parseCampaignListPaginationQuery(query: {
  page?: unknown;
  limit?: unknown;
}):
  | { ok: true; page?: number; limit?: number }
  | { ok: false; issues: z.ZodIssue[] } {
  const pageStr = singleCampaignListQueryParam(query.page);
  const limitStr = singleCampaignListQueryParam(query.limit);

  if (pageStr === undefined && limitStr === undefined) {
    return { ok: true };
  }
  if (pageStr === undefined || limitStr === undefined) {
    return {
      ok: false,
      issues: [
        {
          code: 'custom',
          message: 'Pagination requires both page and limit query parameters.',
          path: pageStr === undefined ? ['page'] : ['limit'],
        } as any,
      ],
    };
  }

  const pageNum = Number(pageStr);
  const limitNum = Number(limitStr);
  const issues: z.ZodIssue[] = [];

  if (!Number.isFinite(pageNum) || !Number.isInteger(pageNum) || pageNum < 1) {
    issues.push({
      code: 'custom',
      message: 'page must be a positive integer.',
      path: ['page'],
    } as any);
  }
  if (
    !Number.isFinite(limitNum) ||
    !Number.isInteger(limitNum) ||
    limitNum < 1 ||
    limitNum > 100
  ) {
    issues.push({
      code: 'custom',
      message: 'limit must be an integer from 1 to 100.',
      path: ['limit'],
    } as any);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, page: pageNum, limit: limitNum };
}

export function parseHistoryPaginationQuery(query: {
  page?: unknown;
  pageSize?: unknown;
}): { ok: true; page: number; pageSize: number } | { ok: false; issues: z.ZodIssue[] } {
  const parsedPage = parsePositiveIntegerQueryParam(query.page, "page");
  const parsedPageSize = parsePositiveIntegerQueryParam(query.pageSize, "pageSize", 100);
  const issues: z.ZodIssue[] = [];

  if (!parsedPage.ok) {
    issues.push(...parsedPage.issues);
  }
  if (!parsedPageSize.ok) {
    issues.push(...parsedPageSize.issues);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    page: parsedPage.ok ? (parsedPage.value ?? 1) : 1,
    pageSize: parsedPageSize.ok ? (parsedPageSize.value ?? 20) : 20,
  };
}

export function parsePledgeListPaginationQuery(query: {
  page?: unknown;
  limit?: unknown;
}):
  | { ok: true; page: number; limit: number }
  | { ok: false; issues: z.ZodIssue[] } {
  const parsedPage = parsePositiveIntegerQueryParam(query.page, 'page');
  const parsedLimit = parsePositiveIntegerQueryParam(query.limit, 'limit', 100);
  const issues: z.ZodIssue[] = [];

  if (!parsedPage.ok) {
    issues.push(...parsedPage.issues);
  }
  if (!parsedLimit.ok) {
    issues.push(...parsedLimit.issues);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    page: parsedPage.ok ? (parsedPage.value ?? 1) : 1,
    limit: parsedLimit.ok ? (parsedLimit.value ?? 10) : 10,
  };
}

function parseIso8601Timestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.floor(timestamp / 1000);
}

function parseAssetCodes(value: unknown): string[] | null {
  if (typeof value !== 'string') {
    return null;
  }

  const codes = value.split(',').map(code => code.trim().toUpperCase()).filter(code => code.length > 0);
  return codes.length > 0 ? codes : null;
}

export interface CampaignListQueryParams {
  page?: number;
  limit?: number;
  q?: string;
  search?: string;
  asset?: string[];
  status?: CampaignStatus;
  sort?: CampaignSortField;
  order?: SortOrder;
  includeDeleted?: boolean;
  createdAfter?: number;
  createdBefore?: number;
}

export function parseCampaignListQuery(query: Record<string, unknown>):
  { ok: true; data: CampaignListQueryParams } | { ok: false; issues: z.ZodIssue[] } {
  const issues: z.ZodIssue[] = [];

  const pageStr = singleCampaignListQueryParam(query.page);
  const limitStr = singleCampaignListQueryParam(query.limit);

  let page: number | undefined;
  let limit: number | undefined;

  if (pageStr === undefined && limitStr === undefined) {
    page = undefined;
    limit = undefined;
  } else if (pageStr === undefined || limitStr === undefined) {
    issues.push({
      code: "custom",
      message: "Pagination requires both page and limit query parameters.",
      path: pageStr === undefined ? ["page"] : ["limit"],
    } as any);
  } else {
    const pageNum = Number(pageStr);
    const limitNum = Number(limitStr);

    if (!Number.isFinite(pageNum) || !Number.isInteger(pageNum) || pageNum < 1) {
      issues.push({
        code: "custom",
        message: "page must be a positive integer.",
        path: ["page"],
      } as any);
    } else {
      page = pageNum;
    }

    if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
      issues.push({
        code: "custom",
        message: "limit must be an integer from 1 to 100.",
        path: ["limit"],
      } as any);
    } else {
      limit = limitNum;
    }
  }

  const searchQuery = normalizeQueryValue(query.search) || normalizeQueryValue(query.q);

  const assetCodes = parseAssetCodes(query.asset);
  let assetList: string[] | undefined = undefined;
  if (query.asset !== undefined && assetCodes === null) {
    issues.push({
      code: "custom",
      message: "asset must be a comma-separated list of valid asset codes.",
      path: ["asset"],
    } as any);
  } else if (assetCodes) {
    const validCodes = assetCodes.filter(code => config.allowedAssets.includes(code));
    if (validCodes.length !== assetCodes.length) {
      issues.push({
        code: "custom",
        message: `Invalid asset code(s). Supported assets: ${config.allowedAssets.join(", ")}`,
        path: ["asset"],
      } as any);
    } else {
      assetList = validCodes;
    }
  }

  const statusStr = normalizeQueryValue(query.status);
  let status: CampaignStatus | undefined = undefined;
  const VALID_STATUSES: CampaignStatus[] = ['open', 'funded', 'claimed', 'failed'];
  if (statusStr !== undefined) {
    const lowerStatus = statusStr.toLowerCase();
    if (!VALID_STATUSES.includes(lowerStatus as CampaignStatus)) {
      issues.push({
        code: "custom",
        message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
        path: ["status"],
      } as any);
    } else {
      status = lowerStatus as CampaignStatus;
    }
  }

  const sortStr = normalizeQueryValue(query.sort);
  let sort: CampaignSortField | undefined = undefined;
  const VALID_SORTS = ['newest', 'deadline', 'percentFunded', 'totalPledged', 'createdAt', 'pledgedAmount', 'targetAmount'];
  if (sortStr !== undefined) {
    if (!VALID_SORTS.includes(sortStr)) {
      issues.push({
        code: "custom",
        message: `sort must be one of: ${VALID_SORTS.join(", ")}`,
        path: ["sort"],
      } as any);
    } else {
      if (sortStr === 'newest') {
        sort = 'createdAt';
      } else if (sortStr === 'percentFunded' || sortStr === 'totalPledged') {
        sort = 'pledgedAmount';
      } else {
        sort = sortStr as CampaignSortField;
      }
    }
  }

  const orderStr = normalizeQueryValue(query.order);
  let order: SortOrder | undefined = undefined;
  const VALID_ORDERS: SortOrder[] = ['asc', 'desc'];
  if (orderStr !== undefined) {
    if (!VALID_ORDERS.includes(orderStr as SortOrder)) {
      issues.push({
        code: "custom",
        message: `order must be one of: ${VALID_ORDERS.join(", ")}`,
        path: ["order"],
      } as any);
    } else {
      order = orderStr as SortOrder;
    }
  }

  const includeDeletedStr = singleCampaignListQueryParam(query.includeDeleted);
  let includeDeleted: boolean | undefined = undefined;
  if (includeDeletedStr !== undefined) {
    if (includeDeletedStr !== 'true' && includeDeletedStr !== 'false') {
      issues.push({
        code: "custom",
        message: "includeDeleted must be 'true' or 'false'.",
        path: ["includeDeleted"],
      } as any);
    } else {
      includeDeleted = includeDeletedStr === 'true';
    }
  }

  const createdAfterStr = normalizeQueryValue(query.createdAfter);
  let createdAfter: number | undefined = undefined;
  if (createdAfterStr !== undefined) {
    const timestamp = parseIso8601Timestamp(createdAfterStr);
    if (timestamp === null) {
      issues.push({
        code: "custom",
        message: "createdAfter must be a valid ISO 8601 timestamp.",
        path: ["createdAfter"],
      } as any);
    } else {
      createdAfter = timestamp;
    }
  }

  const createdBeforeStr = normalizeQueryValue(query.createdBefore);
  let createdBefore: number | undefined = undefined;
  if (createdBeforeStr !== undefined) {
    const timestamp = parseIso8601Timestamp(createdBeforeStr);
    if (timestamp === null) {
      issues.push({
        code: "custom",
        message: "createdBefore must be a valid ISO 8601 timestamp.",
        path: ["createdBefore"],
      } as any);
    } else {
      createdBefore = timestamp;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    data: {
      page,
      limit,
      q: query.q ? normalizeQueryValue(query.q) : undefined,
      search: query.search ? normalizeQueryValue(query.search) : undefined,
      asset: assetList,
      status,
      sort,
      order,
      includeDeleted,
      createdAfter,
      createdBefore,
    },
  };
}


export type ValidationIssue = {
  field: string;
  message: string;
};

export function zodIssuesToValidationIssues(
  issues: z.ZodIssue[],
): ValidationIssue[] {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  }));
}

export function zodIssuesToErrorMessage(issues: z.ZodIssue[]): string {
  return zodIssuesToValidationIssues(issues)
    .map(({ field, message }) => `${field}: ${message}`)
    .join('; ');
}

export function normalizeQueryValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
