/**
 * Pure helpers for scripts/gen-bindings.ts.
 * No side effects, so they can be unit-tested without the Stellar CLI or network.
 */

export const STAMP_FILE = '.contract-id';

export const PLACEHOLDER_CONTRACT_IDS = [
  'YOUR_CONTRACT_ID',
  'YOUR_DEPLOYED_CONTRACT_ID',
  'YOUR_MAINNET_CONTRACT_ID',
];

export const PLACEHOLDER_SECRET_KEYS = [
  'YOUR_SECRET_KEY',
  'YOUR_STELLAR_SECRET_KEY',
  'S...',
];

// Soroban contract strkey: "C" followed by 55 base32 characters.
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;
// Stellar secret key strkey: "S" followed by 55 base32 characters.
const SECRET_KEY_PATTERN = /^S[A-Z2-7]{55}$/;

const RECOVERY =
  'Recovery: set CONTRACT_ID, or deploy with `npm run deploy:contract` so ' +
  'contracts/contract_id.txt holds the deployed ID, then rerun `npm run gen:bindings`.';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
export const FUTURENET_PASSPHRASE = 'Test SDF Future Network ; October 2022';

export const DEFAULT_TESTNET_RPC = 'https://soroban-testnet.stellar.org';
export const DEFAULT_MAINNET_RPC = 'https://soroban-rpc.mainnet.stellar.org';
export const DEFAULT_FUTURENET_RPC = 'https://rpc-futurenet.stellar.org';

export const SUPPORTED_NETWORKS = [
  'testnet',
  'mainnet',
  'public',
  'futurenet',
  'standalone',
  'local',
] as const;
export type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number];

export interface NetworkConfigInput {
  network?: string;
  networkPassphrase?: string;
  rpcUrl?: string;
}

export interface ResolvedNetworkConfig {
  network: string;
  networkPassphrase: string;
  rpcUrl: string;
}

export interface DeploymentConfigInput extends NetworkConfigInput {
  secretKey?: string;
}

export interface ResolvedDeploymentConfig extends ResolvedNetworkConfig {
  secretKey: string;
}

export class BindingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingsError';
  }
}

export function isValidContractId(id: string): boolean {
  return CONTRACT_ID_PATTERN.test(id);
}

export function isValidSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Validates and resolves network parameters to guarantee consistent network,
 * passphrase, and RPC endpoint alignment before any network action.
 * Provides clear stop and recovery paths for missing or conflicting parameters.
 */
export function resolveNetworkConfig(input: NetworkConfigInput = {}): ResolvedNetworkConfig {
  const rawNetwork = (input.network || 'testnet').trim().toLowerCase();
  const network = rawNetwork === 'public' ? 'mainnet' : rawNetwork;

  if (!SUPPORTED_NETWORKS.includes(rawNetwork as SupportedNetwork)) {
    throw new BindingsError(
      `Unsupported network "${input.network}". Supported networks: testnet, mainnet, futurenet, standalone, local.\n` +
        'Recovery: set NETWORK to one of: testnet, mainnet, futurenet, standalone, or local.',
    );
  }

  const passphrase = input.networkPassphrase?.trim();
  const rpcUrl = input.rpcUrl?.trim();

  if (network === 'testnet') {
    if (passphrase === MAINNET_PASSPHRASE) {
      throw new BindingsError(
        'Network mismatch: testnet was selected but mainnet passphrase was provided.\n' +
          'Recovery: set NETWORK=mainnet, or unset NETWORK_PASSPHRASE to use the testnet default.',
      );
    }
    if (rpcUrl && (rpcUrl.includes('mainnet') || rpcUrl.includes('publicnode'))) {
      throw new BindingsError(
        'Network mismatch: testnet was selected but a mainnet RPC URL was provided.\n' +
          'Recovery: set NETWORK=mainnet, or unset RPC_URL to use the default testnet RPC endpoint.',
      );
    }
    return {
      network: 'testnet',
      networkPassphrase: passphrase || TESTNET_PASSPHRASE,
      rpcUrl: rpcUrl || DEFAULT_TESTNET_RPC,
    };
  }

  if (network === 'mainnet') {
    if (passphrase === TESTNET_PASSPHRASE) {
      throw new BindingsError(
        'Network mismatch: mainnet was selected but testnet passphrase was provided.\n' +
          'Recovery: set NETWORK=testnet, or unset NETWORK_PASSPHRASE to use the mainnet default.',
      );
    }
    if (rpcUrl && rpcUrl.includes('testnet')) {
      throw new BindingsError(
        'Network mismatch: mainnet was selected but a testnet RPC URL was provided.\n' +
          'Recovery: set NETWORK=testnet, or unset RPC_URL to use the default mainnet RPC endpoint.',
      );
    }
    return {
      network: 'mainnet',
      networkPassphrase: passphrase || MAINNET_PASSPHRASE,
      rpcUrl: rpcUrl || DEFAULT_MAINNET_RPC,
    };
  }

  if (network === 'futurenet') {
    if (passphrase === TESTNET_PASSPHRASE || passphrase === MAINNET_PASSPHRASE) {
      throw new BindingsError(
        'Network mismatch: futurenet was selected but a conflicting passphrase was provided.\n' +
          `Recovery: unset NETWORK_PASSPHRASE to use the futurenet default ("${FUTURENET_PASSPHRASE}"), or set matching NETWORK.`,
      );
    }
    if (rpcUrl && (rpcUrl.includes('testnet') || rpcUrl.includes('mainnet') || rpcUrl.includes('publicnode'))) {
      throw new BindingsError(
        'Network mismatch: futurenet was selected but a conflicting RPC URL was provided.\n' +
          `Recovery: unset RPC_URL to use the futurenet default ("${DEFAULT_FUTURENET_RPC}"), or set matching NETWORK.`,
      );
    }
    return {
      network: 'futurenet',
      networkPassphrase: passphrase || FUTURENET_PASSPHRASE,
      rpcUrl: rpcUrl || DEFAULT_FUTURENET_RPC,
    };
  }

  // standalone / local
  if (passphrase === MAINNET_PASSPHRASE || passphrase === TESTNET_PASSPHRASE) {
    throw new BindingsError(
      `Network mismatch: ${network} was selected but a public network passphrase was provided.\n` +
        'Recovery: unset NETWORK_PASSPHRASE to use the standalone default ("Standalone Network ; February 2017"), or set matching NETWORK.',
    );
  }
  if (rpcUrl && (rpcUrl.includes('stellar.org') || rpcUrl.includes('publicnode'))) {
    throw new BindingsError(
      `Network mismatch: ${network} was selected but a public RPC URL was provided.\n` +
        'Recovery: unset RPC_URL to use the local default ("http://localhost:8000"), or set matching NETWORK.',
    );
  }
  return {
    network,
    networkPassphrase: passphrase || 'Standalone Network ; February 2017',
    rpcUrl: rpcUrl || 'http://localhost:8000',
  };
}

