import { z } from "zod";
import { config } from "../config";

export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
export const CAMPAIGN_ID_REGEX = /^[1-9]\d*$/;
export const TX_HASH_REGEX = /^[A-Fa-f0-9]{64}$/;

export const campaignIdSchema = z
  .string()
  .trim()
  .regex(CAMPAIGN_ID_REGEX, "Campaign ID must be a positive integer.");

export const stellarAccountIdSchema = z
  .string()
  .trim()
  .regex(
    STELLAR_ACCOUNT_REGEX,
    "Must be a valid Stellar account ID (starts with G and is exactly 56 characters).",
  );

export const assetCodeSchema = z
  .string()
  .trim()
  .regex(ASSET_CODE_REGEX, "Asset code must be 1-12 alphanumeric characters.")
  .transform((value: string) => value.toUpperCase())
  .refine((code: string) => config.allowedAssets.includes(code), {
    message: `Asset code is not supported. Supported assets: ${config.allowedAssets.join(", ")}`,
  });

export const positiveAmountSchema = z.coerce
  .number()
  .finite("Amount must be a valid number.")
  .positive("Amount must be greater than zero.");

export const unixTimestampSchema = z.coerce
  .number()
  .int("deadline must be a valid UNIX timestamp in seconds.")
  .positive("deadline must be a valid UNIX timestamp in seconds.");

export const createCampaignPayloadSchema = z.object({
  creator: stellarAccountIdSchema,
  title: z.string().trim().min(4, "Title must be at least 4 characters.").max(80),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters.")
    .max(500),
  assetCode: assetCodeSchema,
  targetAmount: positiveAmountSchema,
  deadline: unixTimestampSchema,
  metadata: z
    .object({
      imageUrl: z.string().url().optional(),
      externalLink: z.string().url().optional(),
    })
    .optional(),
});

export const createPledgePayloadSchema = z.object({
  contributor: stellarAccountIdSchema,
  amount: positiveAmountSchema,
});

export const reconcilePledgePayloadSchema = z.object({
  contributor: stellarAccountIdSchema,
  amount: positiveAmountSchema,
  transactionHash: z
    .string()
    .trim()
    .regex(TX_HASH_REGEX, "transactionHash must be a 64-character hex hash."),
  confirmedAt: unixTimestampSchema.optional(),
});

export const claimCampaignPayloadSchema = z.object({
  creator: stellarAccountIdSchema,
  transactionHash: z
    .string()
    .trim()
    .regex(TX_HASH_REGEX, "transactionHash must be a 64-character hex hash."),
  confirmedAt: unixTimestampSchema.optional(),
});

const stellarTransactionHashSchema = z
  .string()
  .trim()
  .regex(/^[A-Fa-f0-9]{64}$/, "txHash must be a 64-character hex string.");

const sorobanRefundMetadataSchema = z.object({
  txHash: stellarTransactionHashSchema,
  contractId: z.string().trim().min(1, "contractId is required."),
  networkPassphrase: z.string().trim().min(1, "networkPassphrase is required."),
  rpcUrl: z.string().trim().url("rpcUrl must be a valid URL."),
  walletAddress: stellarAccountIdSchema,
  ledger: z.coerce.number().int().positive().optional(),
  createdAt: unixTimestampSchema.optional(),
  latestLedger: z.coerce.number().int().positive().optional(),
});

export const refundPayloadSchema = z.object({
  contributor: stellarAccountIdSchema,
  soroban: sorobanRefundMetadataSchema,
});

export const updateCampaignPayloadSchema = z.object({
  creator: stellarAccountIdSchema,
  title: z.string().trim().min(4, "Title must be at least 4 characters.").max(80).optional(),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters.")
    .max(500).optional(),
  targetAmount: positiveAmountSchema.optional(),
}).refine((data) => data.title || data.description || data.targetAmount, {
  message: "At least one field (title, description, or targetAmount) must be provided for update.",
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export type ValidationIssue = {
  field: string;
  message: string;
};

export function zodIssuesToValidationIssues(issues: z.ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message,
  }));
}

export function zodIssuesToErrorMessage(issues: z.ZodIssue[]): string {
  return zodIssuesToValidationIssues(issues)
    .map(({ field, message }) => `${field}: ${message}`)
    .join("; ");
}
