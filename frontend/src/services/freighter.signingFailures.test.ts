import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../types/campaign';

// Use vi.hoisted for all mock factories to avoid hoisting issues
const mocks = vi.hoisted(() => {
  const mockServer = {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  };

  const mockAddressInstance = {
    toScVal: vi.fn().mockReturnValue('scval'),
  };

  const freighterMocks = {
    isConnected: vi.fn(),
    requestAccess: vi.fn(),
    getNetworkDetails: vi.fn(),
    signTransaction: vi.fn(),
  };

  const stellarSdkMock = {
    rpc: {
      Server: vi.fn().mockImplementation(() => mockServer),
      Api: {
        isSimulationError: vi.fn().mockReturnValue(false),
        GetTransactionStatus: {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          NOT_FOUND: 'NOT_FOUND',
        },
      },
      assembleTransaction: vi.fn(),
    },
    TransactionBuilder: Object.assign(
      vi.fn().mockImplementation(() => ({
        addOperation: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        build: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAA...unsigned_xdr...AAAAA'),
        }),
      })),
      { fromXDR: vi.fn() },
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

  return { mockServer, mockAddressInstance, freighterMocks, stellarSdkMock };
});

vi.mock('@stellar/freighter-api', () => mocks.freighterMocks);
vi.mock('@stellar/stellar-sdk', () => mocks.stellarSdkMock);

import { __setGetRpcServerImpl, submitFreighterClaim, submitFreighterPledge } from './freighter';
import { SIGNING_ERROR_MESSAGES } from '../lib/signingErrors';

const { mockServer, mockAddressInstance, freighterMocks, stellarSdkMock } = mocks;

__setGetRpcServerImpl(() => mockServer as never);

// Obviously fake values shaped like a Stellar secret seed and an XDR envelope.
const FAKE_SECRET = `S${'A'.repeat(55)}`;
const FAKE_XDR = `AAAA${'B'.repeat(120)}==`;

const TESTNET = 'Test SDF Network ; September 2015';

const mockConfig: AppConfig = {
  allowedAssets: ['USDC', 'XLM'],
  soroban: {
    enabled: true,
    contractId: `C${'A'.repeat(55)}`,
    networkPassphrase: TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
  walletIntegrationReady: true,
  contractId: `C${'A'.repeat(55)}`,
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: TESTNET,
  contractAmountDecimals: 2,
  assetAddresses: {
    XLM: 'CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6CYN5',
    USDC: 'CA6WSTPZ7RRCUC6H37CQFODG763XG2HXP2G6F367VCOGGVDP32P7665E',
  },
};

const contributor = `G${'B'.repeat(55)}`;
const campaignId = '1';

function pledge() {
  return submitFreighterPledge({
    campaignId,
    contributor,
    amount: 100,
    assetCode: 'XLM',
    config: mockConfig,
  });
}

/** Asserts neither the message nor the redacted detail leaks secret material. */
function expectNoSecretLeak(error: { message?: string; detail?: string }) {
  for (const value of [error.message ?? '', error.detail ?? '']) {
    expect(value).not.toContain(FAKE_SECRET);
    expect(value).not.toContain(FAKE_XDR);
    expect(value).not.toContain('AAAA');
  }
}

beforeEach(() => {
  vi.clearAllMocks();

  stellarSdkMock.rpc.assembleTransaction.mockImplementation(() => ({
    build: vi.fn().mockReturnValue({
      toXDR: vi.fn().mockReturnValue('AAAAA...prepared_xdr...AAAAA'),
      fee: '100000',
    }),
  }));
  stellarSdkMock.TransactionBuilder.mockImplementation(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({
      toXDR: vi.fn().mockReturnValue('AAAAA...unsigned_xdr...AAAAA'),
    }),
  }));
  stellarSdkMock.TransactionBuilder.fromXDR.mockReturnValue({
    toXDR: vi.fn().mockReturnValue('AAAAA...signed_xdr...AAAAA'),
  });
  stellarSdkMock.Contract.mockImplementation(() => ({
    call: vi.fn().mockReturnValue('operation'),
  }));
  stellarSdkMock.nativeToScVal.mockReturnValue('scval');
  stellarSdkMock.Address.fromString.mockReturnValue(mockAddressInstance);
  mockAddressInstance.toScVal.mockReturnValue('scval');

  mockServer.getAccount.mockResolvedValue({
    accountId: `G${'A'.repeat(55)}`,
    sequenceNumber: '1',
    incrementSequenceNumber: vi.fn(),
  });
  mockServer.simulateTransaction.mockResolvedValue({});
  mockServer.sendTransaction.mockResolvedValue({
    status: 'PENDING',
    hash: 'a'.repeat(64),
  });
  mockServer.getTransaction.mockResolvedValue({ status: 'SUCCESS', createdAt: 1700000000 });

  freighterMocks.isConnected.mockResolvedValue(true);
  freighterMocks.requestAccess.mockResolvedValue(contributor);
  freighterMocks.getNetworkDetails.mockResolvedValue({
    network: 'TESTNET',
    networkUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: TESTNET,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  });
  freighterMocks.signTransaction.mockResolvedValue('AAAAA...signed_xdr...AAAAA');
});

