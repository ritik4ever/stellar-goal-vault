import { z } from 'zod';

const envSchema = z.object({
  // Required
  CONTRACT_ID: z.string().min(1, 'CONTRACT_ID is required for Soroban pledge signing'),

  // Optional with documented defaults
  PORT: z.string().optional().describe('default: 3001'),
  NODE_ENV: z.string().optional().describe('default: development'),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .optional()
    .describe('default: info'),
  DB_PATH: z.string().optional().describe('default: backend/data/campaigns.db'),
  SOROBAN_RPC_URL: z
    .string()
    .url()
    .optional()
    .describe('default: https://soroban-testnet.stellar.org:443'),
  SOROBAN_NETWORK_PASSPHRASE: z
    .string()
    .optional()
    .describe('default: Test SDF Network ; September 2015'),
  ALLOWED_ASSETS: z.string().optional().describe('default: USDC,XLM'),
  ALLOWED_ORIGINS: z.string().optional().describe('default: (empty — all origins allowed in dev)'),
  ASSET_ADDRESSES: z.string().optional().describe('default: XLM and USDC testnet addresses'),
  CONTRACT_AMOUNT_DECIMALS: z
    .string()
    .regex(/^\d+$/, 'CONTRACT_AMOUNT_DECIMALS must be a non-negative integer')
    .optional()
    .describe('default: 2'),
  DEFAULT_MAX_PER_CONTRIBUTOR: z
    .string()
    .regex(/^\d+$/, 'DEFAULT_MAX_PER_CONTRIBUTOR must be a non-negative integer')
    .optional()
    .describe('default: 0 (no limit)'),
});

export function validateEnv(): void {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    // eslint-disable-next-line no-console
    console.error(
      `\n[startup] Environment validation failed. Fix the following before starting:\n${missing.join('\n')}\n`,
    );
    process.exit(1);
  }
}
