import 'dotenv/config';
import { normalizeLogLevel } from './logger';

const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEFAULT_SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org:443';
const isProduction = process.env.NODE_ENV === 'production';
const configuredRpcUrl = process.env.SOROBAN_RPC_URL;
const configuredNetworkPassphrase = process.env.SOROBAN_NETWORK_PASSPHRASE;
const useDevelopmentDefaults = !isProduction && !configuredRpcUrl && !configuredNetworkPassphrase;

const hasSorobanNetworkProfile = Boolean(
  useDevelopmentDefaults || (configuredRpcUrl && configuredNetworkPassphrase),
);

const parseOrigins = (originsStr: string): string[] => {
  return originsStr
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const config = {
  port: Number(process.env.PORT ?? 3001),
  logLevel: normalizeLogLevel(process.env.LOG_LEVEL),
  corsAllowedOrigins: parseOrigins(process.env.CORS_ALLOWED_ORIGINS ?? ''),
  allowedAssets: (process.env.ALLOWED_ASSETS ?? 'USDC,XLM')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),

  sorobanNetworkPassphrase:
    configuredNetworkPassphrase ?? (useDevelopmentDefaults ? DEFAULT_NETWORK_PASSPHRASE : ''),
  sorobanRpcUrl: configuredRpcUrl ?? (useDevelopmentDefaults ? DEFAULT_SOROBAN_RPC_URL : ''),
  contractId: process.env.CONTRACT_ID ?? '',
  assetAddresses: (
    process.env.ASSET_ADDRESSES ??
    'XLM:CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6CYN5,USDC:CA6WSTPZ7RRCUC6H37CQFODG763XG2HXP2G6F367VCOGGVDP32P7665E'
  )
    .split(',')
    .reduce(
      (acc, pair) => {
        const [code, addr] = pair.split(':');
        if (code && addr) acc[code.trim().toUpperCase()] = addr.trim();
        return acc;
      },
      {} as Record<string, string>,
    ),
  defaultMaxPerContributor: parseInteger(process.env.DEFAULT_MAX_PER_CONTRIBUTOR, 0),
  keepAliveTimeoutMs: parseInteger(process.env.KEEP_ALIVE_TIMEOUT_MS, 65_000),
  headersTimeoutMs: parseInteger(process.env.HEADERS_TIMEOUT_MS, 66_000),
};

export const walletIntegrationReady = Boolean(
  config.contractId &&
  config.sorobanRpcUrl &&
  config.sorobanNetworkPassphrase &&
  hasSorobanNetworkProfile,
);
