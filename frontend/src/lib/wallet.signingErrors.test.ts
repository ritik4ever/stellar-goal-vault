import { beforeEach, describe, expect, it, vi } from 'vitest';

const walletApiMocks = vi.hoisted(() => ({
  freighter: {
    isConnected: vi.fn(),
    requestAccess: vi.fn(),
    getNetworkDetails: vi.fn(),
    signTransaction: vi.fn(),
  },
  xbull: { connect: vi.fn(), sign: vi.fn() },
  lobstr: { getPublicKey: vi.fn(), signTransaction: vi.fn() },
}));

vi.mock('@stellar/freighter-api', () => walletApiMocks.freighter);
vi.mock('@creit.tech/xbull-wallet-connect', () => ({
  xBullWalletConnect: vi.fn().mockImplementation(() => walletApiMocks.xbull),
}));
vi.mock('@lobstrco/signer-extension-api', () => ({
  getPublicKey: walletApiMocks.lobstr.getPublicKey,
  signTransaction: walletApiMocks.lobstr.signTransaction,
}));

import { getAdapter } from './wallet';
import { SIGNING_ERROR_MESSAGES, classifySigningError } from './signingErrors';

// Obviously fake values shaped like a Stellar secret seed and an XDR envelope.
const FAKE_SECRET = `S${'A'.repeat(55)}`;
const FAKE_XDR = `AAAA${'B'.repeat(120)}==`;
const TESTNET = 'Test SDF Network ; September 2015';
const PUBLIC_KEY = `G${'A'.repeat(55)}`;

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as any).rabet;
  walletApiMocks.freighter.isConnected.mockResolvedValue(true);
  walletApiMocks.freighter.requestAccess.mockResolvedValue(PUBLIC_KEY);
  walletApiMocks.freighter.getNetworkDetails.mockResolvedValue({
    network: 'TESTNET',
    networkUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: TESTNET,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  });
  walletApiMocks.lobstr.getPublicKey.mockResolvedValue(PUBLIC_KEY);
});

function expectNoSecretLeak(error: { message?: string; detail?: string }) {
  for (const value of [error.message ?? '', error.detail ?? '']) {
    expect(value).not.toContain(FAKE_SECRET);
    expect(value).not.toContain(FAKE_XDR);
  }
}

describe('wallet adapter connection failures (#931)', () => {
  it('classifies a throwing Freighter probe as WALLET_UNAVAILABLE', async () => {
    walletApiMocks.freighter.isConnected.mockRejectedValue(
      new Error(`extension crashed with ${FAKE_SECRET}`),
    );

    const error = await getAdapter('freighter')
      .connect(TESTNET)
      .catch((e) => e);

    expect(error).toMatchObject({
      code: 'FREIGHTER_UNAVAILABLE',
      signingErrorClass: 'WALLET_UNAVAILABLE',
      message: SIGNING_ERROR_MESSAGES.WALLET_UNAVAILABLE,
    });
    expectNoSecretLeak(error);
  });

  it('classifies a Freighter access rejection as USER_REJECTED without raw wallet text', async () => {
    walletApiMocks.freighter.requestAccess.mockRejectedValue(
      new Error(`User declined access (xdr ${FAKE_XDR})`),
    );

    const error = await getAdapter('freighter')
      .connect(TESTNET)
      .catch((e) => e);

    expect(error).toMatchObject({
      code: 'FREIGHTER_ACCESS_DENIED',
      signingErrorClass: 'USER_REJECTED',
    });
    expect(error.message).toMatch(/retry/i);
    expectNoSecretLeak(error);
    expect(error.detail).toContain('[REDACTED_XDR]');
  });

  it('keeps the authored network mismatch guidance and tags its class', async () => {
    walletApiMocks.freighter.getNetworkDetails.mockResolvedValue({
      network: 'PUBLIC',
      networkUrl: 'https://horizon.stellar.org',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
      sorobanRpcUrl: 'https://mainnet.rpc',
    });

    const error = await getAdapter('freighter')
      .connect(TESTNET)
      .catch((e) => e);

    expect(error).toMatchObject({
      code: 'FREIGHTER_NETWORK_MISMATCH',
      signingErrorClass: 'WALLET_UNAVAILABLE',
    });
    expect(error.message).toMatch(/testnet/i);
    expect(error.message).toMatch(/try again/i);
  });

  it('classifies a missing Rabet extension as WALLET_UNAVAILABLE', async () => {
    const error = await getAdapter('rabet')
      .connect(TESTNET)
      .catch((e) => e);

    expect(error).toMatchObject({
      code: 'RABET_UNAVAILABLE',
      signingErrorClass: 'WALLET_UNAVAILABLE',
    });
    expectNoSecretLeak(error);
  });

  it('classifies a xBull rejection as USER_REJECTED with a recoverable message', async () => {
    walletApiMocks.xbull.connect.mockRejectedValue(new Error(`User rejected ${FAKE_SECRET}`));

    const error = await getAdapter('xbull')
      .connect(TESTNET)
      .catch((e) => e);

    expect(error).toMatchObject({ signingErrorClass: 'USER_REJECTED' });
    expect(error.message).toMatch(/retry/i);
    expectNoSecretLeak(error);
  });

  it('classifies a LOBSTR rejection without raw wallet text', async () => {
    walletApiMocks.lobstr.getPublicKey.mockRejectedValue(
      new Error(`LOBSTR is locked ${FAKE_SECRET}`),
    );

    const error = await getAdapter('lobstr')
      .connect(TESTNET)
      .catch((e) => e);

    // A locked wallet is an availability problem, not a rejection.
    expect(error).toMatchObject({
      code: 'LOBSTR_ACCESS_DENIED',
      signingErrorClass: 'WALLET_UNAVAILABLE',
    });
    expectNoSecretLeak(error);
    expect(error.detail).toContain('[REDACTED_SECRET]');
  });

  it('classifies a malformed signature from any adapter as a signing error', async () => {
    walletApiMocks.freighter.signTransaction.mockRejectedValue(
      new Error(`XDR Read Error ${FAKE_XDR}`),
    );

    const error = await getAdapter('freighter')
      .sign(FAKE_XDR, TESTNET, PUBLIC_KEY)
      .catch((e) => e);

    expect(classifySigningError(error)).toBe('MALFORMED_TRANSACTION');
    expectNoSecretLeak(error);
  });
});
