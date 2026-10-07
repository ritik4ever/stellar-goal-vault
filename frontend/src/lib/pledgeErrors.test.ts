import { describe, expect, it } from 'vitest';
import { PLEDGE_FALLBACK_MESSAGE, PledgeFlowError, classifyPledgeError } from './pledgeErrors';

function coded(code: string, message = 'raw provider details') {
  return Object.assign(new Error(message), { code });
}

describe('classifyPledgeError', () => {
  it.each([
    'SIMULATION_FAILED',
    'SIMULATION_PREPARE_FAILED',
    'SOURCE_ACCOUNT_LOAD_FAILED',
    'STATE_RESTORE_REQUIRED',
  ])('turns fee-estimation failure %s into a retryable, non-technical message', (code) => {
    const failure = classifyPledgeError(coded(code));
    expect(failure).toMatchObject({ code, recovery: 'retry' });
    expect(failure.message).toBe('Could not estimate fee. Check your connection and retry.');
    expect(failure.message).not.toContain('raw provider details');
  });

  it('offers only a sync retry for a pledge confirmed on-chain but not reconciled', () => {
    const hash = 'a'.repeat(64);
    const failure = classifyPledgeError(
      new PledgeFlowError('PLEDGE_SYNC_FAILED', 'Network Error', { transactionHash: hash }),
    );
    expect(failure.recovery).toBe('retry-sync');
    expect(failure.transactionHash).toBe(hash);
    expect(failure.message).toContain('confirmed on-chain');
    expect(failure.message).toContain(`${hash.slice(0, 12)}…`);
    expect(failure.message).toContain('will not be charged again');
  });

  it('describes a sync failure without a hash', () => {
    const failure = classifyPledgeError(coded('PLEDGE_SYNC_FAILED'));
    expect(failure.recovery).toBe('retry-sync');
    expect(failure.transactionHash).toBeUndefined();
  });

  it('treats a cancelled preview as recoverable and says the input is kept', () => {
    const failure = classifyPledgeError(coded('USER_CANCELLED'));
    expect(failure.recovery).toBe('retry');
    expect(failure.message).toMatch(/cancelled.*kept/i);
  });

  it.each(['WALLET_NOT_CONNECTED', 'FREIGHTER_UNAVAILABLE', 'FREIGHTER_ACCESS_DENIED'])(
    '%s asks the user to connect the wallet',
    (code) => {
      expect(classifyPledgeError(coded(code, 'Freighter was not detected.')).recovery).toBe('connect-wallet');
    },
  );

  it('warns about double pledging after a confirmation timeout', () => {
    const failure = classifyPledgeError(coded('TRANSACTION_TIMEOUT'));
    expect(failure.recovery).toBe('retry');
    expect(failure.message).toMatch(/check your wallet activity before retrying/i);
  });

  it.each(['INVALID_AMOUNT', 'INVALID_AMOUNT_PRECISION'])('%s points the user at the amount', (code) => {
    const failure = classifyPledgeError(coded(code, 'Amount must use no more than 2 decimal places.'));
    expect(failure).toMatchObject({ recovery: 'fix-input', message: 'Amount must use no more than 2 decimal places.' });
  });

  it.each(['CONFIG_MISSING', 'INVALID_DECIMALS'])('%s offers no retry', (code) => {
    expect(classifyPledgeError(coded(code)).recovery).toBe('none');
  });

  it('keeps an unknown error message and stays retryable', () => {
    expect(classifyPledgeError(new Error('Wallet rejected the request'))).toEqual({
      code: 'UNKNOWN',
      recovery: 'retry',
      message: 'Wallet rejected the request',
    });
  });

  it.each([undefined, null, new Error('   '), '', 42])('falls back to a useful message for %p', (error) => {
    expect(classifyPledgeError(error)).toMatchObject({ recovery: 'retry', message: PLEDGE_FALLBACK_MESSAGE });
  });
});
