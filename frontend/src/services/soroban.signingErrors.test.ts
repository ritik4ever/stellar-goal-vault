import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const server = {
    getAccount: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    pollTransaction: vi.fn(),
  };

  const freighterMocks = {
    requestAccess: vi.fn(),
    getNetworkDetails: vi.fn(),
    signTransaction: vi.fn(),
  };

  const stellarSdkMock = {
    rpc: {
      Server: vi.fn().mockImplementation(() => server),
      Api: {
        isSimulationError: vi.fn().mockReturnValue(false),
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
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
    Contract: vi.fn().mockImplementation(() => ({ call: vi.fn().mockReturnValue('operation') })),
    Address: vi.fn().mockImplementation(() => ({ toScVal: vi.fn().mockReturnValue('scval') })),
    nativeToScVal: vi.fn().mockReturnValue('scval'),
    BASE_FEE: '100',
  };

  return { server, freighterMocks, stellarSdkMock };
});

vi.mock('@stellar/freighter-api', () => mocks.freighterMocks);
vi.mock('@stellar/stellar-sdk', () => mocks.stellarSdkMock);
vi.mock('./api', () => ({
  getAppConfig: vi.fn().mockResolvedValue({
    soroban: {
      contractId: `C${'A'.repeat(55)}`,
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'https://soroban-testnet.stellar.org',
    },
  }),
}));

import { submitRefundTransaction } from './soroban';
import { getAppConfig } from './api';
import { SIGNING_ERROR_MESSAGES } from '../lib/signingErrors';

const { server, freighterMocks, stellarSdkMock } = mocks;

const FAKE_SECRET = `S${'A'.repeat(55)}`;
const FAKE_XDR = `AAAA${'B'.repeat(120)}==`;
const TESTNET = 'Test SDF Network ; September 2015';
const contributor = `G${'B'.repeat(55)}`;

function refund() {
  return submitRefundTransaction('1', contributor);
}

function expectNoSecretLeak(error: { message?: string; detail?: string }) {
  for (const value of [error.message ?? '', error.detail ?? '']) {
    expect(value).not.toContain(FAKE_SECRET);
    expect(value).not.toContain(FAKE_XDR);
  }
}

const refundConfig = {
  soroban: {
    contractId: `C${'A'.repeat(55)}`,
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppConfig).mockResolvedValue(refundConfig as never);

  // `restoreMocks` resets factory implementations between tests, so re-apply
  // the SDK construction mocks here (same pattern as freighter.integration.test.ts).
  stellarSdkMock.rpc.Server.mockImplementation(() => server);
  stellarSdkMock.rpc.Api.isSimulationError.mockReturnValue(false);
  stellarSdkMock.Contract.mockImplementation(() => ({
    call: vi.fn().mockReturnValue('operation'),
  }));
  stellarSdkMock.Address.mockImplementation(() => ({
    toScVal: vi.fn().mockReturnValue('scval'),
  }));
  stellarSdkMock.nativeToScVal.mockReturnValue('scval');

  stellarSdkMock.rpc.assembleTransaction.mockImplementation(() => ({
    build: vi.fn().mockReturnValue({
      toXDR: vi.fn().mockReturnValue('AAAAA...prepared_xdr...AAAAA'),
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

  server.getAccount.mockResolvedValue({
    accountId: contributor,
    sequenceNumber: '1',
    incrementSequenceNumber: vi.fn(),
  });
  server.simulateTransaction.mockResolvedValue({});
  server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'd'.repeat(64) });
  server.pollTransaction.mockResolvedValue({ status: 'SUCCESS', ledger: 10, latestLedger: 11 });

  freighterMocks.requestAccess.mockResolvedValue(contributor);
  freighterMocks.getNetworkDetails.mockResolvedValue({
    network: 'TESTNET',
    networkUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: TESTNET,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  });
  freighterMocks.signTransaction.mockResolvedValue('AAAAA...signed_xdr...AAAAA');
});

describe('refund submission signing failures (#931)', () => {
  it('submits successfully when every step succeeds', async () => {
    await expect(refund()).resolves.toMatchObject({ txHash: 'd'.repeat(64) });
  });

  it('classifies a wallet rejection without leaking the raw error', async () => {
    freighterMocks.signTransaction.mockRejectedValue(
      new Error(`User rejected signing (key ${FAKE_SECRET})`),
    );

    const error = await refund().catch((e) => e);

    expect(error).toMatchObject({
      code: 'SIGNING_FAILED',
      signingErrorClass: 'USER_REJECTED',
      message: SIGNING_ERROR_MESSAGES.USER_REJECTED,
    });
    expectNoSecretLeak(error);
    expect(error.detail).toContain('[REDACTED_SECRET]');
  });

  it('rejects an unreadable signed envelope as MALFORMED_TRANSACTION', async () => {
    stellarSdkMock.TransactionBuilder.fromXDR.mockImplementation(() => {
      throw new Error(`XDR Read Error ${FAKE_XDR}`);
    });

    const error = await refund().catch((e) => e);

    expect(error).toMatchObject({
      code: 'INVALID_SIGNED_XDR',
      signingErrorClass: 'MALFORMED_TRANSACTION',
    });
    expect(error.message).toMatch(/reconnect/i);
    expectNoSecretLeak(error);
    expect(error.detail).toContain('[REDACTED_XDR]');
  });

  it('reports a network rejection as CONTRACT_REJECTED with recovery guidance', async () => {
    server.pollTransaction.mockResolvedValue({ status: 'FAILED' });

    const error = await refund().catch((e) => e);

    expect(error).toMatchObject({
      code: 'TRANSACTION_FAILED',
      signingErrorClass: 'CONTRACT_REJECTED',
      message: SIGNING_ERROR_MESSAGES.CONTRACT_REJECTED,
    });
  });

  it('reports an RPC outage as RPC_FAILURE without echoing transport text', async () => {
    server.sendTransaction.mockRejectedValue(new Error(`socket hang up ${FAKE_XDR}`));

    const error = await refund().catch((e) => e);

    expect(error).toMatchObject({
      code: 'SUBMISSION_FAILED',
      signingErrorClass: 'RPC_FAILURE',
      message: SIGNING_ERROR_MESSAGES.RPC_FAILURE,
    });
    expectNoSecretLeak(error);
  });

  it('reports missing config as a malformed-transaction failure', async () => {
    vi.mocked(getAppConfig).mockResolvedValueOnce({
      soroban: { contractId: '', networkPassphrase: TESTNET, rpcUrl: '' },
    } as never);

    const error = await refund().catch((e) => e);

    expect(error).toMatchObject({
      code: 'CONFIG_MISSING',
      signingErrorClass: 'MALFORMED_TRANSACTION',
    });
    expect(freighterMocks.signTransaction).not.toHaveBeenCalled();
  });
});
