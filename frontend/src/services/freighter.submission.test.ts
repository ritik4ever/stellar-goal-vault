// @vitest-environment node
// stellar-sdk XDR encoding fails under jsdom (cross-realm Uint8Array).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, Keypair, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { classifyTransactionError } from '../lib/transactionStatus';

const TESTNET = 'Test SDF Network ; September 2015';

const server = vi.hoisted(() => ({
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
}));

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return { ...actual, rpc: { ...actual.rpc, Server: vi.fn(() => server) } };
});

import { resumeSubmittedTransaction, sendAndConfirmTransaction } from './freighter';

const keypair = Keypair.random();

function hashHex(transaction: Transaction): string {
  return Array.from(transaction.hash(), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function signedTransaction(timebounds?: { minTime: number; maxTime: number }): Transaction {
  const builder = new TransactionBuilder(new Account(keypair.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: TESTNET,
    ...(timebounds ? { timebounds } : {}),
  }).addOperation(Operation.bumpSequence({ bumpTo: '10' }));
  if (!timebounds) {
    builder.setTimeout(60);
  }
  const transaction = builder.build();
  transaction.sign(keypair);
  return transaction;
}

const SUCCESS = { status: 'SUCCESS', createdAt: 1700000000, ledger: 42, latestLedger: 43 };
const NOT_FOUND = { status: 'NOT_FOUND' };

function rejected(resultCode: string) {
  return {
    status: 'ERROR',
    hash: 'h',
    errorResult: { result: () => ({ switch: () => ({ name: resultCode }) }) },
  };
}

describe('deterministic transaction submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.sendTransaction.mockReset();
    server.getTransaction.mockReset();
    // Run backoff/poll sleeps immediately.
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
    });
  });

  it('confirms a pending transaction once the ledger reports success', async () => {
    const tx = signedTransaction();
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h' });
    server.getTransaction.mockResolvedValueOnce(NOT_FOUND).mockResolvedValueOnce(SUCCESS);

    await expect(sendAndConfirmTransaction(server as never, tx)).resolves.toEqual({
      transactionHash: hashHex(tx),
      confirmedAt: 1700000000,
      ledger: 42,
      latestLedger: 43,
    });
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('treats DUPLICATE as already submitted and polls for the result', async () => {
    const tx = signedTransaction();
    server.sendTransaction.mockResolvedValue({ status: 'DUPLICATE', hash: 'h' });
    server.getTransaction.mockResolvedValue(SUCCESS);

    await expect(sendAndConfirmTransaction(server as never, tx)).resolves.toMatchObject({
      transactionHash: hashHex(tx),
    });
  });

  it('resends the same envelope on TRY_AGAIN_LATER', async () => {
    const tx = signedTransaction();
    server.sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'h' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'h' });
    server.getTransaction.mockResolvedValue(SUCCESS);

    await sendAndConfirmTransaction(server as never, tx);

    expect(server.sendTransaction).toHaveBeenCalledTimes(2);
    expect(server.sendTransaction.mock.calls[0][0]).toBe(tx);
    expect(server.sendTransaction.mock.calls[1][0]).toBe(tx);
  });

  it('becomes retryable with the same envelope when the RPC stays busy', async () => {
    const tx = signedTransaction();
    server.sendTransaction.mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'h' });

    const error = await sendAndConfirmTransaction(server as never, tx).catch((e) => e);

    expect(error).toMatchObject({ code: 'SUBMISSION_RETRY', submittedTransaction: tx.toXDR() });
    expect(classifyTransactionError(error)).toBe('retryable');
    expect(server.sendTransaction).toHaveBeenCalledTimes(3);
  });

  it('does not resend after a transport error if the transaction already landed', async () => {
    const tx = signedTransaction();
    server.sendTransaction.mockRejectedValueOnce(new Error('socket hang up'));
    server.getTransaction.mockResolvedValue(SUCCESS);

    await expect(sendAndConfirmTransaction(server as never, tx)).resolves.toMatchObject({
      confirmedAt: 1700000000,
    });
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('polls instead of failing when a resend is rejected because the first attempt landed', async () => {
    const tx = signedTransaction();
    server.sendTransaction
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER', hash: 'h' })
      .mockResolvedValueOnce(rejected('txBadSeq'));
    server.getTransaction.mockResolvedValue(SUCCESS);

    await expect(sendAndConfirmTransaction(server as never, tx)).resolves.toMatchObject({
      ledger: 42,
    });
  });

  it.each([
    ['txBadSeq', 'failed'],
    ['txInsufficientBalance', 'failed'],
    ['txInsufficientFee', 'retryable'],
  ])('maps a %s rejection to %s', async (resultCode, expected) => {
    const tx = signedTransaction();
    server.sendTransaction.mockResolvedValue(rejected(resultCode));

    const error = await sendAndConfirmTransaction(server as never, tx).catch((e) => e);

    expect(error).toMatchObject({ code: 'TRANSACTION_REJECTED', resultCode });
    expect(error.submittedTransaction).toBeUndefined();
    expect(classifyTransactionError(error)).toBe(expected);
  });

  it('maps an on-ledger failure to failed', async () => {
    const tx = signedTransaction();
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h' });
    server.getTransaction.mockResolvedValue({ status: 'FAILED' });

    const error = await sendAndConfirmTransaction(server as never, tx).catch((e) => e);

    expect(error).toMatchObject({ code: 'TRANSACTION_FAILED' });
    expect(classifyTransactionError(error)).toBe('failed');
  });

  it('becomes retryable with the same envelope when confirmation times out', async () => {
    const tx = signedTransaction();
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h' });
    server.getTransaction.mockResolvedValue(NOT_FOUND);

    const error = await sendAndConfirmTransaction(server as never, tx).catch((e) => e);

    expect(error).toMatchObject({
      code: 'TRANSACTION_TIMEOUT',
      transactionHash: hashHex(tx),
      submittedTransaction: tx.toXDR(),
    });
    expect(classifyTransactionError(error)).toBe('retryable');
  });

  describe('resumeSubmittedTransaction', () => {
    it('confirms without resubmitting when the transaction already landed', async () => {
      const tx = signedTransaction();
      server.getTransaction.mockResolvedValue(SUCCESS);

      await expect(
        resumeSubmittedTransaction('https://rpc.test', TESTNET, tx.toXDR()),
      ).resolves.toMatchObject({ transactionHash: hashHex(tx) });
      expect(server.sendTransaction).not.toHaveBeenCalled();
    });

    it('resends the same envelope while it is still within its time bounds', async () => {
      const tx = signedTransaction();
      server.getTransaction.mockResolvedValueOnce(NOT_FOUND).mockResolvedValue(SUCCESS);
      server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h' });

      await resumeSubmittedTransaction('https://rpc.test', TESTNET, tx.toXDR());

      expect(server.sendTransaction).toHaveBeenCalledTimes(1);
      expect((server.sendTransaction.mock.calls[0][0] as Transaction).toXDR()).toBe(tx.toXDR());
    });

    it('reports an expired, never-landed transaction so a fresh one is safe', async () => {
      const past = Math.floor(Date.now() / 1000) - 600;
      const tx = signedTransaction({ minTime: 0, maxTime: past });
      server.getTransaction.mockResolvedValue(NOT_FOUND);

      const error = await resumeSubmittedTransaction('https://rpc.test', TESTNET, tx.toXDR()).catch(
        (e) => e,
      );

      expect(error).toMatchObject({ code: 'TRANSACTION_EXPIRED' });
      expect(error.submittedTransaction).toBeUndefined();
      expect(classifyTransactionError(error)).toBe('retryable');
      expect(server.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
