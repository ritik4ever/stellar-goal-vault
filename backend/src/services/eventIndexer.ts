import axios from 'axios';
import { getDb } from './db';
import { recordEvent, BlockchainMetadata, CampaignEventType } from './eventHistory';
import { reconcileOnChainPledge, createCampaign, getCampaign } from './campaignStore';
import dotenv from 'dotenv';
import { config } from '../config';
import { logError, logInfo } from '../logger';

dotenv.config();

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const CONTRACT_ID = process.env.CONTRACT_ID || '';

/**
 * Poll interval in milliseconds. Defaults to 15 seconds per the issue spec.
 * Configurable via SOROBAN_POLL_INTERVAL_MS environment variable.
 */
const POLL_INTERVAL_MS = Number(process.env.SOROBAN_POLL_INTERVAL_MS ?? 15_000);

/** Maximum backoff delay in milliseconds (5 minutes). */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Key used to store the last-processed ledger in the kv_store table. */
const LAST_LEDGER_KEY = 'soroban_indexer_last_ledger';

// ---------------------------------------------------------------------------
// KV store helpers (persists indexer state across restarts)
// ---------------------------------------------------------------------------

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
  try {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(LAST_LEDGER_KEY) as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : 0;
  } catch {
    return 0;
  }
}

function setLastProcessedLedger(ledger: number): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO kv_store (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(LAST_LEDGER_KEY, String(ledger));
  } catch (err) {
    logError(err, { event: 'kv_store_write_error' }, config.logLevel);
  }
}

// ---------------------------------------------------------------------------
// Soroban RPC helpers
// ---------------------------------------------------------------------------

async function fetchSorobanEvents(startLedger: number): Promise<any[]> {
  if (!CONTRACT_ID) return [];
  try {
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
    if (res.data?.result?.events && Array.isArray(res.data.result.events)) {
      return res.data.result.events;
    }
    return [];
  } catch (err) {
    // Re-throw so the caller can apply backoff
    throw err;
  }
}

async function fetchLatestLedger(): Promise<number> {
  try {
    const res = await axios.post(
      SOROBAN_RPC_URL,
      { jsonrpc: '2.0', id: 1, method: 'getLatestLedger', params: {} },
      { headers: { 'Content-Type': 'application/json' }, timeout: 5_000 },
    );
    return res.data?.result?.sequence ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function isDuplicateEvent(db: ReturnType<typeof getDb>, event: any): boolean {
  // Primary: deduplicate by transaction hash
  if (event.txHash) {
    const row = db
      .prepare(
        `SELECT 1 FROM campaign_events
         WHERE json_extract(blockchain_metadata, '$.txHash') = ? LIMIT 1`,
      )
      .get(event.txHash);
    if (row) return true;
  }

  // Fallback: deduplicate by ledger + event index
  if (event.ledger != null && event.event_index != null) {
    const row = db
      .prepare(
        `SELECT 1 FROM campaign_events
         WHERE json_extract(blockchain_metadata, '$.ledgerNumber') = ?
           AND json_extract(blockchain_metadata, '$.eventIndex') = ? LIMIT 1`,
      )
      .get(event.ledger, event.event_index);
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
  // Alternative spellings from some contract versions
  'Goal:Create': 'created',
  'Goal:Pledge': 'pledged',
  'Goal:Claim': 'claimed',
  'Goal:Refund': 'refunded',
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

function parseSorobanEvent(event: any): ParsedEvent | null {
  if (!event?.type || !event?.contract_id) return null;
  if (event.type !== 'contract' || event.contract_id !== CONTRACT_ID) return null;

  // Determine event type from topics
  const topics: string[] = Array.isArray(event.topic)
    ? event.topic.map((t: any) => String(t))
    : [];

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
    eventIndex: event.event_index,
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

function handleParsedEvent(parsed: ParsedEvent): void {
  try {
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
        return;
      }

      if (parsed.blockchainMetadata.txHash) {
        try {
          reconcileOnChainPledge(parsed.campaignId, {
            contributor: parsed.actor!,
            amount: parsed.amount!,
            transactionHash: parsed.blockchainMetadata.txHash,
            confirmedAt: parsed.timestamp,
          });
        } catch (reconcileErr: any) {
          // TRANSACTION_HASH_CONFLICT means already reconciled — that's fine
          if (reconcileErr?.code !== 'TRANSACTION_HASH_CONFLICT') {
            logError(reconcileErr, { event: 'soroban_reconcile_error', campaignId: parsed.campaignId }, config.logLevel);
          }
          return; // Don't double-record the event
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
  } catch (err) {
    logError(
      err,
      { event: 'soroban_event_handle_error', campaignId: parsed.campaignId, eventType: parsed.eventType },
      config.logLevel,
    );
  }
}

// ---------------------------------------------------------------------------
// Main poll cycle
// ---------------------------------------------------------------------------

async function indexSorobanEvents(): Promise<void> {
  if (!CONTRACT_ID) return;

  const db = getDb();
  const startLedger = getLastProcessedLedger();

  const events = await fetchSorobanEvents(startLedger);
  if (events.length === 0) return;

  let maxLedger = startLedger;

  for (const event of events) {
    if (isDuplicateEvent(db, event)) continue;

    const parsed = parseSorobanEvent(event);
    if (!parsed) continue;

    handleParsedEvent(parsed);

    if (parsed.ledger > maxLedger) {
      maxLedger = parsed.ledger;
    }
  }

  // Persist the highest ledger we processed so we don't re-fetch it next poll
  if (maxLedger > startLedger) {
    setLastProcessedLedger(maxLedger + 1); // +1 so next poll starts after this ledger
  }
}

// ---------------------------------------------------------------------------
// Scheduler with exponential backoff on RPC failures
// ---------------------------------------------------------------------------

let pollerTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;

function scheduleNextPoll(delayMs: number): void {
  pollerTimer = setTimeout(async () => {
    try {
      await indexSorobanEvents();
      consecutiveFailures = 0;
      scheduleNextPoll(POLL_INTERVAL_MS);
    } catch (err) {
      consecutiveFailures += 1;
      const backoffMs = Math.min(
        POLL_INTERVAL_MS * Math.pow(2, consecutiveFailures),
        MAX_BACKOFF_MS,
      );
      logError(
        err,
        {
          event: 'soroban_event_index_error',
          consecutiveFailures,
          nextRetryMs: backoffMs,
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
