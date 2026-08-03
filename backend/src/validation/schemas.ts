import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { config } from '../config';
import type { CampaignStatus, CampaignSortField, SortOrder } from '../services/campaignStore';
import { httpsOnlyUrlSchema } from './urlSafety';

extendZodWithOpenApi(z);

export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
export const CAMPAIGN_ID_REGEX = /^[1-9]\d*$/;
export const TX_HASH_REGEX = /^[A-Fa-f0-9]{64}$/;

// Reusable schemas for URL-like fields that may be persisted verbatim
// and (eventually) fetched by the backend for OG image generation,
// link previews, or thumbnail rendering. See `./urlSafety.ts` for the
// full SSRF rationale and blocked-range list.

/**
 * Schema for campaign images supporting both HTTPS URLs and base64 data URLs.
 * Base64 data URLs must be JPG or PNG format and under 2MB when decoded.
 */
export const imageUrlSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      if (value.startsWith('data:')) {
        // Validate base64 data URL
        const dataUrlMatch = value.match(/^data:image\/(jpeg|png);base64,(.+)$/);
        if (!dataUrlMatch) {
          return false;
        }
        
        // Estimate decoded size (base64 adds ~33% overhead)
        // A base64 string of length N encodes roughly N * 0.75 bytes
        const base64Data = dataUrlMatch[2];
        const estimatedBytes = (base64Data.length * 3) / 4;
        const maxBytes = 2 * 1024 * 1024; // 2MB
        
        return estimatedBytes <= maxBytes;
      }
      
      // For HTTPS URLs, delegate to httpsOnlyUrlSchema
      try {
        httpsOnlyUrlSchema.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: 'Image must be a valid HTTPS URL or a base64 data URL (JPG/PNG, max 2MB)',
    },
  );

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
  );

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
  return val.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\//g, '&sol;');
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
    .refine((val) => val.trim().length >= 4, 'Title cannot be only whitespace.')
    .refine((val) => !containsScriptTag(val), 'Title cannot contain script tags.')
    .refine((val) => !containsSqlComment(val), 'Title cannot contain SQL comment sequences.')
    .transform((val) => sanitizeInput(val)),
  description: z
    .string()
    .trim()
    .min(20, 'Description must be at least 20 characters.')
    .max(500)
    .refine((val) => !containsScriptTag(val), 'Description cannot contain script tags.')
    .refine((val) => !containsSqlComment(val), 'Description cannot contain SQL comment sequences.')
    .transform((val) => sanitizeInput(val)),
  acceptedTokens: z.array(assetCodeSchema).min(1, 'At least one accepted token is required.'),
  targetAmount: positiveAmountSchema,
  deadline: unixTimestampSchema,
  // Campaign metadata URLs are user-controllable (issue #308). The
  // shared `httpsOnlyUrlSchema` enforces HTTPS-only and rejects host
  // literals that target private/loopback CIDRs. Pair with
  // `assertSafeRemoteUrl` whenever the backend actually fetches these.
  // imageUrl now also accepts base64 data URLs for direct uploads.
  metadata: z
    .object({
      imageUrl: imageUrlSchema.optional(),
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
  field: 'page' | 'limit' | 'pageSize',
  max?: number,
): { ok: true; value?: number } | { ok: false; issues: z.core.$ZodIssue[] } {
  const raw = singleCampaignListQueryParam(value);
  if (raw === undefined) {
    return { ok: true };
  }

  const parsed = Number(raw);
  const issues: z.core.$ZodIssue[] = [];

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    issues.push({
      code: 'custom',
      message: `${field} must be a positive integer.`,
      path: [field],
    });
  } else if (max !== undefined && parsed > max) {
    issues.push({
      code: 'custom',
      message: `${field} must be an integer from 1 to ${max}.`,
      path: [field],
    });
  }

export const createCampaignUpdatePayloadSchema = z
  .object({
    creator: stellarAccountIdSchema.optional(),
    creatorAddress: stellarAccountIdSchema.optional(),
    creator_address: stellarAccountIdSchema.optional(),
    content: z
      .string()
      .trim()
      .min(1, "Update content cannot be empty.")
      .max(2000, "Update content cannot exceed 2000 characters."),
  })
  .refine((data) => Boolean(data.creator || data.creatorAddress || data.creator_address), {
    message: "creator address is required.",
    path: ["creator"],
  })
  .transform((data) => ({
    creatorAddress: (data.creatorAddress || data.creator_address || data.creator)!,
    content: data.content,
  }));


export type ValidationIssue = {
  field: string;
  message: string;
};

export function zodIssuesToValidationIssues(issues: z.ZodIssue[]): ValidationIssue[] {
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

export const COMMENT_ID_REGEX = /^[1-9]\d*$/;

export const commentIdSchema = z
  .string()
  .trim()
  .regex(COMMENT_ID_REGEX, 'Comment ID must be a positive integer.');

export const createCommentPayloadSchema = z.object({
  author: stellarAccountIdSchema,
  content: z
    .string()
    .trim()
    .min(1, 'Comment content cannot be empty.')
    .max(500, 'Comment content cannot exceed 500 characters.'),
});

export const deleteCommentPayloadSchema = z.object({
  requestor: stellarAccountIdSchema,
});

export function parseCommentListPaginationQuery(query: {
  page?: unknown;
  limit?: unknown;
}): { ok: true; page: number; limit: number } | { ok: false; issues: z.core.$ZodIssue[] } {
  const parsedPage = parsePositiveIntegerQueryParam(query.page, 'page');
  const parsedLimit = parsePositiveIntegerQueryParam(query.limit, 'limit', 100);
  const issues: z.core.$ZodIssue[] = [];

  if (!parsedPage.ok) issues.push(...parsedPage.issues);
  if (!parsedLimit.ok) issues.push(...parsedLimit.issues);

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    page: parsedPage.ok ? (parsedPage.value ?? 1) : 1,
    limit: parsedLimit.ok ? (parsedLimit.value ?? 20) : 20,
  };
}
