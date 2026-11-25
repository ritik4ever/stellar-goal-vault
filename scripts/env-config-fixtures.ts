/**
 * Deterministic, non-live fixtures for Stellar Goal Vault environment and
 * deployment configuration tests.
 *
 * All contract IDs and secret keys here are synthetic base32 strkeys and must
 * never be funded or used against live networks.
 */

import {
  DEFAULT_MAINNET_RPC,
  DEFAULT_TESTNET_RPC,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  type DeploymentConfigInput,
} from './bindings-guard';

/** Synthetic non-live Soroban contract IDs (C + 55 base32 chars). */
export const TESTNET_CONTRACT_ID = `C${'T'.repeat(55)}`;
export const MAINNET_CONTRACT_ID = `C${'M'.repeat(55)}`;

/** Synthetic non-live Stellar secret key (S + 55 base32 chars, never funded). */
export const SYNTHETIC_SECRET_KEY = `S${'A'.repeat(55)}`;

export interface NetworkFixtureProfile {
  readonly network: 'testnet' | 'mainnet';
  readonly networkPassphrase: string;
  readonly rpcUrl: string;
  readonly contractId: string;
  readonly secretKey: string;
}

export const TESTNET_FIXTURE: NetworkFixtureProfile = Object.freeze({
  network: 'testnet',
  networkPassphrase: TESTNET_PASSPHRASE,
  rpcUrl: DEFAULT_TESTNET_RPC,
  contractId: TESTNET_CONTRACT_ID,
  secretKey: SYNTHETIC_SECRET_KEY,
});

export const MAINNET_FIXTURE: NetworkFixtureProfile = Object.freeze({
  network: 'mainnet',
  networkPassphrase: MAINNET_PASSPHRASE,
  rpcUrl: DEFAULT_MAINNET_RPC,
  contractId: MAINNET_CONTRACT_ID,
  secretKey: SYNTHETIC_SECRET_KEY,
});

export const NETWORK_CONFIG_FIXTURES = Object.freeze({
  testnet: TESTNET_FIXTURE,
  mainnet: MAINNET_FIXTURE,
});

export interface DeploymentFailureFixture {
  readonly name: string;
  readonly input: DeploymentConfigInput;
  readonly expectedError: RegExp;
  readonly expectedRecovery?: RegExp;
}

/**
 * Deterministic missing or conflicting deployment config cases that must
 * fail at startup before any transaction is signed or submitted.
 */
export const MISSING_OR_CONFLICTING_DEPLOYMENT_FIXTURES: readonly DeploymentFailureFixture[] =
  Object.freeze([
    {
      name: 'missing SECRET_KEY',
      input: {
        network: TESTNET_FIXTURE.network,
        networkPassphrase: TESTNET_FIXTURE.networkPassphrase,
        rpcUrl: TESTNET_FIXTURE.rpcUrl,
      },
      expectedError: /Missing required deployment environment variable: SECRET_KEY/,
      expectedRecovery: /Recovery: set SECRET_KEY/,
    },
    {
      name: 'placeholder SECRET_KEY',
      input: {
        secretKey: 'YOUR_SECRET_KEY',
        network: TESTNET_FIXTURE.network,
      },
      expectedError: /Invalid SECRET_KEY format/,
      expectedRecovery: /Recovery: provide a valid 56-character base32 secret key/,
    },
    {
      name: 'testnet network with mainnet passphrase',
      input: {
        secretKey: SYNTHETIC_SECRET_KEY,
        network: TESTNET_FIXTURE.network,
        networkPassphrase: MAINNET_FIXTURE.networkPassphrase,
        rpcUrl: TESTNET_FIXTURE.rpcUrl,
      },
      expectedError: /Network mismatch: testnet was selected but mainnet passphrase was provided/,
      expectedRecovery: /Recovery: set NETWORK=mainnet, or unset NETWORK_PASSPHRASE/,
    },
    {
      name: 'testnet network with mainnet RPC URL',
      input: {
        secretKey: SYNTHETIC_SECRET_KEY,
        network: TESTNET_FIXTURE.network,
        networkPassphrase: TESTNET_FIXTURE.networkPassphrase,
        rpcUrl: MAINNET_FIXTURE.rpcUrl,
      },
      expectedError: /Network mismatch: testnet was selected but a mainnet RPC URL was provided/,
      expectedRecovery: /Recovery: set NETWORK=mainnet, or unset RPC_URL/,
    },
    {
      name: 'mainnet network with testnet passphrase',
      input: {
        secretKey: SYNTHETIC_SECRET_KEY,
        network: MAINNET_FIXTURE.network,
        networkPassphrase: TESTNET_FIXTURE.networkPassphrase,
        rpcUrl: MAINNET_FIXTURE.rpcUrl,
      },
      expectedError: /Network mismatch: mainnet was selected but testnet passphrase was provided/,
      expectedRecovery: /Recovery: set NETWORK=testnet, or unset NETWORK_PASSPHRASE/,
    },
    {
      name: 'mainnet network with testnet RPC URL',
      input: {
        secretKey: SYNTHETIC_SECRET_KEY,
        network: MAINNET_FIXTURE.network,
        networkPassphrase: MAINNET_FIXTURE.networkPassphrase,
        rpcUrl: TESTNET_FIXTURE.rpcUrl,
      },
      expectedError: /Network mismatch: mainnet was selected but a testnet RPC URL was provided/,
      expectedRecovery: /Recovery: set NETWORK=testnet, or unset RPC_URL/,
    },
    {
      name: 'unsupported network name',
      input: {
        secretKey: SYNTHETIC_SECRET_KEY,
        network: 'devnet',
      },
      expectedError: /Unsupported network "devnet"/,
      expectedRecovery: /Recovery: set NETWORK to one of/,
    },
  ]);

