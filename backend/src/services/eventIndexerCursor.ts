import { getDb, SQLiteDatabase } from './db';
import { logInfo, logError } from '../logger';
import { config } from '../config';

export interface IndexerCursor {
  ledger: number;
  eventIndex: number;
}

const CURSOR_KEY = 'soroban_indexer_cursor';
const LEGACY_LEDGER_KEY = 'soroban_indexer_last_ledger';

/**
 * Orders two event positions in chain order: by ledger, then by the event's
 * index within that ledger. Returns a negative number when `a` is before `b`,
 * zero when they are the same position, and a positive number when after.
 */
export function compareCursor(a: IndexerCursor, b: IndexerCursor): number {
  if (a.ledger !== b.ledger) return a.ledger - b.ledger;
  return a.eventIndex - b.eventIndex;
}

/** True when `position` is strictly after `cursor` in chain order. */
export function isAfterCursor(position: IndexerCursor, cursor: IndexerCursor): boolean {
  return compareCursor(position, cursor) > 0;
}

/**
 * True when a compound cursor has been committed. A database that only has the
 * legacy ledger key has not recorded which events inside that ledger were
 * already processed, so callers must treat that ledger as not yet consumed.
 */
export function hasCompoundCursor(db: SQLiteDatabase = getDb()): boolean {
  const row = db.prepare(`SELECT 1 FROM kv_store WHERE key = ?`).get(CURSOR_KEY);
  return row !== undefined;
}

/**
 * Retrieves the event indexer cursor from kv_store.
 * Backward compatible with legacy databases that only stored 'soroban_indexer_last_ledger'.
 */
export function getIndexerCursor(): IndexerCursor {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(CURSOR_KEY) as
      { value: string } | undefined;

    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      return {
        ledger: Number(parsed.ledger ?? 0),
        eventIndex: Number(parsed.eventIndex ?? 0),
      };
    }

    // Fallback to legacy single ledger key
    const legacyRow = db.prepare(`SELECT value FROM kv_store WHERE key = ?`).get(LEGACY_LEDGER_KEY) as
      { value: string } | undefined;

    if (legacyRow && legacyRow.value) {
      return {
        ledger: Number(legacyRow.value),
        eventIndex: 0,
      };
    }

    return { ledger: 0, eventIndex: 0 };
  } catch (err) {
    logError(err, { event: 'get_indexer_cursor_error' }, config.logLevel);
    return { ledger: 0, eventIndex: 0 };
  }
}

/**
 * Writes the compound cursor and the legacy ledger key on `db`.
 *
 * Unlike setIndexerCursor this does not catch errors, so a caller running it
 * inside a transaction rolls the whole unit back when the cursor cannot be
 * written. That is what keeps persisted events and the cursor in step.
 */
export function writeIndexerCursor(db: SQLiteDatabase, cursor: IndexerCursor): void {
  // 1. Update compound cursor
  db.prepare(`
    INSERT INTO kv_store (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(CURSOR_KEY, JSON.stringify(cursor));

  // 2. Sync legacy key so older components continue to function
  db.prepare(`
    INSERT INTO kv_store (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(LEGACY_LEDGER_KEY, String(cursor.ledger));
}

/**
 * Persists the event indexer cursor atomically and idempotently.
 * Also syncs legacy 'soroban_indexer_last_ledger' for backward compatibility.
 */
export function setIndexerCursor(cursor: IndexerCursor): void {
  try {
    const db = getDb();
    db.transaction(() => writeIndexerCursor(db, cursor))();

    logInfo('indexer_cursor_advanced', { cursor }, config.logLevel);
  } catch (err) {
    logError(err, { event: 'set_indexer_cursor_error', cursor }, config.logLevel);
  }
}
