import { describe, expect, it, vi } from 'vitest';
import { submitTransactionOnce } from './transactionSubmission';
import type { TransactionStatusUpdate } from './transactionSubmission';

describe('submitTransactionOnce', () => {
  it('shares one in-flight submission and reports pending then confirmed', async () => {
    let resolveSubmission!: (result: { transactionHash: string }) => void;
    const submit = vi.fn(
      () =>
        new Promise<{ transactionHash: string }>((resolve) => {
          resolveSubmission = resolve;
        }),
    );
    const firstUpdates: TransactionStatusUpdate[] = [];
    const secondUpdates: TransactionStatusUpdate[] = [];

    const first = submitTransactionOnce('pledge:campaign:wallet', submit, (update) => {
      firstUpdates.push(update);
    });
    const second = submitTransactionOnce('pledge:campaign:wallet', submit, (update) => {
      secondUpdates.push(update);
    });

    expect(second).toBe(first);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(firstUpdates.map(({ status }) => status)).toEqual(['pending']);
    expect(secondUpdates.map(({ status }) => status)).toEqual(['pending']);

    resolveSubmission({ transactionHash: 'confirmed-hash' });
    await expect(first).resolves.toEqual({ transactionHash: 'confirmed-hash' });
    expect(firstUpdates[firstUpdates.length - 1]).toEqual({
      status: 'confirmed',
      transactionHash: 'confirmed-hash',
    });
    expect(secondUpdates[secondUpdates.length - 1]).toEqual(
      firstUpdates[firstUpdates.length - 1],
    );
  });

  it('marks network failures retryable and permits a later retry', async () => {
    const listener = vi.fn();
    const submit = vi
      .fn<[], Promise<void>>()
      .mockRejectedValueOnce(
        Object.assign(new Error('network down'), { code: 'SUBMISSION_FAILED' }),
      )
      .mockResolvedValueOnce(undefined);

    await expect(submitTransactionOnce('claim:campaign', submit, listener)).rejects.toMatchObject({
      code: 'SUBMISSION_FAILED',
    });
    expect(listener).toHaveBeenLastCalledWith({
      status: 'retryable',
      errorCode: 'SUBMISSION_FAILED',
    });

    await expect(submitTransactionOnce('claim:campaign', submit)).resolves.toBeUndefined();
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('marks a rejected contract transaction failed', async () => {
    const listener = vi.fn();
    const error = Object.assign(new Error('rejected'), {
      code: 'TRANSACTION_FAILED',
      signingErrorClass: 'CONTRACT_REJECTED',
    });

    await expect(
      submitTransactionOnce('pledge:failed-campaign', () => Promise.reject(error), listener),
    ).rejects.toBe(error);
    expect(listener).toHaveBeenLastCalledWith({
      status: 'failed',
      errorCode: 'TRANSACTION_FAILED',
    });
  });
});
