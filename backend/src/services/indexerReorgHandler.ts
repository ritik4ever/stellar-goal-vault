import { getDb } from './db';
import { logInfo, logWarn, logError } from '../logger';
import { config } from '../config';

export interface TentativeEvent {
  txHash: string;
  ledger: number;
  campaignId: string;
  eventType: string;
  status: 'pending' | 'committed' | 'rejected';
}

export function redactReference(ref: string): string {
  if (!ref) return 'unknown';
  if (ref.length <= 8) return '***';
  return `${ref.slice(0, 4)}...${ref.slice(-4)}`;
}

/**
 * Handles blockchain reorganization and unconfirmed block boundaries.
 * Ensures local database state reflects only confirmed chain outcomes.
 */
export class IndexerReorgHandler {
  private minConfirmations: number;

  constructor(minConfirmations: number = 1) {
    this.minConfirmations = minConfirmations;
  }

  /**
   * Evaluates an observed event at the storage boundary.
   * If ledger difference meets confirmation depth, it is committed; otherwise kept pending.
   */
  evaluateEvent(currentLedger: number, event: { txHash: string; ledger: number; campaignId: string; eventType: string }): 'pending' | 'committed' {
    const confirmations = currentLedger - event.ledger;
    const campaignRef = redactReference(event.campaignId);

    if (confirmations >= this.minConfirmations) {
      logInfo(
        'indexer_reorg_committed',
        {
          outcome: 'committed',
          txHash: event.txHash,
          ledger: event.ledger,
          campaignRef,
          confirmations,
        },
        config.logLevel,
      );
      return 'committed';
    } else {
      logInfo(
        'indexer_reorg_pending',
        {
          outcome: 'pending',
          txHash: event.txHash,
          ledger: event.ledger,
          campaignRef,
          confirmations,
        },
        config.logLevel,
      );
      return 'pending';
    }
  }

  /**
   * Resolves a reorg when RPC disagrees with a tentative event.
   * Reverts unconfirmed state without affecting committed history.
   */
  handleReorgDisagreement(txHash: string, campaignId: string, reason: string): 'rejected' {
    const db = getDb();
    const campaignRef = redactReference(campaignId);

    try {
      db.prepare(`
        DELETE FROM campaign_events
        WHERE json_extract(blockchain_metadata, '$.txHash') = ?
          AND json_extract(blockchain_metadata, '$.confirmed') = 0
      `).run(txHash);

      logWarn(
        'indexer_reorg_purged',
        {
          outcome: 'rejected',
          txHash,
          campaignRef,
          reason,
          message: `Purged tentative reorged event for campaign ${campaignRef}`,
        },
        config.logLevel,
      );
    } catch (err) {
      logError(err, { event: 'indexer_reorg_purge_error', txHash }, config.logLevel);
    }

    return 'rejected';
  }
}
