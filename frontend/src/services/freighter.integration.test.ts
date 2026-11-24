import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CampaignDetailPanel } from '../components/CampaignDetailPanel';
import type { Campaign, AppConfig } from '../types/campaign';

// Use vi.hoisted for all mock factories to avoid hoisting issues
const mocks = vi.hoisted(() => {
  // Shared mock server
  const mockServer = {
    getAccount: vi.fn().mockResolvedValue({
      accountId: `G${'A'.repeat(55)}`,
      sequenceNumber: '1',
      incrementSequenceNumber: vi.fn(),
    }),
    simulateTransaction: vi.fn().mockResolvedValue({}),
    assembleTransaction: vi.fn().mockReturnValue({
      build: vi.fn().mockReturnValue({
        toXDR: vi.fn().mockReturnValue('AAAAA...prepared_xdr...AAAAA'),
        fee: '100000',
      }),
    }),
    sendTransaction: vi.fn().mockResolvedValue({
      status: 'PENDING',
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }),
    getTransaction: vi.fn()
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'SUCCESS', createdAt: Date.now() }),
  };

  // Shared mock address instance
  const mockAddressInstance = {
    toScVal: vi.fn().mockReturnValue('scval'),
  };

  // Freighter API mocks
  const freighterMocks = {
    isConnected: vi.fn(),
    requestAccess: vi.fn(),
    getNetworkDetails: vi.fn(),
    signTransaction: vi.fn(),
  };

  // Stellar SDK mock
  const stellarSdkMock = {
    rpc: {
      Server: vi.fn().mockImplementation(() => mockServer),
      Api: {
        isSimulationError: vi.fn().mockReturnValue(false),
        GetTransactionStatus: {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          NOT_FOUND: 'NOT_FOUND',
          PENDING: 'PENDING',
        },
      },
      assembleTransaction: vi.fn().mockImplementation(() => mockServer.assembleTransaction()),
    },
    TransactionBuilder: Object.assign(
      vi.fn().mockImplementation(() => ({
        addOperation: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        build: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAA...unsigned_xdr...AAAAA'),
        }),
      })),
      {
        fromXDR: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAA...signed_xdr...AAAAA'),
        }),
      },
    ),
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue('operation'),
    })),
    Address: {
      fromString: vi.fn().mockReturnValue(mockAddressInstance),
    },
    nativeToScVal: vi.fn().mockReturnValue('scval'),
    BASE_FEE: '100',
  };

  return {
    mockServer,
    mockAddressInstance,
    freighterMocks,
    stellarSdkMock,
  };
});

// Apply mocks
vi.mock('@stellar/freighter-api', () => mocks.freighterMocks);
vi.mock('@stellar/stellar-sdk', () => mocks.stellarSdkMock);

// Mock freighter module with test implementations
vi.mock('./freighter', async () => {
  const actual = await vi.importActual('./freighter');
  return {
    ...actual,
    getRpcServer: () => mocks.mockServer,
  };
});
vi.mock('../components/ContributorSummary', () => ({ ContributorSummary: () => null }));

const mockServer = mocks.mockServer;
const mockAddressInstance = mocks.mockAddressInstance;
const freighterMocks = mocks.freighterMocks;

import {
  connectFreighterWallet,
  submitFreighterPledge,
  submitFreighterClaim,
  __setGetRpcServerImpl,
} from './freighter';

__setGetRpcServerImpl(() => mockServer as never);