describe('signing failure classes (#931)', () => {
  it('reports a wallet user rejection as USER_REJECTED with a retry message', async () => {
    freighterMocks.signTransaction.mockRejectedValue(
      new Error(`User declined the request (debug ${FAKE_SECRET})`),
    );

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'SIGNING_FAILED',
      signingErrorClass: 'USER_REJECTED',
      message: SIGNING_ERROR_MESSAGES.USER_REJECTED,
    });
    expect(error.message).toMatch(/retry/i);
    expectNoSecretLeak(error);
    expect(error.detail).toContain('[REDACTED_SECRET]');
  });

  it('reports a missing or locked wallet as WALLET_UNAVAILABLE', async () => {
    freighterMocks.signTransaction.mockRejectedValue(new Error('Freighter extension is locked'));

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'SIGNING_FAILED',
      signingErrorClass: 'WALLET_UNAVAILABLE',
      message: SIGNING_ERROR_MESSAGES.WALLET_UNAVAILABLE,
    });
    expect(error.message).toMatch(/unlock|reconnect|install/i);
  });

  it('reports an unreadable signed envelope as MALFORMED_TRANSACTION without echoing the XDR', async () => {
    freighterMocks.signTransaction.mockResolvedValue(`AAAA${'B'.repeat(120)}==`);
    stellarSdkMock.TransactionBuilder.fromXDR.mockImplementation(() => {
      throw new Error(`XDR Read Error: unknown TransactionEnvelope ${FAKE_XDR}`);
    });

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'INVALID_SIGNED_XDR',
      signingErrorClass: 'MALFORMED_TRANSACTION',
    });
    expect(error.message).toMatch(/reconnect/i);
    expectNoSecretLeak(error);
    expect(error.detail).toContain('[REDACTED_XDR]');
  });

  it('reports an invalid address as MALFORMED_TRANSACTION before signing', async () => {
    stellarSdkMock.Address.fromString.mockImplementation(() => {
      throw new Error(`Invalid Stellar address ${FAKE_SECRET}`);
    });

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'INVALID_TRANSACTION_PARAMS',
      signingErrorClass: 'MALFORMED_TRANSACTION',
      message: SIGNING_ERROR_MESSAGES.MALFORMED_TRANSACTION,
    });
    expectNoSecretLeak(error);
    expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
  });

  it('reports an RPC submission transport failure as RPC_FAILURE', async () => {
    mockServer.sendTransaction.mockRejectedValue(
      new Error(`request to https://rpc failed, timeout ${FAKE_XDR}`),
    );

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'SUBMISSION_FAILED',
      signingErrorClass: 'RPC_FAILURE',
      message: SIGNING_ERROR_MESSAGES.RPC_FAILURE,
    });
    expectNoSecretLeak(error);
  });

  it('reports a polling failure as RPC_FAILURE instead of leaking raw RPC text', async () => {
    mockServer.getTransaction.mockRejectedValue(new Error(`socket hang up ${FAKE_SECRET}`));

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'TRANSACTION_STATUS_UNAVAILABLE',
      signingErrorClass: 'RPC_FAILURE',
      message: SIGNING_ERROR_MESSAGES.RPC_FAILURE,
    });
    expectNoSecretLeak(error);
  });

  it('reports a network rejection as CONTRACT_REJECTED', async () => {
    mockServer.sendTransaction.mockResolvedValue({ status: 'ERROR', hash: 'b'.repeat(64) });

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'SUBMISSION_FAILED',
      signingErrorClass: 'CONTRACT_REJECTED',
    });
    expect(error.message).toContain(SIGNING_ERROR_MESSAGES.CONTRACT_REJECTED);
  });

  it('reports a confirmed-but-failed transaction as CONTRACT_REJECTED', async () => {
    mockServer.getTransaction.mockResolvedValue({ status: 'FAILED' });

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'TRANSACTION_FAILED',
      signingErrorClass: 'CONTRACT_REJECTED',
    });
    expect(error.message).toContain(SIGNING_ERROR_MESSAGES.CONTRACT_REJECTED);
  });

  it('reports a missing submission hash as RPC_FAILURE', async () => {
    mockServer.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: undefined });

    const error = await pledge().catch((e) => e);

    expect(error).toMatchObject({
      code: 'SUBMISSION_FAILED',
      signingErrorClass: 'RPC_FAILURE',
    });
  });

  it('keeps the claim path on the same classification contract', async () => {
    freighterMocks.signTransaction.mockRejectedValue(new Error('User rejected'));

    const error = await submitFreighterClaim({
      campaignId,
      creator: `G${'C'.repeat(55)}`,
      config: mockConfig,
    }).catch((e) => e);

    expect(error).toMatchObject({
      code: 'SIGNING_FAILED',
      signingErrorClass: 'USER_REJECTED',
      message: SIGNING_ERROR_MESSAGES.USER_REJECTED,
    });
  });
});
