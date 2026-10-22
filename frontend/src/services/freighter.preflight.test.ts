import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../types/campaign';
import {
  validateAssetConfiguration,
  describeSimulationError,
} from './freighter';

const TESTNET = 'Test SDF Network ; September 2015';

const mockConfig: AppConfig = {
  allowedAssets: ['USDC', 'XLM'],
  soroban: {
    enabled: true,
    contractId: `C${'A'.repeat(55)}`,
    networkPassphrase: TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  contractId: `C${'A'.repeat(55)}`,
  networkPassphrase: TESTNET,
  contractAmountDecimals: 2,
  walletIntegrationReady: true,
  assetAddresses: {
    XLM: 'CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6CYN5',
    USDC: 'CA6WSTPZ7RRCUC6H37CQFODG763XG2HXP2G6F367VCOGGVDP32P7665E',
  },
};

describe('preflight validation', () => {
  describe('validateAssetConfiguration', () => {
    it('accepts a properly configured asset', () => {
      expect(() => {
        validateAssetConfiguration('XLM', mockConfig);
      }).not.toThrow();
    });

    it('accepts asset codes in any case', () => {
      expect(() => {
        validateAssetConfiguration('xlm', mockConfig);
      }).not.toThrow();

      expect(() => {
        validateAssetConfiguration('XLM', mockConfig);
      }).not.toThrow();

      expect(() => {
        validateAssetConfiguration('UsDc', mockConfig);
      }).not.toThrow();
    });

    it('throws ASSET_NOT_CONFIGURED for missing asset', () => {
      expect(() => {
        validateAssetConfiguration('BTC', mockConfig);
      }).toThrow(
        expect.objectContaining({
          code: 'ASSET_NOT_CONFIGURED',
          signingErrorClass: 'MALFORMED_TRANSACTION',
        }),
      );
    });

    it('throws ASSET_MISCONFIGURED for invalid address format', () => {
      const invalidConfig: AppConfig = {
        ...mockConfig,
        assetAddresses: {
          XLM: 'INVALID_ADDRESS',
        },
      };

      expect(() => {
        validateAssetConfiguration('XLM', invalidConfig);
      }).toThrow(
        expect.objectContaining({
          code: 'ASSET_MISCONFIGURED',
          signingErrorClass: 'MALFORMED_TRANSACTION',
        }),
      );
    });

    it('provides user-friendly error message for missing asset', () => {
      try {
        validateAssetConfiguration('BTC', mockConfig);
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('BTC');
        expect((error as Error).message).toContain('not configured');
      }
    });

    it('provides user-friendly error message for misconfigured asset', () => {
      const invalidConfig: AppConfig = {
        ...mockConfig,
        assetAddresses: {
          XLM: 'INVALID',
        },
      };

      try {
        validateAssetConfiguration('XLM', invalidConfig);
        throw new Error('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('XLM');
        expect((error as Error).message).toContain('invalid contract address');
      }
    });
  });

  describe('describeSimulationError', () => {
    it('describes insufficient balance errors', () => {
      const error = new Error('insufficient balance to complete transaction');
      const message = describeSimulationError(error);
      expect(message).toMatch(/insufficient balance/i);
      expect(message).toMatch(/check.*balance/i);
    });

    it('describes authorization errors', () => {
      const error = new Error('authorization failed');
      const message = describeSimulationError(error);
      expect(message).toMatch(/authorization/i);
      expect(message).toMatch(/permissions/i);
    });

    it('describes account not found errors', () => {
      const error = new Error('account not found');
      const message = describeSimulationError(error);
      expect(message).toMatch(/account not found/i);
      expect(message).toMatch(/funded/i);
    });

    it('describes token/allowance errors', () => {
      const error = new Error('token allowance exceeded');
      const message = describeSimulationError(error);
      expect(message).toMatch(/token/i);
      expect(message).toMatch(/approve/i);
    });

    it('describes contract state errors', () => {
      const error = new Error('contract state is archived');
      const message = describeSimulationError(error);
      expect(message).toMatch(/contract state/i);
      expect(message).toMatch(/restore/i);
    });

    it('provides generic fallback for unknown errors', () => {
      const error = new Error('some unknown contract error');
      const message = describeSimulationError(error);
      expect(message).toMatch(/simulation failed/i);
      expect(message).toMatch(/campaign status/i);
    });

    it('handles case-insensitive error matching', () => {
      const error = new Error('INSUFFICIENT Balance');
      const message = describeSimulationError(error);
      expect(message).toMatch(/insufficient balance/i);
    });
  });
});
