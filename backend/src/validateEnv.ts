import { z } from 'zod';

const bodySizeRegex = /^\d+\s*(?:b|kb|mb|gb)?$/i;
const nonNegativeIntRegex = /^\d+$/;

export const envSchema = z
  .object({
    // Required in production
    CONTRACT_ID: z
      .string()
      .optional()
      .describe('Required in production for Soroban pledge signing'),

    // Environment & Port
    PORT: z.string().optional().describe('default: 3001'),
    NODE_ENV: z.string().optional().describe('default: development'),
    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error', 'silent'])
      .optional()
      .describe('default: info'),
    DB_PATH: z.string().optional().describe('default: backend/data/campaigns.db'),

    // Network & Soroban
    SOROBAN_RPC_URL: z
      .string()
      .url('SOROBAN_RPC_URL must be a valid URL')
      .optional()
      .describe('default: testnet RPC in non-production; required in production'),
    SOROBAN_NETWORK_PASSPHRASE: z
      .string()
      .optional()
      .describe('default: testnet passphrase in non-production; required in production'),

    // CORS & Authentication
    // SECURITY: Default is empty (allows all) for local dev convenience. In production, this MUST be set to explicit origins.
    // Risk: Leaving this empty or using '*' in production allows any website to make authenticated requests to your API (CSRF/credential theft).
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .describe('default: (empty — all origins allowed in dev); REQUIRED in production'),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .optional()
      .describe('backwards-compatible alias for ALLOWED_ORIGINS'),
    API_KEYS: z
      .string()
      .optional()
      .describe('Comma-separated valid API keys; required in production'),

    // Assets & Contract settings
    ALLOWED_ASSETS: z.string().optional().describe('default: USDC,XLM'),
    ASSET_ADDRESSES: z.string().optional().describe('default: XLM and USDC testnet addresses'),
    CONTRACT_AMOUNT_DECIMALS: z
      .string()
      .regex(nonNegativeIntRegex, 'CONTRACT_AMOUNT_DECIMALS must be a non-negative integer')
      .optional()
      .describe('default: 2'),
    DEFAULT_MAX_PER_CONTRIBUTOR: z
      .string()
      .regex(nonNegativeIntRegex, 'DEFAULT_MAX_PER_CONTRIBUTOR must be a non-negative integer')
      .optional()
      .describe('default: 0 (no limit)'),

    // Request Input & Rate Limit configuration validation
    MAX_BODY_SIZE: z
      .string()
      .regex(bodySizeRegex, 'MAX_BODY_SIZE must be a valid size string (e.g. 16kb, 1mb, 1024)')
      .optional()
      .describe('default: 16kb'),
    RATE_LIMIT_WINDOW_MS: z
      .string()
      .regex(nonNegativeIntRegex, 'RATE_LIMIT_WINDOW_MS must be a non-negative integer')
      .optional()
      .describe('default: 60000'),
    RATE_LIMIT_MAX_REQUESTS: z
      .string()
      .regex(nonNegativeIntRegex, 'RATE_LIMIT_MAX_REQUESTS must be a non-negative integer')
      .optional()
      .describe('default: 120'),
    RATE_LIMIT_READ_LIMIT: z
      .string()
      .regex(nonNegativeIntRegex, 'RATE_LIMIT_READ_LIMIT must be a non-negative integer')
      .optional(),
    RATE_LIMIT_WRITE_LIMIT: z
      .string()
      .regex(nonNegativeIntRegex, 'RATE_LIMIT_WRITE_LIMIT must be a non-negative integer')
      .optional(),
    WRITE_RATE_LIMIT_MAX_REQUESTS: z
      .string()
      .regex(nonNegativeIntRegex, 'WRITE_RATE_LIMIT_MAX_REQUESTS must be a non-negative integer')
      .optional(),
    KEEP_ALIVE_TIMEOUT_MS: z
      .string()
      .regex(nonNegativeIntRegex, 'KEEP_ALIVE_TIMEOUT_MS must be a non-negative integer')
      .optional(),
    HEADERS_TIMEOUT_MS: z
      .string()
      .regex(nonNegativeIntRegex, 'HEADERS_TIMEOUT_MS must be a non-negative integer')
      .optional(),

    WEBHOOK_URL: z
      .string()
      .optional()
      .describe('Configurable webhook URL for status change notifications'),
    WEBHOOK_SECRET: z.string().optional().describe('Secret used to compute HMAC-SHA256 signature'),
  })
  .superRefine((data, ctx) => {
    const nodeEnv = data.NODE_ENV;

    // NODE_ENV selects the policy that applies, so an unrecognized value is a
    // contradictory configuration: e.g. NODE_ENV=prod skips all production
    // hardening while the operator believes production policy is active.
    if (
      nodeEnv !== undefined &&
      nodeEnv !== 'development' &&
      nodeEnv !== 'test' &&
      nodeEnv !== 'production'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NODE_ENV'],
        message: `NODE_ENV must be one of "development", "test", or "production" (received "${nodeEnv}"). Unset NODE_ENV defaults to development; set NODE_ENV=production to enable production hardening.`,
      });
    }

    const isProduction = nodeEnv === 'production';

    if (isProduction) {
      if (!data.CONTRACT_ID || !data.CONTRACT_ID.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CONTRACT_ID'],
          message: 'CONTRACT_ID is required in production for Soroban pledge signing',
        });
      }

      if (!data.SOROBAN_RPC_URL || !data.SOROBAN_RPC_URL.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SOROBAN_RPC_URL'],
          message: 'SOROBAN_RPC_URL is required in production',
        });
      }

      if (!data.SOROBAN_NETWORK_PASSPHRASE || !data.SOROBAN_NETWORK_PASSPHRASE.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SOROBAN_NETWORK_PASSPHRASE'],
          message: 'SOROBAN_NETWORK_PASSPHRASE is required in production',
        });
      }

      const apiKeys = (data.API_KEYS || '').split(',').filter(Boolean);
      if (apiKeys.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_KEYS'],
          message: 'API_KEYS is required in production to secure write endpoints',
        });
      }

      const originsStr = data.ALLOWED_ORIGINS || data.CORS_ALLOWED_ORIGINS || '';
      const originList = originsStr
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      if (originList.length === 0 || originList.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ALLOWED_ORIGINS'],
          message:
            'ALLOWED_ORIGINS is required in production. Set to explicit allowed origins (e.g., https://example.com). Wildcard "*" and empty origins are not allowed in production.',
        });
      }

      if (data.LOG_LEVEL === 'debug') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_LEVEL'],
          message:
            'LOG_LEVEL "debug" is not allowed in production: debug logs can leak request bodies and secrets. Set LOG_LEVEL to "info" or higher in production.',
        });
      }

      if (data.SOROBAN_RPC_URL) {
        let protocol = '';
        try {
          protocol = new URL(data.SOROBAN_RPC_URL).protocol;
        } catch {
          // Unreachable: the base schema already validates the URL.
        }
        if (protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['SOROBAN_RPC_URL'],
            message:
              'SOROBAN_RPC_URL must use HTTPS in production to prevent a network attacker from returning false simulation or ledger data.',
          });
        }
      }

      if ((data.WEBHOOK_URL ?? '').trim() && !(data.WEBHOOK_SECRET ?? '').trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEBHOOK_SECRET'],
          message:
            'WEBHOOK_SECRET is required in production when WEBHOOK_URL is configured: without it webhook signatures cannot be verified. Set WEBHOOK_SECRET or remove WEBHOOK_URL.',
        });
      }
    }
  });

export function validateEnv(env: Record<string, string | undefined> = process.env): void {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const missing = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    const errorMessage = `[startup] Environment validation failed. Fix the following before starting:\n${missing.join('\n')}`;
    try {
      const { logger } = require('./logger');
      logger.error(`\n${errorMessage}\n`);
    } catch {
      console.error(errorMessage);
    }
    if (env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw new Error(errorMessage);
  }
}
