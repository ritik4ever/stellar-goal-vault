import { describe, expect, it, vi } from 'vitest';
import {
  ENVIRONMENT_CONFIG_INPUT_SPECS,
  NETWORK_EXPECTED_PROFILES,
  resolveEnvironmentAndDeploymentConfig,
  resolveEnvironmentAndDeploymentConfigFromEnv,
} from '../../scripts/env-config';
import {
  MAINNET_CONTRACT_ID,
  MAINNET_FIXTURE,
  MISSING_OR_CONFLICTING_DEPLOYMENT_FIXTURES,
  SYNTHETIC_SECRET_KEY,
  TESTNET_CONTRACT_ID,
  TESTNET_FIXTURE,
} from '../../scripts/env-config-fixtures';
import {
  BindingsError,
  DEFAULT_MAINNET_RPC,
  DEFAULT_TESTNET_RPC,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from '../../scripts/bindings-guard';

describe('Environment and deployment config inputs (SGV-2026-196)', () => {
  it('defines canonical specs for all deployment and backend network inputs', () => {
    const names = ENVIRONMENT_CONFIG_INPUT_SPECS.map((spec) => spec.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'SECRET_KEY',
        'NETWORK',
        'NETWORK_PASSPHRASE',
        'RPC_URL',
        'CONTRACT_ID',
        'SOROBAN_RPC_URL',
        'SOROBAN_NETWORK_PASSPHRASE',
      ]),
    );
  });

  it('defines distinct expected passphrases and default RPC URLs for testnet vs mainnet', () => {
    expect(NETWORK_EXPECTED_PROFILES.testnet.passphrase).toBe(TESTNET_PASSPHRASE);
    expect(NETWORK_EXPECTED_PROFILES.testnet.defaultRpcUrl).toBe(DEFAULT_TESTNET_RPC);
    expect(NETWORK_EXPECTED_PROFILES.mainnet.passphrase).toBe(MAINNET_PASSPHRASE);
    expect(NETWORK_EXPECTED_PROFILES.mainnet.defaultRpcUrl).toBe(DEFAULT_MAINNET_RPC);
    expect(NETWORK_EXPECTED_PROFILES.testnet.passphrase).not.toBe(
      NETWORK_EXPECTED_PROFILES.mainnet.passphrase,
    );
  });

  it('resolves valid synthetic testnet and mainnet configs with contract IDs', () => {
    const testnet = resolveEnvironmentAndDeploymentConfig({
      secretKey: TESTNET_FIXTURE.secretKey,
      network: TESTNET_FIXTURE.network,
      networkPassphrase: TESTNET_FIXTURE.networkPassphrase,
      rpcUrl: TESTNET_FIXTURE.rpcUrl,
      contractId: TESTNET_CONTRACT_ID,
      requireContractId: true,
    });
    expect(testnet).toEqual({
      network: 'testnet',
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: DEFAULT_TESTNET_RPC,
      secretKey: SYNTHETIC_SECRET_KEY,
      contractId: TESTNET_CONTRACT_ID,
      contractIdSource: 'env',
    });

    const mainnet = resolveEnvironmentAndDeploymentConfig({
      secretKey: MAINNET_FIXTURE.secretKey,
      network: MAINNET_FIXTURE.network,
      networkPassphrase: MAINNET_FIXTURE.networkPassphrase,
      rpcUrl: MAINNET_FIXTURE.rpcUrl,
      contractId: MAINNET_CONTRACT_ID,
      requireContractId: true,
    });
    expect(mainnet).toEqual({
      network: 'mainnet',
      networkPassphrase: MAINNET_PASSPHRASE,
      rpcUrl: DEFAULT_MAINNET_RPC,
      secretKey: SYNTHETIC_SECRET_KEY,
      contractId: MAINNET_CONTRACT_ID,
      contractIdSource: 'env',
    });
  });

  it('reads deployment and backend env aliases from process.env maps', () => {
    const resolved = resolveEnvironmentAndDeploymentConfigFromEnv(
      {
        SECRET_KEY: SYNTHETIC_SECRET_KEY,
        NETWORK: 'mainnet',
        SOROBAN_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE,
        SOROBAN_RPC_URL: DEFAULT_MAINNET_RPC,
        CONTRACT_ID: MAINNET_CONTRACT_ID,
      },
      { requireContractId: true },
    );

    expect(resolved.network).toBe('mainnet');
    expect(resolved.networkPassphrase).toBe(MAINNET_PASSPHRASE);
    expect(resolved.rpcUrl).toBe(DEFAULT_MAINNET_RPC);
    expect(resolved.contractId).toBe(MAINNET_CONTRACT_ID);
  });

  it('rejects placeholder and malformed CONTRACT_ID before any signed transaction', () => {
    const signTransaction = vi.fn();

    const runWithContractId = (contractId: string) => {
      resolveEnvironmentAndDeploymentConfig({
        secretKey: SYNTHETIC_SECRET_KEY,
        network: 'testnet',
        contractId,
        requireContractId: true,
      });
      signTransaction();
    };

    expect(() => runWithContractId('YOUR_MAINNET_CONTRACT_ID')).toThrow(BindingsError);
    expect(() => runWithContractId('YOUR_MAINNET_CONTRACT_ID')).toThrow(/placeholder/i);
    expect(() => runWithContractId('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(
      /not a valid Soroban contract ID/i,
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it.each(MISSING_OR_CONFLICTING_DEPLOYMENT_FIXTURES)(
    'reproduces startup error before any signed transaction for $name',
    ({ input, expectedError, expectedRecovery }) => {
      const signAndSubmit = vi.fn();

      const preflightAndSign = () => {
        resolveEnvironmentAndDeploymentConfig(input);
        signAndSubmit();
      };

      expect(preflightAndSign).toThrow(expectedError);
      if (expectedRecovery) {
        expect(preflightAndSign).toThrow(expectedRecovery);
      }
      expect(signAndSubmit).not.toHaveBeenCalled();
    },
  );
});
