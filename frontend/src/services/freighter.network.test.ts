// @vitest-environment node
// stellar-sdk XDR encoding fails under jsdom (cross-realm Uint8Array).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, Keypair, StrKey } from '@stellar/stellar-sdk';
import type { AppConfig } from '../types/campaign';

const TESTNET = 'Test SDF Network ; September 2015';
const PUBLIC = 'Public Global Stellar Network ; September 2015';

const freighterMocks = vi.hoisted(() => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

const rpcMocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
}));

vi.mock('@stellar/freighter-api', () => freighterMocks);

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn(() => rpcMocks),
      // Skip real simulation assembly; the built transaction is returned as-is.
      assembleTransaction: vi.fn((tx: unknown) => ({ build: () => tx })),
    },
  };
});

import { verifyFreighterNetwork, submitFreighterClaim, submitFreighterPledge } from './freighter';

const creator = Keypair.random().publicKey();

const config = {
  contractId: StrKey.encodeContract(Buffer.alloc(32, 1)),
  sorobanRpcUrl: 'https://rpc.test',
  networkPassphrase: TESTNET,
  contractAmountDecimals: 2,
  assetAddresses: { USDC: StrKey.encodeContract(Buffer.alloc(32, 2)) },
} as unknown as AppConfig;

function walletOn(networkPassphrase: string) {
  freighterMocks.getNetworkDetails.mockResolvedValue({ network: 'X', networkPassphrase });
}

describe('wallet network mismatch guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMocks.getAccount.mockResolvedValue(new Account(creator, '1'));
    rpcMocks.simulateTransaction.mockResolvedValue({});
    rpcMocks.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
    rpcMocks.getTransaction.mockResolvedValue({ status: 'SUCCESS', createdAt: 1700000000 });
    freighterMocks.signTransaction.mockImplementation(async (xdr: string) => xdr);
  });

  describe('verifyFreighterNetwork', () => {
    it('resolves when the wallet network matches the app network', async () => {
      walletOn(TESTNET);
      await expect(verifyFreighterNetwork(TESTNET)).resolves.toBeUndefined();
    });

    it('names both networks and the recovery step on mismatch', async () => {
      walletOn(PUBLIC);
      await expect(verifyFreighterNetwork(TESTNET)).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_MISMATCH',
        message:
          'Freighter is connected to Stellar Mainnet, but this app expects Stellar Testnet. ' +
          'Please switch your wallet to Stellar Testnet and try again.',
      });
    });

    it('fails closed when the wallet network cannot be read', async () => {
      freighterMocks.getNetworkDetails.mockRejectedValue(new Error('locked'));
      await expect(verifyFreighterNetwork(TESTNET)).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_UNKNOWN',
        message: expect.stringMatching(/Could not determine your wallet's network.*Testnet/),
      });
    });

    it('fails closed when the wallet reports an empty network', async () => {
      walletOn('');
      await expect(verifyFreighterNetwork(TESTNET)).rejects.toMatchObject({
        code: 'FREIGHTER_NETWORK_UNKNOWN',
      });
    });
  });

  describe('submission', () => {
    it('signs and submits a claim when networks match', async () => {
      walletOn(TESTNET);

      const result = await submitFreighterClaim({ campaignId: '1', creator, config });

      expect(result.transactionHash).toBe('abc123');
      expect(freighterMocks.signTransaction).toHaveBeenCalledTimes(1);
      expect(rpcMocks.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('never signs or submits a claim when networks differ', async () => {
      walletOn(PUBLIC);

      await expect(
        submitFreighterClaim({ campaignId: '1', creator, config }),
      ).rejects.toMatchObject({ code: 'FREIGHTER_NETWORK_MISMATCH' });

      expect(rpcMocks.getAccount).not.toHaveBeenCalled();
      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
      expect(rpcMocks.sendTransaction).not.toHaveBeenCalled();
    });

    it('never signs or submits a pledge when the wallet network is unknown', async () => {
      freighterMocks.getNetworkDetails.mockRejectedValue(new Error('unavailable'));

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: creator,
          amount: 5,
          assetCode: 'USDC',
          config,
        }),
      ).rejects.toMatchObject({ code: 'FREIGHTER_NETWORK_UNKNOWN' });

      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
      expect(rpcMocks.sendTransaction).not.toHaveBeenCalled();
    });

    it('blocks signing when the wallet switches network during the preview', async () => {
      walletOn(TESTNET);
      const onPreview = vi.fn(async () => {
        walletOn(PUBLIC);
        return true;
      });

      await expect(
        submitFreighterPledge({
          campaignId: '1',
          contributor: creator,
          amount: 5,
          assetCode: 'USDC',
          config,
          onPreview,
        }),
      ).rejects.toMatchObject({ code: 'FREIGHTER_NETWORK_MISMATCH' });

      expect(onPreview).toHaveBeenCalledTimes(1);
      expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
      expect(rpcMocks.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
