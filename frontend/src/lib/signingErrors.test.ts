import { afterEach, describe, expect, it, vi } from 'vitest';

const freighterMocks = vi.hoisted(() => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock('@stellar/freighter-api', () => freighterMocks);

import {
  SIGNING_ERROR_MESSAGES,
  SigningErrorClass,
  classifySigningError,
  createSigningError,
  describeErrorForLog,
  redactSecretMaterial,
  safeErrorMessage,
  toSigningError,
} from './signingErrors';
import { connectFreighterWallet, verifyFreighterNetwork } from '../services/freighter';

// Obviously fake values shaped like a Stellar secret seed and an XDR envelope.
const FAKE_SECRET = `S${'A'.repeat(55)}`;
const FAKE_XDR = `AAAA${'B'.repeat(120)}==`;
const TESTNET = 'Test SDF Network ; September 2015';

describe('classifySigningError', () => {
  it.each<[string, unknown, SigningErrorClass]>([
    ['Freighter user rejection', new Error('User declined access'), 'USER_REJECTED'],
    ['wallet rejection string', 'Request was rejected by the user', 'USER_REJECTED'],
    ['missing extension', new Error('Freighter is not installed'), 'WALLET_UNAVAILABLE'],
    ['locked wallet', new Error('Wallet is locked'), 'WALLET_UNAVAILABLE'],
    ['bad XDR', new Error('XDR Read Error: unknown TransactionEnvelope'), 'MALFORMED_TRANSACTION'],
    ['RPC timeout', new Error('timeout of 30000ms exceeded'), 'RPC_FAILURE'],
    ['fetch failure', new TypeError('Failed to fetch'), 'RPC_FAILURE'],
    ['HTTP 503', { message: 'Request failed', response: { status: 503 } }, 'RPC_FAILURE'],
    ['contract trap', new Error('HostError: Error(Contract, #4)'), 'CONTRACT_REJECTED'],
    ['tx result code', new Error('transaction failed: txBadSeq'), 'CONTRACT_REJECTED'],
    ['unrecognised', new Error('something odd happened'), 'UNKNOWN'],
    ['non-error value', 42, 'UNKNOWN'],
  ])('maps %s', (_label, raw, expected) => {
    expect(classifySigningError(raw)).toBe(expected);
  });

  it('prefers known app error codes over message text', () => {
    expect(classifySigningError({ code: 'USER_CANCELLED', message: 'timeout' })).toBe(
      'USER_REJECTED',
    );
    expect(classifySigningError({ code: 'TRANSACTION_FAILED' })).toBe('CONTRACT_REJECTED');
    expect(classifySigningError({ code: 'SUBMISSION_RETRY' })).toBe('RPC_FAILURE');
  });

  it('does not mistake an RPC rejection for a user rejection', () => {
    expect(classifySigningError(new Error('Soroban RPC rejected the transaction'))).not.toBe(
      'USER_REJECTED',
    );
  });

  it('gives every class a distinct message with a recovery step', () => {
    const messages = Object.values(SIGNING_ERROR_MESSAGES);
    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) {
      expect(message).toMatch(/retry|try again|reconnect/i);
    }
  });
});

describe('secret material handling', () => {
  it('redacts secret seeds and XDR envelopes from text', () => {
    expect(redactSecretMaterial(`key ${FAKE_SECRET} env ${FAKE_XDR}`)).toBe(
      'key [REDACTED_SECRET] env [REDACTED_XDR]',
    );
  });

  it('keeps public keys and transaction hashes', () => {
    const text = `G${'A'.repeat(55)} ${'f'.repeat(64)}`;
    expect(redactSecretMaterial(text)).toBe(text);
  });

  it('never puts raw error text in the user-facing message', () => {
    const raw = new Error(`signing failed for ${FAKE_SECRET} with envelope ${FAKE_XDR}`);

    const error = toSigningError(raw);

    expect(error.message).toBe(SIGNING_ERROR_MESSAGES.UNKNOWN);
    expect(error.message).not.toContain(FAKE_SECRET);
    expect(error.detail).toContain('[REDACTED_SECRET]');
    expect(error.detail).toContain('[REDACTED_XDR]');
    expect(error.detail).not.toContain(FAKE_SECRET);
    expect(error.detail).not.toContain(FAKE_XDR);
  });

  it('caps diagnostic detail length and drops line breaks from stacks', () => {
    const detail = describeErrorForLog(new Error(`line1\nline2 ${'x'.repeat(1000)}`));

    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(301);
  });

  it('keeps authored messages and sets the class from the code', () => {
    const error = createSigningError('INVALID_AMOUNT', { message: 'Amount must be positive.' });

    expect(error).toMatchObject({
      code: 'INVALID_AMOUNT',
      signingErrorClass: 'MALFORMED_TRANSACTION',
      message: 'Amount must be positive.',
    });
  });
});

describe('safeErrorMessage', () => {
  it('passes authored app messages through unchanged', () => {
    expect(safeErrorMessage(new Error('Amount must be greater than zero.'))).toBe(
      'Amount must be greater than zero.',
    );
    expect(safeErrorMessage('Campaign not found.')).toBe('Campaign not found.');
  });

  it('strips secret seeds and XDR from messages before they reach the UI', () => {
    const message = safeErrorMessage(new Error(`signing failed ${FAKE_SECRET} ${FAKE_XDR}`));

    expect(message).toBe('signing failed [REDACTED_SECRET] [REDACTED_XDR]');
  });

  it('falls back when there is no usable message', () => {
    expect(safeErrorMessage(undefined, 'Something went wrong.')).toBe('Something went wrong.');
    expect(safeErrorMessage({}, 'Something went wrong.')).toBe('Something went wrong.');
  });
});

describe('Freighter service errors', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('classifies a wallet rejection without leaking the raw wallet text', async () => {
    freighterMocks.isConnected.mockResolvedValue(true);
    freighterMocks.requestAccess.mockRejectedValue(
      new Error(`User declined access (debug: ${FAKE_SECRET})`),
    );

    const error = await connectFreighterWallet(TESTNET).catch((e) => e);

    expect(error).toMatchObject({
      code: 'FREIGHTER_ACCESS_DENIED',
      signingErrorClass: 'USER_REJECTED',
      message: SIGNING_ERROR_MESSAGES.USER_REJECTED,
    });
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(
      FAKE_SECRET,
    );
  });

  it('reports a throwing extension probe as WALLET_UNAVAILABLE, not a rejection', async () => {
    freighterMocks.isConnected.mockRejectedValue(new Error(`probe crashed ${FAKE_SECRET}`));

    const error = await connectFreighterWallet(TESTNET).catch((e) => e);

    expect(error).toMatchObject({
      code: 'FREIGHTER_UNAVAILABLE',
      signingErrorClass: 'WALLET_UNAVAILABLE',
      message: SIGNING_ERROR_MESSAGES.WALLET_UNAVAILABLE,
    });
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(
      FAKE_SECRET,
    );
  });

  it('logs network-check failures in redacted form only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    freighterMocks.getNetworkDetails.mockRejectedValue(new Error(`boom ${FAKE_SECRET}`));

    await verifyFreighterNetwork(TESTNET);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(warn.mock.calls)).toContain('[REDACTED_SECRET]');
  });
});
