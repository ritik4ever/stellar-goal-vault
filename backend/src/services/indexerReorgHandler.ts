import { logInfo } from '../logger';
import { config } from '../config';

export interface TentativeEvent {
  txHash: string;
  ledger: number;
  campaignId: string;
  eventType: string;
}

export function redactReference(ref: string): string {
  if (!ref) return 'unknown';
  if (ref.length <= 8) return '***';
  return `${ref.slice(0, 4)}...${ref.slice(-4)}`;
}

/** Confirmations accrued by an event once the chain head is at `latestLedger`. */
export function confirmationsFor(latestLedger: number, eventLedger: number): number {
  return latestLedger - eventLedger;
}

/**
 * An event is safe to persist only once the ledger that contains it is buried
 * under `minConfirmations` later ledgers. Until then a reorganization can still
 * replace it with a different event at the same position.
 */
export function isConfirmed(
  latestLedger: number,
  eventLedger: number,
  minConfirmations: number,
): boolean {
  return confirmationsFor(latestLedger, eventLedger) >= minConfirmations;
}

/**
 * Handles blockchain reorganization and unconfirmed block boundaries.
 * Ensures local database state reflects only confirmed chain outcomes.
 *
 * The indexer does not persist tentative events at all: an event that has not
 * reached the confirmation depth is excluded from the batch and the cursor is
 * left before it, so the next poll re-reads that ledger. A reorg can only
 * change what the next poll sees; there is never a tentative local row that
 * has to be purged or rolled back.
 */
export class IndexerReorgHandler {
  private minConfirmations: number;

  constructor(minConfirmations: number = 1) {
    const parsed = Math.floor(Number(minConfirmations));
    this.minConfirmations = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  }

  /**
   * Evaluates an observed event at the storage boundary.
   * If ledger difference meets confirmation depth, it is committed; otherwise kept pending.
   */
  evaluateEvent(
    latestLedger: number,
    event: TentativeEvent,
  ): 'pending' | 'committed' {
    const confirmations = confirmationsFor(latestLedger, event.ledger);
    const outcome = isConfirmed(latestLedger, event.ledger, this.minConfirmations)
      ? 'committed'
      : 'pending';

    logInfo(
      `indexer_reorg_${outcome}`,
      {
        outcome,
        txHash: event.txHash,
        ledger: event.ledger,
        campaignRef: redactReference(event.campaignId),
        confirmations,
      },
      config.logLevel,
    );
    return outcome;
  }
}
