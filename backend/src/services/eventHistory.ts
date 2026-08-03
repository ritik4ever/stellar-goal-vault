import { getDb } from './db';

export type CampaignEventType =
  | 'created'
  | 'pledged'
  | 'claimed'
  | 'refunded'
  | 'updated'
  | 'metadata_updated'
  | 'pledge_limit_reached'
  | 'archived'
  | 'restored';
export interface BlockchainMetadata {
  txHash?: string;
  ledgerNumber?: number;
  ledgerCloseTime?: number;
  eventIndex?: number;
  contractId?: string;
  source?: 'local' | 'soroban';
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
    blockchainMetadata: blockchainMetadata ? JSON.stringify(blockchainMetadata) : null,
  });
}

export interface CampaignHistoryPage {
  data: CampaignEvent[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
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
 * Returns a paginated slice of campaign events, newest first.
 */
export function listCampaignHistory(
  campaignId: string,
  options: { page?: number; pageSize?: number } = {},
): CampaignHistoryPage {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM campaign_events WHERE campaign_id = ?`)
    .get(campaignId) as { total: number };
  const total = countRow.total;

  const rows = db
    .prepare(
      `SELECT * FROM campaign_events WHERE campaign_id = ? ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(campaignId, pageSize, offset) as EventRow[];

  return {
    data: rows.map(rowToEvent),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
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

// ── Unified Timeline ────────────────────────────────────────────────────────

export type TimelineItemType = 'pledge' | 'status_change' | 'update' | 'comment';

export interface TimelineItem {
  id: string;
  campaignId: string;
  type: TimelineItemType;
  timestamp: number;
  actor?: string;
  amount?: number;
  assetCode?: string;
  metadata?: Record<string, unknown>;
  eventType?: string;
}

interface TimelineRow {
  source: string;
  source_id: number;
  campaign_id: string;
  timestamp: number;
  actor: string | null;
  amount: number | null;
  asset_code: string | null;
  event_type: string | null;
  metadata: string | null;
}

export interface TimelinePage {
  data: TimelineItem[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Returns a unified timeline for a campaign, merging pledge records and
 * campaign lifecycle events into a single sorted stream.
 *
 * Cursor-based pagination: the cursor encodes the last-seen timestamp and
 * source ID as `{timestamp}:{source}:{source_id}`. New items inserted with
 * the same timestamp will still appear correctly because the cursor is
 * decoded into an anchor point, not a row number.
 */
export function getCampaignTimeline(
  campaignId: string,
  options: { cursor?: string; limit?: number } = {},
): TimelinePage {
  const limit = Math.min(options.limit ?? 20, 100);
  const db = getDb();

  let cursorTimestamp: number | undefined;
  let cursorSource: string | undefined;
  let cursorId: number | undefined;

  if (options.cursor) {
    try {
      const decoded = Buffer.from(options.cursor, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      cursorTimestamp = Number(parts[0]);
      cursorSource = parts[1];
      cursorId = Number(parts[2]);
    } catch {
      cursorTimestamp = undefined;
    }
  }

  const rows = db
    .prepare(
      `
      WITH combined AS (
        SELECT
          'pledge' AS source,
          p.id AS source_id,
          p.campaign_id,
          p.created_at AS timestamp,
          p.contributor AS actor,
          p.amount AS amount,
          p.asset_code AS asset_code,
          NULL AS event_type,
          NULL AS metadata
        FROM pledges p
        WHERE p.campaign_id = ?

        UNION ALL

        SELECT
          'event' AS source,
          e.id AS source_id,
          e.campaign_id,
          e.timestamp,
          e.actor,
          e.amount,
          NULL AS asset_code,
          e.event_type,
          e.metadata
        FROM campaign_events e
        WHERE e.campaign_id = ?
      )
      SELECT * FROM combined
      WHERE (? IS NULL
        OR timestamp < ?
        OR (timestamp = ? AND source > ?)
        OR (timestamp = ? AND source = ? AND source_id < ?))
      ORDER BY timestamp DESC, source ASC, source_id DESC
      LIMIT ?
    `,
    )
    .all(
      campaignId,
      campaignId,
      cursorTimestamp ?? null,
      cursorTimestamp ?? null,
      cursorTimestamp ?? null,
      cursorSource ?? null,
      cursorTimestamp ?? null,
      cursorSource ?? null,
      cursorId ?? null,
      limit + 1,
    ) as TimelineRow[];

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(rowToTimelineItem);

  let nextCursor: string | undefined;
  if (hasMore && rows.length > 0) {
    const lastRow = rows[limit - 1];
    const raw = `${lastRow.timestamp}:${lastRow.source}:${lastRow.source_id}`;
    nextCursor = Buffer.from(raw).toString('base64');
  }

  return { data: items, nextCursor, hasMore };
}

function rowToTimelineItem(row: TimelineRow): TimelineItem {
  const isPledge = row.source === 'pledge';

  let type: TimelineItemType;
  let parsedMetadata: Record<string, unknown> | undefined;

  if (isPledge) {
    type = 'pledge';
    parsedMetadata = undefined;
  } else {
    parsedMetadata = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined;

    switch (row.event_type) {
      case 'created':
      case 'claimed':
      case 'refunded':
        type = 'status_change';
        break;
      case 'metadata_updated':
        type = 'update';
        break;
      case 'pledged':
        type = 'pledge';
        break;
      case 'pledge_limit_reached':
        type = 'status_change';
        break;
      default:
        type = 'status_change';
    }
  }

  const id = `${row.source}:${row.source_id}`;

  return {
    id,
    campaignId: row.campaign_id,
    type,
    timestamp: row.timestamp,
    actor: row.actor ?? undefined,
    amount: row.amount ?? undefined,
    assetCode: row.asset_code ?? undefined,
    metadata: parsedMetadata,
    eventType: row.event_type ?? undefined,
  };
}

/**
 * Returns all events originating from a given source (local backend or Soroban chain).
 *
 * @param source - `"local"` for off-chain events, `"soroban"` for on-chain events.
 * @returns An array of {@link CampaignEvent} objects in chronological order.
 */
export function getEventsBySource(source: 'local' | 'soroban'): CampaignEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM campaign_events WHERE json_extract(blockchain_metadata, '$.source') = ? ORDER BY timestamp ASC, id ASC`,
    )
    .all(source) as EventRow[];

  return rows.map(rowToEvent);
}