/**
 * Validates and resolves full deployment configuration before any compilation
 * or deployment action. Ensures invalid configurations stop early with actionable
 * recovery paths and preserve startup errors on repeated runs before any signed transaction.
 */
export function resolveDeploymentConfig(
  input: DeploymentConfigInput = {},
): ResolvedDeploymentConfig {
  const secretKey = input.secretKey?.trim();
  if (!secretKey) {
    throw new BindingsError(
      'Missing required deployment environment variable: SECRET_KEY.\n' +
        'Recovery: set SECRET_KEY to your funded 56-character Stellar secret key (starts with "S", base32 encoded) before running deployment.',
    );
  }

  if (
    PLACEHOLDER_SECRET_KEYS.includes(secretKey) ||
    secretKey.startsWith('S...') ||
    !isValidSecretKey(secretKey)
  ) {
    throw new BindingsError(
      `Invalid SECRET_KEY format "${secretKey}". Expected a 56-character Stellar secret key starting with 'S' (base32).\n` +
        'Recovery: provide a valid 56-character base32 secret key starting with "S" without placeholders.',
    );
  }

  const networkConfig = resolveNetworkConfig(input);

  return {
    ...networkConfig,
    secretKey,
  };
}

/** First non-empty, non-comment line of an ID file, or null. */
export function parseContractIdFile(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith('#')) return line;
  }
  return null;
}

export interface ResolvedContractId {
  id: string;
  source: 'env' | 'file';
}

/**
 * CONTRACT_ID wins when set; otherwise contracts/contract_id.txt is used.
 * Stops with a clear message instead of silently using a placeholder.
 */
export function resolveContractId(
  envValue: string | undefined,
  fileText: string | null,
): ResolvedContractId {
  const fromEnv = envValue?.trim();
  const fromFile = parseContractIdFile(fileText);
  const resolved: ResolvedContractId | null = fromEnv
    ? { id: fromEnv, source: 'env' }
    : fromFile
      ? { id: fromFile, source: 'file' }
      : null;

  if (!resolved) {
    throw new BindingsError(`No deployed contract ID found.\n${RECOVERY}`);
  }
  if (PLACEHOLDER_CONTRACT_IDS.includes(resolved.id)) {
    throw new BindingsError(`Contract ID is still the placeholder "${resolved.id}".\n${RECOVERY}`);
  }
  if (!isValidContractId(resolved.id)) {
    throw new BindingsError(
      `"${resolved.id}" is not a valid Soroban contract ID (expected C + 55 base32 chars).\n${RECOVERY}`,
    );
  }
  return resolved;
}

/** Content of frontend/src/generated/.contract-id. Deterministic, so reruns cause no diff. */
export function renderStamp(contractId: string): string {
  return (
    '# Contract ID these bindings were generated from.\n' +
    '# Written by scripts/gen-bindings.ts, do not edit by hand.\n' +
    `${contractId}\n`
  );
}

export interface DriftResult {
  status: 'in-sync' | 'drift' | 'unstamped';
  message: string;
}

export function checkBindingsDrift(stampText: string | null, deployedId: string): DriftResult {
  const generatedFor = parseContractIdFile(stampText);
  if (!generatedFor) {
    return {
      status: 'unstamped',
      message:
        'Bindings in frontend/src/generated/ have no contract stamp yet. ' +
        'Run `npm run gen:bindings` once to record which contract they came from.',
    };
  }
  if (generatedFor !== deployedId) {
    return {
      status: 'drift',
      message:
        `ABI drift: bindings were generated for ${generatedFor} ` +
        `but the deployed contract is ${deployedId}.\n` +
        'Recovery: run `npm run gen:bindings` and commit frontend/src/generated/.',
    };
  }
  return { status: 'in-sync', message: `Bindings match deployed contract ${deployedId}.` };
}
