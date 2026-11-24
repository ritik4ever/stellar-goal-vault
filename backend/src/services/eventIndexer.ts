import axios from 'axios';
import { getDb } from './db';
import { recordEvent, BlockchainMetadata, CampaignEventType } from './eventHistory';
import { reconcileOnChainPledge, getCampaign, updateCampaignMetadata } from './campaignStore';
import {
  IndexerCursor,
  compareCursor,
  getIndexerCursor,
  hasCompoundCursor,
  isAfterCursor,
  writeIndexerCursor,
} from './eventIndexerCursor';
import { redactReference } from './indexerBackfill';
import { isConfirmed } from './indexerReorgHandler';
import dotenv from 'dotenv';
import { config } from '../config';
import { logError, logInfo } from '../logger';

dotenv.config();

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const CONTRACT_ID = process.env.CONTRACT_ID || '';

/**
 * How many ledgers must follow an event's ledger before it is persisted.
 * Events in younger ledgers can still be replaced by a reorganization, so the
 * indexer leaves them pending and re-reads them on a later poll.
 */
export function loadConfirmationDepth(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SOROBAN_INDEXER_CONFIRMATIONS);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
}

const CONFIRMATION_DEPTH = loadConfirmationDepth();

/**
 * Poll interval in milliseconds. Defaults to 15 seconds per the issue spec.
 * Configurable via SOROBAN_POLL_INTERVAL_MS environment variable.
 */
const POLL_INTERVAL_MS = Number(process.env.SOROBAN_POLL_INTERVAL_MS ?? 15_000);

/** Maximum backoff delay in milliseconds (5 minutes). */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Lag above this is treated as stale (default 5 minutes).
 * Configurable via SOROBAN_INDEXER_STALE_LAG_MS.
 */
const STALE_LAG_MS = Number(process.env.SOROBAN_INDEXER_STALE_LAG_MS ?? 5 * 60 * 1000);

/**
 * Lag at or below this (while healthy) is "fresh"; above it but below
 * STALE_LAG_MS is healthy-but-idle. Default: 2× poll interval.
 */
const FRESH_LAG_MS = Number(process.env.SOROBAN_INDEXER_FRESH_LAG_MS ?? POLL_INTERVAL_MS * 2);

// ---------------------------------------------------------------------------
// KV store helpers (persists indexer state across restarts)
// ---------------------------------------------------------------------------

/**
 * Migration 006 creates kv_store for new databases. This stays as a guard for
 * databases opened without running migrations (e.g. a worker pointed at an
 * older file), where the cursor would otherwise silently fail to persist.
 */
