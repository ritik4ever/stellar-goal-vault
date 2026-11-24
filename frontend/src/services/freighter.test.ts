import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { freighterMocks, assembleTransactionMock } = vi.hoisted(() => ({
  freighterMocks: {
    isConnected: vi.fn(),
    requestAccess: vi.fn(),
    getNetworkDetails: vi.fn(),
    signTransaction: vi.fn(),
  },
  assembleTransactionMock: vi.fn(),
}));

vi.mock('@stellar/freighter-api', () => freighterMocks);

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      assembleTransaction: assembleTransactionMock,
    },
  };
});

import { Account, Keypair, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import {
  amountToContractUnits,
  connectFreighterWallet,
  submitFreighterClaim,
  submitFreighterPledge,
  verifyFreighterNetwork,
} from './freighter';
import { AppConfig } from '../types/campaign';

describe('freighter helpers and wallet integration', () => {
  const TESTNET = 'Test SDF Network ; September 2015';
  const MAINNET = 'Public Global Stellar Network ; September 2015';
  const CONTRIBUTOR = Keypair.random().publicKey();
  const CREATOR = Keypair.random().publicKey();

  const mockConfig: AppConfig = {
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK3IM',
    networkPassphrase: TESTNET,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org:443',
    assetAddresses: {
      USDC: 'CCABDO7UZXYE4W6GVSEGSNNZTKSLFQGKXXQTH6OX7M7GKZ4Z6CUJNGZN',
    },
    contractAmountDecimals: 7,
    allowedAssets: ['USDC'],
    walletIntegrationReady: true,
    soroban: {
      enabled: true,
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK3IM',
      networkPassphrase: TESTNET,
      rpcUrl: 'https://soroban-testnet.stellar.org:443',
    },
  };

  let getAccountSpy: any;
  let simulateSpy: any;
  let sendTransactionSpy: any;
  let getTransactionSpy: any;
  let fromXdrSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    getAccountSpy = vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockImplementation(async (account: string) => new Account(account, '100'));

    simulateSpy = vi
      .spyOn(rpc.Server.prototype, 'simulateTransaction')
      .mockResolvedValue({} as any);

    sendTransactionSpy = vi
      .spyOn(rpc.Server.prototype, 'sendTransaction')
      .mockResolvedValue({ status: 'PENDING', hash: 'tx-test-hash-123' } as any);

    getTransactionSpy = vi.spyOn(rpc.Server.prototype, 'getTransaction').mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      createdAt: 1700000000,
    } as any);

    assembleTransactionMock.mockReturnValue({
      build: () => ({
        toXDR: () => 'unsigned-xdr-preview',
        fee: '1000',
      }),
    });

    fromXdrSpy = vi.spyOn(TransactionBuilder, 'fromXDR').mockReturnValue({} as any);

    freighterMocks.isConnected.mockResolvedValue(true);
    freighterMocks.requestAccess.mockResolvedValue(CONTRIBUTOR);
    freighterMocks.getNetworkDetails.mockResolvedValue({
      networkPassphrase: TESTNET,
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org:443',
    });
    freighterMocks.signTransaction.mockResolvedValue('signed-tx-xdr');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('amountToContractUnits', () => {
    it('converts display amounts into contract units', () => {
      expect(amountToContractUnits(25.5, 2)).toBe(2550n);
    });

    it('rejects precision that exceeds the configured decimals', () => {
      expect(() => amountToContractUnits(1.239, 2)).toThrow(/no more than 2 decimal places/i);
    });
  });

  describe('connect path', () => {
    it('connects freighter wallet successfully when available and matching network', async () => {
      const conn = await connectFreighterWallet(TESTNET);
      expect(conn.publicKey).toBe(CONTRIBUTOR);
      expect(conn.networkPassphrase).toBe(TESTNET);
      expect(conn.sorobanRpcUrl).toBe('https://soroban-testnet.stellar.org:443');
    });

    it('fails clearly when Freighter is unavailable', async () => {
      freighterMocks.isConnected.mockResolvedValue(false);

      await expect(connectFreighterWallet(TESTNET)).rejects.toMatchObject({
        code: 'FREIGHTER_UNAVAILABLE',
      });
    });

    it('handles user rejection when requesting wallet access', async () => {
      freighterMocks.requestAccess.mockRejectedValue(new Error('User declined connection'));

      await expect(connectFreighterWallet(TESTNET)).rejects.toMatchObject({
        code: 'FREIGHTER_ACCESS_DENIED',
      });
    });

    it('fails clearly when Freighter is on the wrong network', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        networkPassphrase: MAINNET,
      });

      await expect(connectFreighterWallet(TESTNET)).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_MISMATCH',
      });
    });
  });

  describe('transaction submission: submit path (happy path)', () => {
    it('successfully submits pledge, signs with wallet, polls and confirms final state', async () => {
      const onPreview = vi.fn().mockResolvedValue(true);

      const result = await submitFreighterPledge({
        campaignId: '1',
        contributor: CONTRIBUTOR,
        amount: 25,
        assetCode: 'USDC',
        config: mockConfig,
        onPreview,
      });

      expect(onPreview).toHaveBeenCalledTimes(1);
      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'contribute',
          amount: 25,
          assetCode: 'USDC',
          contract: mockConfig.contractId,
          xdr: 'unsigned-xdr-preview',
          estimatedFee: { stroops: 1000, xlm: '0.0001' },
        }),
      );

      expect(freighterMocks.signTransaction).toHaveBeenCalledWith('unsigned-xdr-preview', {
        accountToSign: CONTRIBUTOR,
        networkPassphrase: TESTNET,
      });

      expect(sendTransactionSpy).toHaveBeenCalledTimes(1);
      expect(getTransactionSpy).toHaveBeenCalledWith('tx-test-hash-123');
      expect(result).toEqual({
        transactionHash: 'tx-test-hash-123',
        confirmedAt: 1700000000,
      });
    });

    it('successfully submits claim, signs with wallet, and confirms final state', async () => {
      const onPreview = vi.fn().mockResolvedValue(true);

      const result = await submitFreighterClaim({
        campaignId: '1',
        creator: CREATOR,
        config: mockConfig,
        onPreview,
      });

      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'claim',
          contract: mockConfig.contractId,
          xdr: 'unsigned-xdr-preview',
        }),
      );

      expect(freighterMocks.signTransaction).toHaveBeenCalledWith('unsigned-xdr-preview', {
        accountToSign: CREATOR,
        networkPassphrase: TESTNET,
      });

      expect(result).toEqual({
        transactionHash: 'tx-test-hash-123',
        confirmedAt: 1700000000,
      });
    });
  });

  describe('transaction submission: reject path', () => {
    it('aborts submission when user cancels transaction in preview modal', async () => {
      const onPreview = vi.fn().mockResolvedValue(false);

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: CONTRIBUTOR,
          amount: 25,
          assetCode: 'USDC',
          config: mockConfig,
          onPreview,
        }),
      ).rejects.toMatchObject({
        code: 'USER_CANCELLED',
      });

      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
      expect(sendTransactionSpy).not.toHaveBeenCalled();
    });

    it('handles user rejecting transaction signing in wallet', async () => {
      freighterMocks.signTransaction.mockRejectedValue(new Error('User rejected signature'));

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: CONTRIBUTOR,
          amount: 25,
          assetCode: 'USDC',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'SIGNING_FAILED',
      });

      expect(sendTransactionSpy).not.toHaveBeenCalled();
    });
  });

  describe('transaction submission: sign path', () => {
    it('fails when wallet returns empty signed XDR string', async () => {
      freighterMocks.signTransaction.mockResolvedValue('');

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: CONTRIBUTOR,
          amount: 25,
          assetCode: 'USDC',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'SIGNING_FAILED',
      });

      expect(sendTransactionSpy).not.toHaveBeenCalled();
    });
  });

  describe('transaction submission: network-mismatch path', () => {
    it('blocks pledge submission if wallet network differs from app config', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        networkPassphrase: MAINNET,
      });

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: CONTRIBUTOR,
          amount: 25,
          assetCode: 'USDC',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_MISMATCH',
      });

      expect(simulateSpy).not.toHaveBeenCalled();
      expect(sendTransactionSpy).not.toHaveBeenCalled();
    });

    it('blocks claim submission if wallet network differs from app config', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        networkPassphrase: MAINNET,
      });

      await expect(
        submitFreighterClaim({
          campaignId: '1',
          creator: CREATOR,
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_MISMATCH',
      });

      expect(simulateSpy).not.toHaveBeenCalled();
      expect(sendTransactionSpy).not.toHaveBeenCalled();
    });
  });

  describe('transaction submission: failure and timeout paths', () => {
    it('handles RPC submission error response', async () => {
      sendTransactionSpy.mockResolvedValue({
        status: 'ERROR',
        hash: 'tx-failed-submission',
      });

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: CONTRIBUTOR,
          amount: 25,
          assetCode: 'USDC',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'SUBMISSION_FAILED',
      });
    });

    it('handles on-chain transaction execution failure after submission', async () => {
      getTransactionSpy.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.FAILED,
      });

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: CONTRIBUTOR,
          amount: 25,
          assetCode: 'USDC',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
      });
    });

    it('times out when transaction is never confirmed within poll limit', async () => {
      vi.useFakeTimers();

      // Return NOT_FOUND on all attempts
      getTransactionSpy.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      });

      const submissionPromise = submitFreighterPledge({
        campaignId: '1',
        contributor: CONTRIBUTOR,
        amount: 25,
        assetCode: 'USDC',
        config: mockConfig,
      });

      const assertion = expect(submissionPromise).rejects.toMatchObject({
        code: 'TRANSACTION_TIMEOUT',
      });

      await vi.advanceTimersByTimeAsync(35000);
      await assertion;
    });
  });

  describe('verifyFreighterNetwork', () => {
    it('throws FREIGHTER_NETWORK_MISMATCH when wallet is on different network', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        network: 'PUBLIC',
        networkUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        sorobanRpcUrl: 'https://mainnet.rpc',
      });

      await expect(
        verifyFreighterNetwork('Test SDF Network ; September 2015'),
      ).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_MISMATCH',
      });
    });

    it('throws FREIGHTER_NETWORK_MISMATCH with actionable message', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        network: 'PUBLIC',
        networkUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        sorobanRpcUrl: 'https://mainnet.rpc',
      });

      try {
        await verifyFreighterNetwork('Test SDF Network ; September 2015');
      } catch (error) {
        expect((error as Error).message).toContain('Freighter is connected to Stellar Mainnet');
        expect((error as Error).message).toContain('this app expects Stellar Testnet');
        expect((error as Error).message).toContain('Please switch your wallet to Stellar Testnet');
      }
    });

    it('does not throw when wallet is on correct network', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        network: 'TESTNET',
        networkUrl: 'https://horizon-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      });

      await expect(
        verifyFreighterNetwork('Test SDF Network ; September 2015'),
      ).resolves.toBeUndefined();
    });

    it('does not throw when getNetworkDetails fails (allows simulation to catch mismatch)', async () => {
      freighterMocks.getNetworkDetails.mockRejectedValue(new Error('Network details unavailable'));

      await expect(
        verifyFreighterNetwork('Test SDF Network ; September 2015'),
      ).resolves.toBeUndefined();
    });
  });
});
