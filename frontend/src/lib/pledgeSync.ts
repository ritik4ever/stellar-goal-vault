import type { ReconcilePledgePayload } from '../types/campaign';
import { PledgeFlowError } from './pledgeErrors';

export type ReconcilePledge = (campaignId: string, payload: ReconcilePledgePayload) => Promise<unknown>;

/** Pledges confirmed on-chain whose backend sync failed, keyed by campaign ID. */
export type UnsyncedPledges = Map<string, ReconcilePledgePayload>;

function readMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error;
  return 'Pledge sync failed.';
}

/**
 * Reconcile a pledge that is already confirmed on-chain.
 *
 * On failure the payload is remembered and a `PLEDGE_SYNC_FAILED` error
 * carrying the transaction hash is thrown, so the UI offers "Retry sync"
 * instead of a second pledge. On success any remembered payload is cleared.
 */
export async function syncConfirmedPledge(
  campaignId: string,
  payload: ReconcilePledgePayload,
  reconcile: ReconcilePledge,
  unsynced: UnsyncedPledges,
): Promise<void> {
  try {
    await reconcile(campaignId, payload);
  } catch (error) {
    unsynced.set(campaignId, payload);
    throw new PledgeFlowError('PLEDGE_SYNC_FAILED', readMessage(error), {
      transactionHash: payload.transactionHash,
      cause: error,
    });
  }
  unsynced.delete(campaignId);
}

/**
 * Retry the remembered sync for a campaign with the original payload (same
 * transaction hash, which the backend deduplicates). Returns the payload that
 * was synced, or null when nothing was pending.
 */
export async function retryUnsyncedPledge(
  campaignId: string,
  reconcile: ReconcilePledge,
  unsynced: UnsyncedPledges,
): Promise<ReconcilePledgePayload | null> {
  const payload = unsynced.get(campaignId);
  if (!payload) return null;
  await syncConfirmedPledge(campaignId, payload, reconcile, unsynced);
  return payload;
}
