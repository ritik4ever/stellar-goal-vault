import { describe, expect, it, vi } from 'vitest';
import type { ReconcilePledgePayload } from '../types/campaign';
import { PledgeFlowError } from './pledgeErrors';
import { retryUnsyncedPledge, syncConfirmedPledge, type UnsyncedPledges } from './pledgeSync';

const payload: ReconcilePledgePayload = {
  contributor: `G${'B'.repeat(55)}`,
  amount: 42.5,
  assetCode: 'XLM',
  transactionHash: 'f'.repeat(64),
  confirmedAt: 1_700_000_000,
};

describe('syncConfirmedPledge', () => {
  it('reconciles and leaves nothing pending on success', async () => {
    const reconcile = vi.fn().mockResolvedValue({});
    const unsynced: UnsyncedPledges = new Map([['c1', payload]]);

    await syncConfirmedPledge('c1', payload, reconcile, unsynced);

    expect(reconcile).toHaveBeenCalledWith('c1', payload);
    expect(unsynced.has('c1')).toBe(false);
  });

  it('remembers the payload and throws PLEDGE_SYNC_FAILED with the transaction hash', async () => {
    const reconcile = vi.fn().mockRejectedValue(new Error('Network Error'));
    const unsynced: UnsyncedPledges = new Map();

    const error = await syncConfirmedPledge('c1', payload, reconcile, unsynced).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PledgeFlowError);
    expect(error).toMatchObject({ code: 'PLEDGE_SYNC_FAILED', transactionHash: payload.transactionHash });
    expect(unsynced.get('c1')).toBe(payload);
  });
});

describe('retryUnsyncedPledge', () => {
  it('re-sends the original payload (same transaction hash), never a new pledge', async () => {
    const reconcile = vi.fn().mockResolvedValue({});
    const unsynced: UnsyncedPledges = new Map([['c1', payload]]);

    await expect(retryUnsyncedPledge('c1', reconcile, unsynced)).resolves.toBe(payload);

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith('c1', payload);
    expect(unsynced.size).toBe(0);
  });

  it('keeps the payload for another retry when the sync fails again', async () => {
    const reconcile = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({});
    const unsynced: UnsyncedPledges = new Map([['c1', payload]]);

    await expect(retryUnsyncedPledge('c1', reconcile, unsynced)).rejects.toMatchObject({
      code: 'PLEDGE_SYNC_FAILED',
    });
    expect(unsynced.get('c1')).toBe(payload);

    await expect(retryUnsyncedPledge('c1', reconcile, unsynced)).resolves.toBe(payload);
    expect(reconcile).toHaveBeenNthCalledWith(2, 'c1', payload);
  });

  it('returns null without calling the backend when nothing is pending', async () => {
    const reconcile = vi.fn();
    await expect(retryUnsyncedPledge('c1', reconcile, new Map())).resolves.toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('only retries the requested campaign', async () => {
    const reconcile = vi.fn().mockResolvedValue({});
    const other = { ...payload, transactionHash: 'e'.repeat(64) };
    const unsynced: UnsyncedPledges = new Map([
      ['c1', payload],
      ['c2', other],
    ]);

    await retryUnsyncedPledge('c1', reconcile, unsynced);

    expect(reconcile).toHaveBeenCalledWith('c1', payload);
    expect(unsynced.get('c2')).toBe(other);
  });
});
