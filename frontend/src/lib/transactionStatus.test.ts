import { describe, expect, it, vi } from 'vitest';
import { classifyTransactionError, createTransactionTracker } from './transactionStatus';

function codedError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CONFIRMED = { transactionHash: 'a'.repeat(64), confirmedAt: 1700000000 };

describe('classifyTransactionError', () => {
  it.each([
    ['SUBMISSION_RETRY', 'retryable'],
    ['TRANSACTION_TIMEOUT', 'retryable'],
    ['TRANSACTION_EXPIRED', 'retryable'],
    ['SOURCE_ACCOUNT_LOAD_FAILED', 'retryable'],
    ['RPC_UNAVAILABLE', 'retryable'],
    ['TRANSACTION_FAILED', 'failed'],
    ['SIMULATION_FAILED', 'failed'],
    ['SIGNING_FAILED', 'failed'],
    ['CONFIG_MISSING', 'failed'],
  ])('maps %s to %s', (code, expected) => {
    expect(classifyTransactionError(codedError(code))).toBe(expected);
  });

  it.each([
    ['txInsufficientFee', 'retryable'],
    ['txTooLate', 'retryable'],
    ['txBadSeq', 'failed'],
    ['txInsufficientBalance', 'failed'],
    ['txFailed', 'failed'],
    [undefined, 'failed'],
  ])('maps a rejected submission with %s to %s', (resultCode, expected) => {
    expect(classifyTransactionError(codedError('TRANSACTION_REJECTED', { resultCode }))).toBe(
      expected,
    );
  });

  it('treats unknown errors as failed', () => {
    expect(classifyTransactionError(new Error('boom'))).toBe('failed');
    expect(classifyTransactionError(undefined)).toBe('failed');
  });
});

describe('createTransactionTracker', () => {
  it('ignores repeated triggers while the same action is pending', async () => {
    const tracker = createTransactionTracker<typeof CONFIRMED>();
    const pending = deferred<typeof CONFIRMED>();
    const submit = vi.fn(() => pending.promise);
    const resume = vi.fn();
    const record = vi.fn(async () => {});

    const first = tracker.run('pledge:1', { submit, resume, record });
    expect(tracker.getState('pledge:1').status).toBe('pending');

    await expect(tracker.run('pledge:1', { submit, resume, record })).resolves.toEqual({
      skipped: true,
    });
    expect(tracker.isPending('pledge:1')).toBe(true);

    pending.resolve(CONFIRMED);
    await expect(first).resolves.toEqual({ skipped: false, result: CONFIRMED });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(CONFIRMED);
    expect(tracker.getState('pledge:1').status).toBe('idle');
  });

  it('does not block a different logical action', async () => {
    const tracker = createTransactionTracker<typeof CONFIRMED>();
    const pending = deferred<typeof CONFIRMED>();
    const submit = vi.fn(() => pending.promise);

    void tracker.run('claim:1', { submit, resume: vi.fn() });
    const other = tracker.run('claim:2', { submit: async () => CONFIRMED, resume: vi.fn() });

    await expect(other).resolves.toEqual({ skipped: false, result: CONFIRMED });
    pending.resolve(CONFIRMED);
  });

  it('marks permanent errors as failed and submits fresh on the next attempt', async () => {
    const tracker = createTransactionTracker<typeof CONFIRMED>();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(codedError('TRANSACTION_REJECTED', { resultCode: 'txBadSeq' }))
      .mockResolvedValueOnce(CONFIRMED);
    const resume = vi.fn();

    await expect(tracker.run('pledge:1', { submit, resume })).rejects.toMatchObject({
      code: 'TRANSACTION_REJECTED',
    });
    expect(tracker.getState('pledge:1')).toMatchObject({ status: 'failed' });

    await tracker.run('pledge:1', { submit, resume });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
  });

  it('resumes a submitted transaction on retry instead of building a new one', async () => {
    const tracker = createTransactionTracker<typeof CONFIRMED>();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        codedError('TRANSACTION_TIMEOUT', { submittedTransaction: 'signed-envelope' }),
      );
    const resume = vi.fn().mockResolvedValueOnce(CONFIRMED);
    const record = vi.fn(async () => {});

    await expect(tracker.run('claim:1', { submit, resume, record })).rejects.toBeTruthy();
    expect(tracker.getState('claim:1')).toMatchObject({
      status: 'retryable',
      submittedTransaction: 'signed-envelope',
    });

    await expect(tracker.run('claim:1', { submit, resume, record })).resolves.toEqual({
      skipped: false,
      result: CONFIRMED,
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith('signed-envelope');
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('submits fresh after a resumed transaction is reported expired', async () => {
    const tracker = createTransactionTracker<typeof CONFIRMED>();
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        codedError('TRANSACTION_TIMEOUT', { submittedTransaction: 'signed-envelope' }),
      )
      .mockResolvedValueOnce(CONFIRMED);
    const resume = vi.fn().mockRejectedValueOnce(codedError('TRANSACTION_EXPIRED'));

    await expect(tracker.run('refund:1', { submit, resume })).rejects.toBeTruthy();
    await expect(tracker.run('refund:1', { submit, resume })).rejects.toMatchObject({
      code: 'TRANSACTION_EXPIRED',
    });
    expect(tracker.getState('refund:1')).toEqual(
      expect.objectContaining({ status: 'retryable', submittedTransaction: undefined }),
    );

    await tracker.run('refund:1', { submit, resume });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('only re-records a confirmed transaction when backend recording failed', async () => {
    const tracker = createTransactionTracker<typeof CONFIRMED>();
    const submit = vi.fn().mockResolvedValue(CONFIRMED);
    const resume = vi.fn();
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(tracker.run('pledge:1', { submit, resume, record })).rejects.toThrow(
      'backend unavailable',
    );
    expect(tracker.getState('pledge:1')).toMatchObject({ status: 'confirmed', result: CONFIRMED });

    await tracker.run('pledge:1', { submit, resume, record });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith(CONFIRMED);
    expect(tracker.getState('pledge:1').status).toBe('idle');
  });

  it('returns to idle when the user cancels from the preview', async () => {
    const tracker = createTransactionTracker<typeof CONFIRMED>();
    const submit = vi.fn().mockRejectedValueOnce(codedError('USER_CANCELLED'));

    await expect(tracker.run('pledge:1', { submit, resume: vi.fn() })).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });
    expect(tracker.getState('pledge:1').status).toBe('idle');
  });
});
