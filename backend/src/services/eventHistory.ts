import { getDb } from './db';

export type CampaignEventType = 'created' | 'pledged' | 'claimed' | 'refunded' | 'updated';

export interface BlockchainMetadata {
  txHash?: string;
  ledgerNumber?: number;
  ledgerCloseTime?: number;
  eventIndex?: number;
  contractId?: string;
  source?: "local" | "soroban";
}

export interface CampaignEvent {
  id: number;
  campaignId: string;
  eventType: CampaignEventType;
  timestamp: number;
  actor?: string;
  amount?: number;
  metadata?: Record<string, unknown>;
  blockchainMetadata?: BlockchainMetadata;
}

interface EventRow {
  id: number;
  campaign_id: string;
  event_type: string;
  timestamp: number;
  actor: string | null;
  amount: number | null;
  metadata: string | null;
  blockchain_metadata: string | null;
}

function rowToEvent(row: EventRow): CampaignEvent {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    eventType: row.event_type as CampaignEventType,
    timestamp: row.timestamp,
    actor: row.actor ?? undefined,
    amount: row.amount ?? undefined,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
    blockchainMetadata: row.blockchain_metadata
      ? (JSON.parse(row.blockchain_metadata) as BlockchainMetadata)
      : undefined,
  };
}

/**
 * Persists a campaign lifecycle event to the database.
 *
 * @param campaignId - The ID of the campaign this event belongs to.
 * @param eventType - The type of event (e.g. "created", "pledged", "claimed", "refunded").
 * @param timestamp - Unix timestamp (seconds) when the event occurred.
 * @param actor - Optional wallet address of the user who triggered the event.
 * @param amount - Optional token amount associated with the event.
 * @param metadata - Optional arbitrary key-value data about the event.
 * @param blockchainMetadata - Optional on-chain context (tx hash, ledger info, source).
 */
export function recordEvent(
  campaignId: string,
  eventType: CampaignEventType,
  timestamp: number,
  actor?: string,
  amount?: number,
  metadata?: Record<string, unknown>,
  blockchainMetadata?: BlockchainMetadata,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO campaign_events (campaign_id, event_type, timestamp, actor, amount, metadata, blockchain_metadata)
     VALUES (@campaignId, @eventType, @timestamp, @actor, @amount, @metadata, @blockchainMetadata)`,
  ).run({
    campaignId,
    eventType,
    timestamp,
    actor: actor ?? null,
    amount: amount ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    blockchainMetadata: blockchainMetadata
      ? JSON.stringify(blockchainMetadata)
      : null,
  });
}

/**
 * Returns all events for a given campaign in chronological order.
 *
 * @param campaignId - The ID of the campaign whose history to fetch.
 * @returns An array of {@link CampaignEvent} objects sorted by timestamp ascending.
 */
export function getCampaignHistory(campaignId: string): CampaignEvent[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM campaign_events WHERE campaign_id = ? ORDER BY timestamp ASC, id ASC`)
    .all(campaignId) as EventRow[];

  return rows.map(rowToEvent);
}

/**
 * Looks up a single event by its on-chain transaction hash.
 *
 * @param txHash - The Soroban transaction hash to search for.
 * @returns The matching {@link CampaignEvent}, or `undefined` if not found.
 */
export function getEventByTxHash(txHash: string): CampaignEvent | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM campaign_events WHERE json_extract(blockchain_metadata, '$.txHash') = ? LIMIT 1`,
    )
    .get(txHash) as EventRow | undefined;

  return row ? rowToEvent(row) : undefined;
}

/**
 * Returns all events that were confirmed in a specific ledger.
 *
 * @param ledgerNumber - The ledger sequence number to filter by.
 * @returns An array of {@link CampaignEvent} objects ordered by their event index within the ledger.
 */
export function getEventsByLedger(ledgerNumber: number): CampaignEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM campaign_events WHERE json_extract(blockchain_metadata, '$.ledgerNumber') = ? ORDER BY json_extract(blockchain_metadata, '$.eventIndex') ASC`,
    )
    .all(ledgerNumber) as EventRow[];

  return rows.map(rowToEvent);
}

/**
 * Returns all events originating from a given source (local backend or Soroban chain).
 *
 * @param source - `"local"` for off-chain events, `"soroban"` for on-chain events.
 * @returns An array of {@link CampaignEvent} objects in chronological order.
 */
export function getEventsBySource(
  source: "local" | "soroban",
): CampaignEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM campaign_events WHERE json_extract(blockchain_metadata, '$.source') = ? ORDER BY timestamp ASC, id ASC`,
    )
    .all(source) as EventRow[];

  return rows.map(rowToEvent);
}
