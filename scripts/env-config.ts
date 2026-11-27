/**
 * Environment and deployment configuration input definitions and preflight
 * validation for Stellar Goal Vault.
 *
 * Validates network, passphrase, RPC URL, secret key, and contract ID inputs
 * before any contract build, deployment, or signed transaction occurs.
 */

import {
  BindingsError,
  DEFAULT_FUTURENET_RPC,
  DEFAULT_MAINNET_RPC,
  DEFAULT_TESTNET_RPC,
  FUTURENET_PASSPHRASE,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  resolveContractId,
  resolveDeploymentConfig,
  type DeploymentConfigInput,
  type ResolvedDeploymentConfig,
} from './bindings-guard';

export interface ConfigInputSpec {
  readonly name: string;
  readonly scope: 'deploy' | 'backend' | 'shared';
  readonly required: 'always' | 'production' | 'optional';
  readonly defaultValue: string;
  readonly validation: string;
}

/**
 * Canonical specification of environment and deployment config inputs used
 * across scripts/deploy.sh, scripts/gen-bindings.ts, and backend startup.
 */
export const ENVIRONMENT_CONFIG_INPUT_SPECS: readonly ConfigInputSpec[] = Object.freeze([
  {
    name: 'SECRET_KEY',
    scope: 'deploy',
    required: 'always',
    defaultValue: '(none)',
    validation: '56-character Stellar secret key starting with S (base32); placeholders rejected',
  },
  {
    name: 'NETWORK',
    scope: 'deploy',
    required: 'optional',
    defaultValue: 'testnet',
    validation: 'One of testnet, mainnet (alias: public), futurenet, standalone, local',
  },
  {
    name: 'NETWORK_PASSPHRASE',
    scope: 'deploy',
    required: 'optional',
    defaultValue: 'Derived from NETWORK',
    validation: 'Must match NETWORK; cross-network passphrases fail at startup',
  },
  {
    name: 'RPC_URL',
    scope: 'deploy',
    required: 'optional',
    defaultValue: 'Derived from NETWORK',
    validation: 'Must align with NETWORK; cross-network RPC URLs fail at startup',
  },
  {
    name: 'CONTRACT_ID',
    scope: 'shared',
    required: 'production',
    defaultValue: 'contracts/contract_id.txt (bindings) or empty in dev/test',
    validation: '56-character Soroban contract strkey starting with C (base32); placeholders rejected',
  },
  {
    name: 'SOROBAN_RPC_URL',
    scope: 'backend',
    required: 'production',
    defaultValue: 'https://soroban-testnet.stellar.org:443 (non-prod)',
    validation: 'Valid URL (HTTPS in production); must align with SOROBAN_NETWORK_PASSPHRASE',
  },
  {
    name: 'SOROBAN_NETWORK_PASSPHRASE',
    scope: 'backend',
    required: 'production',
    defaultValue: 'Test SDF Network ; September 2015 (non-prod)',
    validation: 'Must align with SOROBAN_RPC_URL; testnet/mainnet conflicts fail at startup',
  },
]);

export interface ExpectedNetworkProfile {
  readonly network: 'testnet' | 'mainnet' | 'futurenet';
  readonly passphrase: string;
  readonly defaultRpcUrl: string;
  readonly contractIdPattern: RegExp;
}

/**
 * Expected passphrases, default RPC URLs, and contract ID format per network.
 */
export const NETWORK_EXPECTED_PROFILES: Readonly<
  Record<'testnet' | 'mainnet' | 'futurenet', ExpectedNetworkProfile>
> = Object.freeze({
  testnet: {
    network: 'testnet',
    passphrase: TESTNET_PASSPHRASE,
    defaultRpcUrl: DEFAULT_TESTNET_RPC,
    contractIdPattern: /^C[A-Z2-7]{55}$/,
  },
  mainnet: {
    network: 'mainnet',
    passphrase: MAINNET_PASSPHRASE,
    defaultRpcUrl: DEFAULT_MAINNET_RPC,
    contractIdPattern: /^C[A-Z2-7]{55}$/,
  },
  futurenet: {
    network: 'futurenet',
    passphrase: FUTURENET_PASSPHRASE,
    defaultRpcUrl: DEFAULT_FUTURENET_RPC,
    contractIdPattern: /^C[A-Z2-7]{55}$/,
  },
});

export interface EnvironmentAndDeploymentConfigInput extends DeploymentConfigInput {
  contractId?: string;
  contractIdFileText?: string | null;
  requireContractId?: boolean;
}

export interface ResolvedEnvironmentAndDeploymentConfig extends ResolvedDeploymentConfig {
  contractId?: string;
  contractIdSource?: 'env' | 'file';
}

/**
 * Validates and resolves all environment and deployment configuration inputs
 * before any build, deployment, or signed transaction can execute.
 */
export function resolveEnvironmentAndDeploymentConfig(
  input: EnvironmentAndDeploymentConfigInput = {},
): ResolvedEnvironmentAndDeploymentConfig {
  const deploymentConfig = resolveDeploymentConfig({
    secretKey: input.secretKey,
    network: input.network,
    networkPassphrase: input.networkPassphrase,
    rpcUrl: input.rpcUrl,
  });

  const hasContractIdInput =
    Boolean(input.contractId?.trim()) || Boolean(input.contractIdFileText?.trim());

  if (input.requireContractId || hasContractIdInput) {
    const resolvedContract = resolveContractId(input.contractId, input.contractIdFileText ?? null);
    return {
      ...deploymentConfig,
      contractId: resolvedContract.id,
      contractIdSource: resolvedContract.source,
    };
  }

  return deploymentConfig;
}

/**
 * Reads environment and deployment config inputs from a process environment
 * map (e.g. `process.env`) and validates them immediately.
 */
export function resolveEnvironmentAndDeploymentConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: { requireContractId?: boolean; contractIdFileText?: string | null } = {},
): ResolvedEnvironmentAndDeploymentConfig {
  return resolveEnvironmentAndDeploymentConfig({
    secretKey: env.SECRET_KEY,
    network: env.NETWORK,
    networkPassphrase: env.NETWORK_PASSPHRASE ?? env.SOROBAN_NETWORK_PASSPHRASE,
    rpcUrl: env.RPC_URL ?? env.SOROBAN_RPC_URL,
    contractId: env.CONTRACT_ID,
    contractIdFileText: options.contractIdFileText ?? null,
    requireContractId: options.requireContractId,
  });
}

if (require.main === module) {
  try {
    const requireContractId = process.argv.includes('--require-contract-id');
    const resolved = resolveEnvironmentAndDeploymentConfigFromEnv(process.env, {
      requireContractId,
    });
    console.log(
      `Environment and deployment config valid for network=${resolved.network} ` +
        `(rpc=${resolved.rpcUrl}${resolved.contractId ? `, contractId=${resolved.contractId}` : ''}).`,
    );
  } catch (error) {
    const message = error instanceof BindingsError ? error.message : String(error);
    console.error(`Startup configuration error:\n${message}`);
    process.exit(1);
  }
}
