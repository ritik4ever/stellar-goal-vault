import axios from "axios";
import { getDb } from "./db";
import { recordEvent, BlockchainMetadata } from "./eventHistory";
import dotenv from "dotenv";
import { config } from "../config";
import { logError, logInfo } from "../logger";

dotenv.config();

type SorobanEvent = {
  txHash?: string;
  ledger?: number;
  event_index?: number;
  type?: string;
  contract_id?: string;
  value?: unknown;
  topic?: unknown;
  timestamp?: number;
  ledgerCloseTime?: number;
  [key: string]: unknown;
};

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org:443";
const CONTRACT_ID = process.env.CONTRACT_ID || "";

// Poll interval in ms
const POLL_INTERVAL = 10000;

// Track last ingested event (by Soroban event sequence or timestamp)
let lastIngestedTimestamp = 0;


// Fetch events from Soroban RPC
async function fetchSorobanEvents() {
  if (!CONTRACT_ID) return [];
  try {
    const res = await axios.post(
      SOROBAN_RPC_URL,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getEvents",
        params: {
          contractIds: [CONTRACT_ID],
          startLedger: 0, // TODO: Use last processed ledger for efficiency
          filters: [],
          limit: 100,
        },
      },
      { headers: { "Content-Type": "application/json" } }
    );
    if (res.data && res.data.result && Array.isArray(res.data.result.events)) {
      return res.data.result.events;
    }
    return [];
  } catch (err) {
    logError(err, { event: "soroban_event_fetch_error" }, config.logLevel);
    return [];
  }
}


function isDuplicateEvent(db: ReturnType<typeof getDb>, event: SorobanEvent): boolean {
  // Use transaction hash for better deduplication if available
  if (event.txHash) {
    const row = db.prepare(
      `SELECT 1 FROM campaign_events WHERE json_extract(blockchain_metadata, '$.txHash') = ? LIMIT 1`
    ).get(event.txHash);
    if (row) return true;
  }
  
  // Fallback to ledger + event index for idempotency
  if (!event.ledger || event.event_index === undefined) return false;
  const row = db.prepare(
    `SELECT 1 FROM campaign_events WHERE 
     json_extract(blockchain_metadata, '$.ledgerNumber') = ? AND 
     json_extract(blockchain_metadata, '$.eventIndex') = ? LIMIT 1`
  ).get(event.ledger, event.event_index);
  return !!row;
}


function parseSorobanEvent(event: SorobanEvent) {
  // Example event: { ledger, event_index, type, contract_id, txHash, ledgerCloseTime, ...data }
  // Map to local event schema
  if (!event || !event.type || !event.contract_id) return null;
  // Only process contract events
  if (event.type !== "contract" || event.contract_id !== CONTRACT_ID) return null;
  
  // Parse event topic and data
  const topic = Array.isArray(event.topic) ? event.topic.map((t) => String(t)).join(":") : "";
  let eventType: "created" | "pledged" | "claimed" | "refunded" | undefined;
  if (topic.includes("Goal:Create")) eventType = "created";
  else if (topic.includes("Goal:Pledge")) eventType = "pledged";
  else if (topic.includes("Goal:Claim")) eventType = "claimed";
  else if (topic.includes("Goal:Refund")) eventType = "refunded";
  if (!eventType) return null;
  
  // Extract campaignId, actor, amount, etc. from event.value or event.data
  let campaignId = "";
  let actor: string | undefined;
  let amount: number | undefined;
  let metadata: Record<string, unknown> = { ...event };
  const value = event.value as Record<string, unknown> | undefined;
  
  try {
    if (value) {
      if (value.campaign_id !== undefined) campaignId = String(value.campaign_id);
      if (value.creator) actor = String(value.creator);
      if (value.contributor) actor = String(value.contributor);
      if (value.amount !== undefined) amount = Number(value.amount);
      metadata = { ...event, ...value };
    }
  } catch (err: unknown) {
    logError(err, { event: "soroban_event_parse_error" }, config.logLevel);
  }

  // Create blockchain metadata
  const blockchainMetadata: BlockchainMetadata = {
    txHash: event.txHash,
    ledgerNumber: event.ledger,
    ledgerCloseTime: event.ledgerCloseTime,
    eventIndex: event.event_index,
    contractId: event.contract_id,
    source: 'soroban'
  };
  
  return { 
    campaignId, 
    eventType, 
    timestamp: event.timestamp || Date.now() / 1000, 
    actor, 
    amount, 
    metadata,
    blockchainMetadata
  };
}

async function indexSorobanEvents() {
  const db = getDb();
  try {
    const events = await fetchSorobanEvents();
    for (const event of events) {
      if (isDuplicateEvent(db, event)) continue;
      const parsed = parseSorobanEvent(event);
      if (!parsed || !parsed.campaignId || !parsed.eventType) continue;
      recordEvent(
        parsed.campaignId,
        parsed.eventType,
        Math.floor(parsed.timestamp),
        parsed.actor,
        parsed.amount,
        parsed.metadata,
        parsed.blockchainMetadata
      );
      lastIngestedTimestamp = Math.max(lastIngestedTimestamp, Math.floor(parsed.timestamp));
      logInfo(
        "soroban_event_ingested",
        {
          message: `Indexed ${parsed.eventType} event for campaign ${parsed.campaignId}`,
          campaignId: parsed.campaignId,
          eventType: parsed.eventType,
          actor: parsed.actor,
          amount: parsed.amount,
        },
        config.logLevel,
      );
    }
  } catch (err) {
    logError(err, { event: "soroban_event_index_error" }, config.logLevel);
  }
}

export function startEventIndexer() {
  setInterval(indexSorobanEvents, POLL_INTERVAL);
  logInfo(
    "soroban_event_indexer_started",
    {
      message: `Soroban event indexer started. Polling every ${POLL_INTERVAL / 1000}s.`,
      pollIntervalSeconds: POLL_INTERVAL / 1000,
    },
    config.logLevel,
  );
}