function ensureKvStore(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getLastProcessedLedger(): number {
  return getIndexerCursor().ledger;
}

// ---------------------------------------------------------------------------
// Soroban RPC helpers
// ---------------------------------------------------------------------------

export interface SorobanEvent {
  type?: string;
  contract_id?: string;
  txHash?: string;
  ledger?: number;
  ledgerCloseTime?: number;
  event_index?: number;
  topic?: unknown[];
  value?: Record<string, unknown>;
  [key: string]: unknown;
}

async function fetchSorobanEvents(
  startLedger: number,
): Promise<{ events: SorobanEvent[]; latestLedger: number }> {
  if (!CONTRACT_ID) return { events: [], latestLedger: 0 };
  const res = await axios.post(
    SOROBAN_RPC_URL,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params: {
        contractIds: [CONTRACT_ID],
        startLedger,
        filters: [],
        limit: 200,
      },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 },
  );

  // Treat an incomplete response as a failed poll, not as "no events": moving
  // on quietly would skip every event the page was supposed to contain.
  const result = res.data?.result;
  if (result == null || typeof result !== 'object') {
    throw new Error('soroban getEvents: malformed RPC response');
  }
  const latestLedger = Number(result.latestLedger);
  if (!Number.isFinite(latestLedger)) {
    throw new Error('soroban getEvents: response is missing latestLedger');
  }
  lastKnownLedger = latestLedger;

  if (Array.isArray(result.events)) {
    return { events: result.events as SorobanEvent[], latestLedger };
  }
  return { events: [], latestLedger };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * An event is identified by where it sits in the chain, not by its transaction
 * alone: one transaction can emit several contract events, and all of them
 * share a txHash. `eventIndex` is the event's position within its ledger.
 */
function isDuplicateEvent(
  db: ReturnType<typeof getDb>,
  event: SorobanEvent,
  eventIndex: number,
): boolean {
  if (event.txHash) {
    // Indexer rows written before event positions were recorded have a ledger
    // but no eventIndex, so they can only be matched by txHash. Rows with
    // neither are not indexer rows: reconcileOnChainPledge records its own
    // `pledged` row with just a txHash, and that must not hide the other events
    // in the same transaction.
    const row = db
      .prepare(
        `SELECT 1 FROM campaign_events
         WHERE json_extract(blockchain_metadata, '$.txHash') = ?
           AND (json_extract(blockchain_metadata, '$.eventIndex') = ?
                OR (json_extract(blockchain_metadata, '$.eventIndex') IS NULL
                    AND json_extract(blockchain_metadata, '$.ledgerNumber') IS NOT NULL))
         LIMIT 1`,
      )
      .get(event.txHash, eventIndex);
    if (row) return true;
  }

  // Fallback: deduplicate by ledger + event index
  if (event.ledger != null) {
    const row = db
      .prepare(
        `SELECT 1 FROM campaign_events
         WHERE json_extract(blockchain_metadata, '$.ledgerNumber') = ?
           AND json_extract(blockchain_metadata, '$.eventIndex') = ? LIMIT 1`,
      )
      .get(event.ledger, eventIndex);
    if (row) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

/**
 * Maps Soroban topic strings to internal event types.
 * Topics follow the pattern: ['CampaignCreated', campaignId, …]
 */
const TOPIC_TO_EVENT: Record<string, CampaignEventType> = {
  CampaignCreated: 'created',
  CampaignPledged: 'pledged',
  CampaignClaimed: 'claimed',
  CampaignRefunded: 'refunded',
  MetadataUpdated: 'metadata_updated',
  // Alternative spellings from some contract versions
  'Goal:Create': 'created',
  'Goal:Pledge': 'pledged',
  'Goal:Claim': 'claimed',
  'Goal:Refund': 'refunded',
  'Goal:MetaUpd': 'metadata_updated',
};

interface ParsedEvent {
  campaignId: string;
  eventType: CampaignEventType;
  timestamp: number;
  actor?: string;
  amount?: number;
  metadata: Record<string, unknown>;
  blockchainMetadata: BlockchainMetadata;
  ledger: number;
}

function parseSorobanEvent(event: SorobanEvent, eventIndex: number): ParsedEvent | null {
  if (!event?.type || !event?.contract_id) return null;
  if (event.type !== 'contract' || event.contract_id !== CONTRACT_ID) return null;

  // Determine event type from topics
  const topics: string[] = Array.isArray(event.topic) ? event.topic.map((t) => String(t)) : [];

  let eventType: CampaignEventType | undefined;
  for (const topic of topics) {
    const match = TOPIC_TO_EVENT[topic];
    if (match) {
      eventType = match;
      break;
    }
    // Also try partial match
    for (const [key, val] of Object.entries(TOPIC_TO_EVENT)) {
      if (topic.includes(key)) {
        eventType = val;
        break;
      }
    }
    if (eventType) break;
  }
  if (!eventType) return null;

  // Extract fields from event value
  let campaignId = '';
  let actor: string | undefined;
  let amount: number | undefined;
  const metadata: Record<string, unknown> = { ...event };

  try {
    const val = event.value ?? {};
    if (val.campaign_id != null) campaignId = String(val.campaign_id);
    // Also check topic index 1 which often carries campaignId
    if (!campaignId && topics[1]) campaignId = topics[1];
    if (val.creator) actor = String(val.creator);
    if (val.contributor) actor = String(val.contributor);
    if (val.amount != null) amount = Number(val.amount);
    Object.assign(metadata, val);
  } catch {
    // ignore parse errors
  }

  if (!campaignId) return null;

  const blockchainMetadata: BlockchainMetadata = {
    txHash: event.txHash,
    ledgerNumber: event.ledger,
    ledgerCloseTime: event.ledgerCloseTime,
    eventIndex,
    contractId: event.contract_id,
    source: 'soroban',
  };

  const timestamp = event.ledgerCloseTime
    ? Number(event.ledgerCloseTime)
    : Math.floor(Date.now() / 1000);

  return {
    campaignId,
    eventType,
    timestamp,
    actor,
    amount,
    metadata,
    blockchainMetadata,
    ledger: Number(event.ledger ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Record upserts — idempotently create/update campaign/pledge records
// ---------------------------------------------------------------------------

export type EventOutcome = 'pending' | 'committed' | 'rejected';

type HandleResult = { outcome: 'committed' } | { outcome: 'rejected'; reason: string };

/**
 * Applies one parsed event. Returns `committed` once it is recorded, or
 * `rejected` for events that can never apply (unknown campaign, an already
 * reconciled pledge). Rejected events are final, so the cursor may move past
 * them. Storage failures are rethrown instead: the caller rolls the event back
 * and retries it, so a transient error never turns into a silently dropped event.
 */
function handleParsedEvent(parsed: ParsedEvent): HandleResult {
  try {
    if (parsed.eventType === 'metadata_updated') {
      const newMetadata = String(
        (parsed.metadata as { new_metadata?: unknown })?.new_metadata ?? '',
      );
      if (newMetadata && parsed.campaignId) {
        try {
          updateCampaignMetadata(parsed.campaignId, newMetadata);
        } catch (err) {
          logError(
            err,
            { event: 'soroban_metadata_update_error', campaignId: parsed.campaignId },
            config.logLevel,
          );
        }
      }
    }

    if (parsed.eventType === 'pledged' && parsed.actor && parsed.amount != null) {
      // Check if campaign exists before reconciling
      const exists = getCampaign(parsed.campaignId);
      if (!exists) {
        // Campaign not in local DB — skip reconciliation; it will be created when
        // the 'created' event is processed.
        logInfo(
          'soroban_pledge_skipped_no_campaign',
          {
            message: `Skipping pledge for unknown campaign ${parsed.campaignId}`,
            campaignId: parsed.campaignId,
          },
          config.logLevel,
        );
        return { outcome: 'rejected', reason: 'unknown_campaign' };
      }

      if (parsed.blockchainMetadata.txHash) {
        try {
          reconcileOnChainPledge(parsed.campaignId, {
            contributor: parsed.actor!,
            amount: parsed.amount!,
            transactionHash: parsed.blockchainMetadata.txHash,
            confirmedAt: parsed.timestamp,
          });
        } catch (reconcileErr: unknown) {
          // TRANSACTION_HASH_CONFLICT means already reconciled — that's fine
          const errorWithCode = reconcileErr as { code?: string };
          if (errorWithCode?.code === 'TRANSACTION_HASH_CONFLICT') {
            return { outcome: 'rejected', reason: 'already_reconciled' }; // Don't double-record
          }
          // Storage errors (locked database, I/O) are transient: retry the event.
          if (typeof errorWithCode?.code === 'string' && errorWithCode.code.startsWith('SQLITE_')) {
            throw reconcileErr;
          }
          logError(
            reconcileErr,
            { event: 'soroban_reconcile_error', campaignId: parsed.campaignId },
            config.logLevel,
          );
          return { outcome: 'rejected', reason: 'reconcile_failed' };
        }
      }
    }

    // Record to event history (deduplication already checked before we get here)
    recordEvent(
      parsed.campaignId,
      parsed.eventType,
      Math.floor(parsed.timestamp),
      parsed.actor,
      parsed.amount,
      parsed.metadata,
      parsed.blockchainMetadata,
    );

    logInfo(
      'soroban_event_ingested',
      {
        message: `Indexed ${parsed.eventType} event for campaign ${parsed.campaignId}`,
        campaignId: parsed.campaignId,
        eventType: parsed.eventType,
        actor: parsed.actor,
        amount: parsed.amount,
        ledger: parsed.ledger,
      },
      config.logLevel,
    );
    return { outcome: 'committed' };
  } catch (err) {
    logError(
      err,
      {
        event: 'soroban_event_handle_error',
        campaignRef: redactReference(parsed.campaignId),
        eventType: parsed.eventType,
      },
      config.logLevel,
    );
    // Rethrow so the caller's transaction rolls back and the cursor stays put.
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main poll cycle
// ---------------------------------------------------------------------------

export interface BatchResult {
  /** Events recorded in this batch. */
  committed: number;
  /** Events that can never apply and were passed over (see handleParsedEvent). */
  rejected: number;
  /** Events already recorded by an earlier run, e.g. before a restart. */
  recovered: number;
  /** Events at or before the cursor, or not campaign events. Nothing to do. */
  skipped: number;
  /** Events not processed because the batch stopped early; retried next poll. */
  pending: number;
  cursor: IndexerCursor;
}

interface PositionedEvent {
  event: SorobanEvent;
  position: IndexerCursor;
}

/**
 * Places every event in chain order. RPC events that carry no `event_index`
 * get their ordinal within the ledger, which is stable because each poll
 * re-fetches from the start of the cursor's ledger.
 */
function positionEvents(events: SorobanEvent[]): PositionedEvent[] {
  const ordinals = new Map<number, number>();
  const positioned = events.map((event) => {
    const ledger = Number(event.ledger ?? 0);
    const ordinal = ordinals.get(ledger) ?? 0;
    ordinals.set(ledger, ordinal + 1);
    const eventIndex = event.event_index != null ? Number(event.event_index) : ordinal;
    return { event, position: { ledger, eventIndex } };
  });
  return positioned.sort((a, b) => compareCursor(a.position, b.position));
}

function logOutcome(
  outcome: EventOutcome,
  position: IndexerCursor,
  fields: { campaignId?: string; txHash?: string; reason?: string } = {},
): void {
  logInfo(
    'soroban_event_outcome',
    {
      outcome,
      ledger: position.ledger,
      eventIndex: position.eventIndex,
      campaignRef: fields.campaignId ? redactReference(fields.campaignId) : undefined,
      txRef: fields.txHash ? redactReference(fields.txHash) : undefined,
      reason: fields.reason,
    },
    config.logLevel,
  );
}

/**
 * Processes one fetched batch in chain order.
 *
 * Each event and its cursor advance are written in a single transaction, so a
 * restart can never leave an event recorded with the cursor still behind it, or
 * the cursor ahead of an event that was not recorded. If an event cannot be
 * stored, the batch stops there, the remaining events are reported as pending,
 * and the error is rethrown so the scheduler backs off and retries from the
 * unchanged cursor.
 *
 * Events are identified by (ledger, eventIndex), so several events that share
 * a ledger or a transaction are each indexed exactly once, in chain order.
 */
export function processSorobanEvents(events: SorobanEvent[]): BatchResult {
  const db = getDb();
  let cursor = getIndexerCursor();
  // Legacy databases only remember the next ledger to fetch, not which events
  // inside it were consumed, so that ledger must be processed in full.
  const compound = hasCompoundCursor(db);
  const ordered = positionEvents(events);

  const result: BatchResult = {
    committed: 0,
    rejected: 0,
    recovered: 0,
    skipped: 0,
    pending: 0,
    cursor,
  };

  const advance = (position: IndexerCursor): void => {
    db.transaction(() => writeIndexerCursor(db, position))();
    cursor = position;
  };

  for (let i = 0; i < ordered.length; i += 1) {
    const { event, position } = ordered[i];

    const alreadyConsumed = compound
      ? !isAfterCursor(position, cursor)
      : position.ledger < cursor.ledger;
    if (alreadyConsumed) {
      result.skipped += 1;
      continue;
    }

    try {
      const parsed = parseSorobanEvent(event, position.eventIndex);
      if (!parsed) {
        // Not an event this indexer records; step over it so it is not re-read.
        advance(position);
        result.skipped += 1;
        continue;
      }

      if (isDuplicateEvent(db, event, position.eventIndex)) {
        // Recorded by an earlier run that stopped before moving the cursor.
        advance(position);
        result.recovered += 1;
        logOutcome('committed', position, {
          campaignId: parsed.campaignId,
          txHash: event.txHash,
          reason: 'recovered_after_restart',
        });
        continue;
      }

      const handled = db.transaction(() => {
        const outcome = handleParsedEvent(parsed);
        writeIndexerCursor(db, position);
        return outcome;
      })();
      cursor = position;

      if (handled.outcome === 'committed') {
        result.committed += 1;
        logOutcome('committed', position, { campaignId: parsed.campaignId, txHash: event.txHash });
      } else {
        result.rejected += 1;
        logOutcome('rejected', position, {
          campaignId: parsed.campaignId,
          txHash: event.txHash,
          reason: handled.reason,
        });
      }
    } catch (err) {
      result.pending = ordered.length - i;
      result.cursor = cursor;
      logOutcome('pending', position, {
        txHash: event.txHash,
        reason: err instanceof Error ? err.message : String(err),
      });
      logInfo(
        'soroban_indexer_batch_interrupted',
        { ...result, resumeLedger: cursor.ledger, resumeEventIndex: cursor.eventIndex },
        config.logLevel,
      );
      throw err;
    }
  }

  result.cursor = cursor;
  logInfo('soroban_indexer_batch', { ...result }, config.logLevel);
  return result;
}

export interface PollResult {
  /** Events old enough to be persisted. */
  confirmed: number;
  /** Events inside the confirmation window; nothing was written for them. */
  tentative: number;
  /** Chain head reported by the RPC for this poll. */
  latestLedger: number;
}

/**
 * Fetches one page of events and persists only those buried under
 * `minConfirmations` ledgers.
 *
 * Tentative events are deliberately not written and the cursor is not allowed
 * to move past them. A reorganization can replace them, so the next poll
 * re-reads the same range and only then persists the surviving events. This is
 * also why no local tentative row ever has to be purged after a reorg.
 */
export async function pollSorobanEventsOnce(
  minConfirmations: number = CONFIRMATION_DEPTH,
): Promise<PollResult | null> {
  if (!CONTRACT_ID) return null;

  // Start at the cursor's own ledger, not the one after it: the previous batch
  // may have stopped part-way through that ledger. Events already consumed are
  // skipped by position inside processSorobanEvents.
  const { events, latestLedger } = await fetchSorobanEvents(getLastProcessedLedger());

  const confirmedEvents: SorobanEvent[] = [];
  let tentative = 0;
  for (const event of events) {
    const ledger = Number(event.ledger);
    if (!Number.isFinite(ledger) || !isConfirmed(latestLedger, ledger, minConfirmations)) {
      tentative += 1;
      continue;
    }
    confirmedEvents.push(event);
  }

  if (confirmedEvents.length > 0) {
    processSorobanEvents(confirmedEvents);
  }

  if (tentative > 0) {
    const cursor = getIndexerCursor();
    logInfo(
      'soroban_indexer_tentative_events',
      {
        message: `${tentative} event(s) waiting for ${minConfirmations} confirmation(s).`,
        tentative,
        latestLedger,
        minConfirmations,
        resumeLedger: cursor.ledger,
        resumeEventIndex: cursor.eventIndex,
      },
      config.logLevel,
    );
  }

  return { confirmed: confirmedEvents.length, tentative, latestLedger };
}


// ---------------------------------------------------------------------------
// Scheduler with exponential backoff on RPC failures
// ---------------------------------------------------------------------------

let pollerTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
let lastSuccessfulPollTime: number | null = null;
let lastKnownLedger: number | null = null;
let lastErrorReason: string | null = null;

export type IndexerFreshness = 'fresh' | 'idle' | 'stale' | 'failing' | 'never';

/**
 * Classify indexer freshness so operators can tell healthy-but-idle from
 * stale or failing behavior (issue #1024).
 */
export function classifyIndexerFreshness(input: {
  consecutiveFailures: number;
  lagMs: number | null;
  running: boolean;
}): IndexerFreshness {
  if (input.consecutiveFailures > 0) return 'failing';
  if (input.lagMs == null) return 'never';
  if (input.lagMs >= STALE_LAG_MS) return 'stale';
  if (input.lagMs <= FRESH_LAG_MS) return 'fresh';
  return 'idle';
}

export function getIndexerStatus() {
  const lagMs = lastSuccessfulPollTime ? Date.now() - lastSuccessfulPollTime : null;
  const running = pollerTimer !== null;
  const freshness = classifyIndexerFreshness({
    consecutiveFailures,
    lagMs,
    running,
  });
  // Failure or unbounded lag → not healthy. Idle/fresh with a running poller is OK.
  const isHealthy =
    consecutiveFailures === 0 && running && freshness !== 'stale' && freshness !== 'never';

  return {
    lastSuccessfulPollTime,
    lastKnownLedger: lastKnownLedger ?? getLastProcessedLedger(),
    isHealthy,
    consecutiveFailures,
    lagMs,
    freshness,
    staleLagMs: STALE_LAG_MS,
    freshLagMs: FRESH_LAG_MS,
  };
}

function scheduleNextPoll(delayMs: number): void {
  pollerTimer = setTimeout(async () => {
    try {
      await pollSorobanEventsOnce();

      if (consecutiveFailures > 0) {
        logInfo(
          'soroban_indexer_recovery',
          {
            message: `Indexer recovered after ${consecutiveFailures} consecutive failures.`,
            retryCount: consecutiveFailures,
            outcome: 'success',
            lastErrorReason,
          },
          config.logLevel,
        );
      }

      consecutiveFailures = 0;
      lastErrorReason = null;
      lastSuccessfulPollTime = Date.now();
      scheduleNextPoll(POLL_INTERVAL_MS);
    } catch (err) {
      consecutiveFailures += 1;
      const backoffMs = Math.min(
        POLL_INTERVAL_MS * Math.pow(2, consecutiveFailures),
        MAX_BACKOFF_MS,
      );

      const reason = err instanceof Error ? err.message : String(err);
      lastErrorReason = reason;

      logError(
        err,
        {
          event: 'soroban_event_index_error',
          consecutiveFailures,
          nextRetryMs: backoffMs,
          reason,
        },
        config.logLevel,
      );
      logInfo(
        'soroban_indexer_backoff',
        {
          message: `RPC failure #${consecutiveFailures}. Retrying in ${backoffMs / 1000}s.`,
          backoffMs,
        },
        config.logLevel,
      );
      scheduleNextPoll(backoffMs);
    }
  }, delayMs);
}

export function startEventIndexer(): void {
  ensureKvStore();

  const lastLedger = getLastProcessedLedger();
  logInfo(
    'soroban_event_indexer_started',
    {
      message: `Soroban event indexer started. Polling every ${POLL_INTERVAL_MS / 1000}s. Resuming from ledger ${lastLedger}.`,
      pollIntervalSeconds: POLL_INTERVAL_MS / 1000,
      resumingFromLedger: lastLedger,
      contractId: CONTRACT_ID || '(not configured)',
    },
    config.logLevel,
  );

  // Start the first poll immediately, then schedule subsequent polls
  scheduleNextPoll(0);
}

export function stopEventIndexer(): void {
  if (pollerTimer !== null) {
    clearTimeout(pollerTimer);
    pollerTimer = null;
  }
}