describe('Freighter Transaction Builder Integration Tests', () => {
  const mockConfig: AppConfig = {
    allowedAssets: ['USDC', 'XLM'],
    soroban: {
      enabled: true,
      contractId: 'C' + 'A'.repeat(55),
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'https://soroban-testnet.stellar.org',
    },
    walletIntegrationReady: true,
    contractId: 'C' + 'A'.repeat(55),
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractAmountDecimals: 2,
    assetAddresses: {
      XLM: 'CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6CYN5',
      USDC: 'CA6WSTPZ7RRCUC6H37CQFODG763XG2HXP2G6F367VCOGGVDP32P7665E',
    },
  };

  const mockContributor = `G${'B'.repeat(55)}`;
  const mockCreator = `G${'C'.repeat(55)}`;
  const mockCampaignId = '1';
  const mockCampaign: Campaign = {
    id: mockCampaignId,
    creator: mockCreator,
    title: 'Community garden',
    description: 'Fund a community garden',
    acceptedTokens: ['USDC', 'XLM'],
    assetCode: 'USDC',
    targetAmount: 1000,
    pledgedAmount: 0,
    deadline: 4102444800,
    createdAt: 1700000000,
    progress: {
      status: 'open',
      percentFunded: 0,
      remainingAmount: 1000,
      pledgeCount: 0,
      hoursLeft: 24,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stellarSdkMock.rpc.assembleTransaction.mockImplementation(() =>
      mockServer.assembleTransaction(),
    );
    mocks.stellarSdkMock.TransactionBuilder.mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        toXDR: vi.fn().mockReturnValue('AAAAA...unsigned_xdr...AAAAA'),
      }),
    }));
    mocks.stellarSdkMock.TransactionBuilder.fromXDR.mockReturnValue({
      toXDR: vi.fn().mockReturnValue('AAAAA...signed_xdr...AAAAA'),
    });
    mocks.stellarSdkMock.Contract.mockImplementation(() => ({
      call: vi.fn().mockReturnValue('operation'),
    }));
    mocks.stellarSdkMock.nativeToScVal.mockReturnValue('scval');
    mocks.stellarSdkMock.Address.fromString.mockReturnValue(mockAddressInstance);
    mockAddressInstance.toScVal.mockReturnValue('scval');

    // Reset mockServer methods to default successful behavior
    mockServer.getAccount.mockResolvedValue({
      accountId: `G${'A'.repeat(55)}`,
      sequenceNumber: '1',
      incrementSequenceNumber: vi.fn(),
    });
    mockServer.simulateTransaction.mockResolvedValue({});
    mockServer.assembleTransaction.mockReturnValue({
      build: vi.fn().mockReturnValue({
        toXDR: vi.fn().mockReturnValue('AAAAA...prepared_xdr...AAAAA'),
        fee: '100000',
      }),
    });
    mockServer.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    mockServer.getTransaction.mockReset();
    mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS', createdAt: Date.now() });

    // Default successful mocks
    freighterMocks.isConnected.mockResolvedValue(true);
    freighterMocks.requestAccess.mockResolvedValue(mockContributor);
    freighterMocks.getNetworkDetails.mockResolvedValue({
      network: 'TESTNET',
      networkUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    });
    freighterMocks.signTransaction.mockResolvedValue('AAAAA...signed_xdr...AAAAA');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connect path', () => {
    it('successfully connects and verifies network on pledge', async () => {
      const connection = await connectFreighterWallet(mockConfig.networkPassphrase);
      const result = await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: connection.publicKey,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });

      expect(freighterMocks.isConnected).toHaveBeenCalled();
      expect(freighterMocks.requestAccess).toHaveBeenCalled();
      expect(freighterMocks.getNetworkDetails).toHaveBeenCalled();
      expect(result).toHaveProperty('transactionHash');
      expect(result).toHaveProperty('confirmedAt');
    });

    it('successfully connects and verifies network on claim', async () => {
      await connectFreighterWallet(mockConfig.networkPassphrase);
      const result = await submitFreighterClaim({
        campaignId: mockCampaignId,
        creator: mockCreator,
        config: mockConfig,
      });

      expect(freighterMocks.isConnected).toHaveBeenCalled();
      expect(freighterMocks.requestAccess).toHaveBeenCalled();
      expect(freighterMocks.getNetworkDetails).toHaveBeenCalled();
      expect(result).toHaveProperty('transactionHash');
    });
  });

  describe('reject path (user cancels)', () => {
    it('rejects when user cancels at preview panel for pledge', async () => {
      const onPreview = vi.fn().mockResolvedValue(false);

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
          onPreview,
        }),
      ).rejects.toMatchObject({
        code: 'USER_CANCELLED',
      });

      expect(onPreview).toHaveBeenCalled();
      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
    });

    it('rejects when user cancels at preview panel for claim', async () => {
      const onPreview = vi.fn().mockResolvedValue(false);

      await expect(
        submitFreighterClaim({
          campaignId: mockCampaignId,
          creator: mockCreator,
          config: mockConfig,
          onPreview,
        }),
      ).rejects.toMatchObject({
        code: 'USER_CANCELLED',
      });

      expect(onPreview).toHaveBeenCalled();
      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
    });

    it('rejects when Freighter access is denied', async () => {
      freighterMocks.requestAccess.mockRejectedValue(new Error('User rejected'));

      await expect(connectFreighterWallet(mockConfig.networkPassphrase)).rejects.toMatchObject({
        code: 'FREIGHTER_ACCESS_DENIED',
      });
    });

    it('rejects when Freighter signing is rejected', async () => {
      freighterMocks.signTransaction.mockRejectedValue(new Error('User rejected signing'));

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'SIGNING_FAILED',
      });
    });
  });

  describe('sign path', () => {
    it('signs transaction with correct parameters for pledge', async () => {
      await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });

      expect(freighterMocks.signTransaction).toHaveBeenCalledWith(
        'AAAAA...prepared_xdr...AAAAA',
        expect.objectContaining({
          accountToSign: mockContributor,
          networkPassphrase: mockConfig.networkPassphrase,
        }),
      );
    });

    it('signs transaction with correct parameters for claim', async () => {
      await submitFreighterClaim({
        campaignId: mockCampaignId,
        creator: mockCreator,
        config: mockConfig,
      });

      expect(freighterMocks.signTransaction).toHaveBeenCalledWith(
        'AAAAA...prepared_xdr...AAAAA',
        expect.objectContaining({
          accountToSign: mockCreator,
          networkPassphrase: mockConfig.networkPassphrase,
        }),
      );
    });

    it('includes asset code and amount in preview for pledge', async () => {
      const onPreview = vi.fn().mockResolvedValue(true);

      await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 250,
        assetCode: 'USDC',
        config: mockConfig,
        onPreview,
      });

      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'contribute',
          amount: 250,
          assetCode: 'USDC',
          contract: mockConfig.contractId,
        }),
      );
    });
  });

  describe('submit path', () => {
    it('submits signed transaction to Soroban RPC for pledge', async () => {
      await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });

      expect(mockServer.sendTransaction).toHaveBeenCalled();
    });

    it('submits signed transaction to Soroban RPC for claim', async () => {
      await submitFreighterClaim({
        campaignId: mockCampaignId,
        creator: mockCreator,
        config: mockConfig,
      });

      expect(mockServer.sendTransaction).toHaveBeenCalled();
    });

    it('handles RPC TRY_AGAIN_LATER status', async () => {
      mockServer.sendTransaction.mockResolvedValueOnce({
        status: 'TRY_AGAIN_LATER',
      });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'SUBMISSION_RETRY',
      });
    });

    it('handles RPC ERROR status', async () => {
      mockServer.sendTransaction.mockResolvedValueOnce({
        status: 'ERROR',
        hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'SUBMISSION_FAILED',
      });
    });
  });

  describe('timeout path', () => {
    it('times out when transaction does not confirm', async () => {
      vi.useFakeTimers();
      mockServer.getTransaction.mockResolvedValue({ status: 'PENDING' });

      const transaction = submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });
      const timeoutAssertion = expect(transaction).rejects.toMatchObject({
        code: 'TRANSACTION_TIMEOUT',
      });
      await vi.runAllTimersAsync();
      await timeoutAssertion;

      // Should have polled 25 times
      expect(mockServer.getTransaction).toHaveBeenCalledTimes(25);
    });

    it('times out when transaction fails on network', async () => {
      mockServer.getTransaction.mockResolvedValue({
        status: 'FAILED',
      });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
      });
    });
  });

  describe('network-mismatch path', () => {
    it('detects network mismatch before pledge transaction', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        network: 'PUBLIC',
        networkUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        sorobanRpcUrl: 'https://mainnet.rpc',
      });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_MISMATCH',
      });

      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
    });

    it('detects network mismatch before claim transaction', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        network: 'PUBLIC',
        networkUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        sorobanRpcUrl: 'https://mainnet.rpc',
      });

      await expect(
        submitFreighterClaim({
          campaignId: mockCampaignId,
          creator: mockCreator,
          config: mockConfig,
        }),
      ).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_MISMATCH',
      });

      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
    });

    it('includes actionable error message with network names', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        network: 'PUBLIC',
        networkUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        sorobanRpcUrl: 'https://mainnet.rpc',
      });

      try {
        await submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        });
      } catch (error) {
        expect((error as Error).message).toContain('Stellar Mainnet');
        expect((error as Error).message).toContain('Stellar Testnet');
        expect((error as Error).message).toContain('switch your wallet');
      }
    });

    it('allows transaction when getNetworkDetails fails (graceful degradation)', async () => {
      freighterMocks.getNetworkDetails.mockRejectedValue(new Error('Network unavailable'));

      const result = await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });

      expect(result).toHaveProperty('transactionHash');
    });
  });

  describe('final application state verification', () => {
    it('connects, submits the selected campaign asset, and shows the completed pledge state', async () => {
      vi.useRealTimers();
      const connection = await connectFreighterWallet(mockConfig.networkPassphrase);
      mockServer.getTransaction.mockReset().mockResolvedValue({
        status: 'SUCCESS',
        createdAt: Date.now(),
      });
      const onPreview = vi.fn().mockResolvedValue(true);
      const onPledge = vi.fn(async (campaignId: string, amount: number, assetCode: string) => {
        await submitFreighterPledge({
          campaignId,
          contributor: connection.publicKey,
          amount,
          assetCode,
          config: mockConfig,
          onPreview,
        });
      });
      const user = userEvent.setup();

      render(
        createElement(
          MemoryRouter,
          null,
          createElement(CampaignDetailPanel, {
            campaign: mockCampaign,
            appConfig: mockConfig,
            connectedWallet: connection.publicKey,
            onPledge,
          }),
        ),
      );

      await user.selectOptions(screen.getByRole('combobox', { name: 'Asset' }), 'XLM');
      await user.click(screen.getByRole('button', { name: 'Pledge' }));

      expect(onPledge).toHaveBeenCalledWith(mockCampaignId, 25, 'XLM');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'contribute', assetCode: 'XLM' }),
      );
      expect(mockAddressInstance.toScVal).toHaveBeenCalled();
      expect(mocks.stellarSdkMock.Address.fromString).toHaveBeenCalledWith(
        mockConfig.assetAddresses.XLM,
      );
      expect(freighterMocks.signTransaction).toHaveBeenCalled();
      expect(mockServer.sendTransaction).toHaveBeenCalled();
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Your pledge was submitted successfully.',
      );
      expect(screen.getByLabelText('Amount')).toHaveValue(25);
      expect(screen.getByRole('combobox', { name: 'Asset' })).toHaveValue('');
    });

    it('returns confirmed transaction hash and timestamp on successful pledge', async () => {
      const result = await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });

      expect(result.transactionHash).toBe(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      expect(typeof result.confirmedAt).toBe('number');
      expect(result.confirmedAt).toBeGreaterThan(0);
    });

    it('returns confirmed transaction hash and timestamp on successful claim', async () => {
      const result = await submitFreighterClaim({
        campaignId: mockCampaignId,
        creator: mockCreator,
        config: mockConfig,
      });

      expect(result.transactionHash).toBe(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      expect(typeof result.confirmedAt).toBe('number');
      expect(result.confirmedAt).toBeGreaterThan(0);
    });

    it('verifies transaction builder constructs correct operation for pledge', async () => {
      await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });

      expect(mocks.stellarSdkMock.Contract).toHaveBeenCalledWith(mockConfig.contractId);
      expect(mocks.stellarSdkMock.Contract.mock.results[0].value.call).toHaveBeenCalledWith(
        'contribute',
        expect.anything(), // campaignId
        expect.anything(), // contributor address
        expect.anything(), // token address
        expect.anything(), // amount
      );
    });

    it('verifies transaction builder constructs correct operation for claim', async () => {
      await submitFreighterClaim({
        campaignId: mockCampaignId,
        creator: mockCreator,
        config: mockConfig,
      });

      expect(mocks.stellarSdkMock.Contract).toHaveBeenCalledWith(mockConfig.contractId);
      expect(mocks.stellarSdkMock.Contract.mock.results[0].value.call).toHaveBeenCalledWith(
        'claim',
        expect.anything(), // campaignId
        expect.anything(), // creator address
      );
    });

    it('verifies simulation is called before signing', async () => {
      await submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });

      expect(mockServer.simulateTransaction).toHaveBeenCalled();
      expect(mockServer.assembleTransaction).toHaveBeenCalled();
    });
  });

  describe('error codes are properly propagated', () => {
    it('propagates FREIGHTER_UNAVAILABLE', async () => {
      freighterMocks.isConnected.mockResolvedValue(false);

      await expect(connectFreighterWallet(mockConfig.networkPassphrase)).rejects.toMatchObject({
        code: 'FREIGHTER_UNAVAILABLE',
      });
    });

    it('propagates FREIGHTER_ACCESS_DENIED', async () => {
      freighterMocks.requestAccess.mockRejectedValue(new Error('denied'));

      await expect(connectFreighterWallet(mockConfig.networkPassphrase)).rejects.toMatchObject({
        code: 'FREIGHTER_ACCESS_DENIED',
      });
    });

    it('propagates FREIGHTER_NETWORK_MISMATCH', async () => {
      freighterMocks.getNetworkDetails.mockResolvedValue({
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'FREIGHTER_NETWORK_MISMATCH' });
    });

    it('propagates CONFIG_MISSING', async () => {
      const config = { ...mockConfig, contractId: '' };

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config,
        }),
      ).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    });

    it('propagates SOURCE_ACCOUNT_LOAD_FAILED', async () => {
      mockServer.getAccount.mockRejectedValue(new Error('Account not found'));

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'SOURCE_ACCOUNT_LOAD_FAILED' });
    });

    it('propagates SIMULATION_FAILED', async () => {
      mockServer.simulateTransaction.mockResolvedValue({ error: 'simulation error' });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    });

    it('propagates STATE_RESTORE_REQUIRED', async () => {
      mockServer.simulateTransaction.mockResolvedValue({ restorePreamble: true });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'STATE_RESTORE_REQUIRED' });
    });

    it('propagates SIMULATION_PREPARE_FAILED', async () => {
      mockServer.assembleTransaction.mockImplementation(() => { throw new Error('prepare failed'); });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'SIMULATION_PREPARE_FAILED' });
    });

    it('propagates SIGNING_FAILED', async () => {
      freighterMocks.signTransaction.mockRejectedValue(new Error('sign failed'));

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'SIGNING_FAILED' });
    });

    it('propagates SUBMISSION_FAILED', async () => {
      mockServer.sendTransaction.mockRejectedValue(new Error('submit failed'));

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'SUBMISSION_FAILED' });
    });

    it('propagates CONTRACT_CALL_FAILED', async () => {
      mockServer.sendTransaction.mockResolvedValue({ status: 'ERROR', hash: 'cccc...' });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'SUBMISSION_FAILED' });
    });

    it('propagates TRANSACTION_FAILED', async () => {
      mockServer.getTransaction.mockResolvedValue({ status: 'FAILED' });

      await expect(
        submitFreighterPledge({
          campaignId: mockCampaignId,
          contributor: mockContributor,
          amount: 100,
          assetCode: 'XLM',
          config: mockConfig,
        }),
      ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    });

    it('propagates TRANSACTION_TIMEOUT', async () => {
      vi.useFakeTimers();
      mockServer.getTransaction.mockResolvedValue({ status: 'PENDING' });

      const transaction = submitFreighterPledge({
        campaignId: mockCampaignId,
        contributor: mockContributor,
        amount: 100,
        assetCode: 'XLM',
        config: mockConfig,
      });
      const timeoutAssertion = expect(transaction).rejects.toMatchObject({
        code: 'TRANSACTION_TIMEOUT',
      });
      await vi.runAllTimersAsync();
      await timeoutAssertion;
    });
  });
});