export interface BackendEnvFailureFixture {
  readonly name: string;
  readonly env: Record<string, string | undefined>;
  readonly expectedError: RegExp;
}

export const VALID_TESTNET_BACKEND_ENV: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: 'test',
  CONTRACT_ID: TESTNET_FIXTURE.contractId,
  SOROBAN_RPC_URL: TESTNET_FIXTURE.rpcUrl,
  SOROBAN_NETWORK_PASSPHRASE: TESTNET_FIXTURE.networkPassphrase,
});

export const VALID_MAINNET_PROD_BACKEND_ENV: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: 'production',
  CONTRACT_ID: MAINNET_FIXTURE.contractId,
  SOROBAN_RPC_URL: MAINNET_FIXTURE.rpcUrl,
  SOROBAN_NETWORK_PASSPHRASE: MAINNET_FIXTURE.networkPassphrase,
  ALLOWED_ORIGINS: 'https://app.example.com',
  API_KEYS: 'synthetic-test-api-key-1',
  LOG_LEVEL: 'info',
});

/**
 * Deterministic backend startup environment fixtures covering missing or
 * conflicting network variables and invalid contract IDs.
 */
export const MISSING_OR_CONFLICTING_BACKEND_ENV_FIXTURES: readonly BackendEnvFailureFixture[] =
  Object.freeze([
    {
      name: 'testnet passphrase with mainnet RPC URL',
      env: {
        ...VALID_TESTNET_BACKEND_ENV,
        SOROBAN_RPC_URL: MAINNET_FIXTURE.rpcUrl,
      },
      expectedError:
        /Network mismatch: SOROBAN_NETWORK_PASSPHRASE is configured for testnet, but SOROBAN_RPC_URL points to mainnet/,
    },
    {
      name: 'mainnet passphrase with testnet RPC URL',
      env: {
        ...VALID_TESTNET_BACKEND_ENV,
        SOROBAN_NETWORK_PASSPHRASE: MAINNET_FIXTURE.networkPassphrase,
        SOROBAN_RPC_URL: TESTNET_FIXTURE.rpcUrl,
      },
      expectedError:
        /Network mismatch: SOROBAN_NETWORK_PASSPHRASE is configured for mainnet, but SOROBAN_RPC_URL points to testnet/,
    },
    {
      name: 'mainnet RPC URL with missing passphrase',
      env: {
        ...VALID_TESTNET_BACKEND_ENV,
        SOROBAN_RPC_URL: MAINNET_FIXTURE.rpcUrl,
        SOROBAN_NETWORK_PASSPHRASE: '',
      },
      expectedError:
        /Missing or conflicting network environment variable: SOROBAN_RPC_URL points to mainnet/,
    },
    {
      name: 'mainnet passphrase with missing RPC URL',
      env: {
        ...VALID_TESTNET_BACKEND_ENV,
        SOROBAN_NETWORK_PASSPHRASE: MAINNET_FIXTURE.networkPassphrase,
        SOROBAN_RPC_URL: '',
      },
      expectedError:
        /Missing or conflicting network environment variable: SOROBAN_NETWORK_PASSPHRASE is configured for mainnet/,
    },
    {
      name: 'production missing CONTRACT_ID',
      env: {
        ...VALID_MAINNET_PROD_BACKEND_ENV,
        CONTRACT_ID: '',
      },
      expectedError: /CONTRACT_ID is required in production/,
    },
    {
      name: 'production placeholder CONTRACT_ID',
      env: {
        ...VALID_MAINNET_PROD_BACKEND_ENV,
        CONTRACT_ID: 'YOUR_MAINNET_CONTRACT_ID',
      },
      expectedError: /CONTRACT_ID cannot be placeholder/,
    },
    {
      name: 'production missing SOROBAN_RPC_URL',
      env: {
        ...VALID_MAINNET_PROD_BACKEND_ENV,
        SOROBAN_RPC_URL: '',
      },
      expectedError: /SOROBAN_RPC_URL is required in production/,
    },
    {
      name: 'production missing SOROBAN_NETWORK_PASSPHRASE',
      env: {
        ...VALID_MAINNET_PROD_BACKEND_ENV,
        SOROBAN_NETWORK_PASSPHRASE: '',
      },
      expectedError: /SOROBAN_NETWORK_PASSPHRASE is required in production/,
    },
  ]);
