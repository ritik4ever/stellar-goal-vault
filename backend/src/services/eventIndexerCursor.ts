import { getDb } from './db';
import { logInfo, logError } from '../logger';
import { config } from '../config';

export interface IndexerCursor {
  ledger: number;
  eventIndex: number;
}

const CURSOR_KEY = 'soroban_indexer_cursor';
const LEGACY_LEDGER_KEY = 'soroban_indexer_last_ledger';

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
 * Persists the event indexer cursor atomically and idempotently.
 * Also syncs legacy 'soroban_indexer_last_ledger' for backward compatibility.
 */
export function setIndexerCursor(cursor: IndexerCursor): void {
  try {
    const db = getDb();
    db.transaction(() => {
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
    })();

    logInfo('indexer_cursor_advanced', { cursor }, config.logLevel);
  } catch (err) {
    logError(err, { event: 'set_indexer_cursor_error', cursor }, config.logLevel);
  }
}
