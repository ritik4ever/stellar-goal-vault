import { getDb } from './db';
import { recordEvent, BlockchainMetadata, CampaignEventType } from './eventHistory';
import { logInfo, logError } from '../logger';
import { config } from '../config';

export interface BackfillRange {
  startLedger: number;
  endLedger: number;
}

export interface BackfillOutcome {
  status: 'pending' | 'committed' | 'rejected';
  eventsProcessed: number;
  startLedger: number;
  endLedger: number;
  reason?: string;
}

export function redactReference(ref: string): string {
  if (!ref) return 'unknown';
  if (ref.length <= 8) return '***';
  return `${ref.slice(0, 4)}...${ref.slice(-4)}`;
}

export interface RawRpcEvent {
  contract_id?: string;
  txHash?: string;
  ledger?: number;
  ledgerCloseTime?: number;
  event_index?: number;
  topic?: unknown[];
  value?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Runs an isolated, idempotent backfill for historical Soroban events across a ledger range.
 * Preserves complete campaign history without duplicating events, and is safe to replay
 * even when the ledger range overlaps with active live polling.
 */
export async function runIndexerBackfill(
  range: BackfillRange,
  fetchEventsFn: (start: number, end: number) => Promise<RawRpcEvent[]>,
): Promise<BackfillOutcome> {
  const { startLedger, endLedger } = range;
  const db = getDb();

  logInfo(
    'indexer_backfill_pending',
    {
      outcome: 'pending',
      startLedger,
      endLedger,
      message: `Starting indexer backfill for ledger range [${startLedger}, ${endLedger}]`,
    },
    config.logLevel,
  );

  if (startLedger > endLedger) {
    const reason = 'Invalid ledger range: startLedger exceeds endLedger';
    logError(
      new Error(reason),
      {
        outcome: 'rejected',
        event: 'indexer_backfill_rejected',
        startLedger,
        endLedger,
      },
      config.logLevel,
    );
    return {
      status: 'rejected',
      eventsProcessed: 0,
      startLedger,
      endLedger,
      reason,
    };
  }

  try {
    const rawEvents = await fetchEventsFn(startLedger, endLedger);

    // Sort to handle out-of-order RPC responses
    const sorted = [...rawEvents].sort((a, b) => {
      const lA = Number(a.ledger ?? 0);
      const lB = Number(b.ledger ?? 0);
      if (lA !== lB) return lA - lB;
      return Number(a.event_index ?? 0) - Number(b.event_index ?? 0);
    });

    let processedCount = 0;

    for (const ev of sorted) {
      if (!ev.txHash || ev.ledger == null) continue;

      // Deduplication check: check if already exists by txHash
      const existing = db
        .prepare(
          `SELECT 1 FROM campaign_events
           WHERE json_extract(blockchain_metadata, '$.txHash') = ? LIMIT 1`,
        )
        .get(ev.txHash);

      if (existing) {
        continue;
      }

      const campaignId = String(ev.value?.campaign_id ?? (Array.isArray(ev.topic) ? ev.topic[1] : '') ?? 'unknown');
      const eventType = (ev.value?.event_type ?? 'pledged') as CampaignEventType;
      const actor = ev.value?.contributor ? String(ev.value.contributor) : undefined;
      const amount = ev.value?.amount != null ? Number(ev.value.amount) : undefined;

      const blockchainMetadata: BlockchainMetadata = {
        txHash: ev.txHash,
        ledgerNumber: ev.ledger,
        ledgerCloseTime: ev.ledgerCloseTime ?? Math.floor(Date.now() / 1000),
        eventIndex: ev.event_index ?? 0,
        contractId: ev.contract_id ?? '',
        source: 'soroban_backfill',
      };

      recordEvent(
        campaignId,
        eventType,
        blockchainMetadata.ledgerCloseTime ?? Math.floor(Date.now() / 1000),
        actor,
        amount,
        ev.value ?? {},
        blockchainMetadata,
      );

      processedCount++;
    }

    logInfo(
      'indexer_backfill_committed',
      {
        outcome: 'committed',
        eventsIngested: processedCount,
        startLedger,
        endLedger,
        message: `Successfully backfilled ${processedCount} events`,
      },
      config.logLevel,
    );

    return {
      status: 'committed',
      eventsProcessed: processedCount,
      startLedger,
      endLedger,
    };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(
      err,
      {
        outcome: 'rejected',
        event: 'indexer_backfill_rejected',
        startLedger,
        endLedger,
        reason,
      },
      config.logLevel,
    );
    return {
      status: 'rejected',
      eventsProcessed: 0,
      startLedger,
      endLedger,
      reason,
    };
  }
}
