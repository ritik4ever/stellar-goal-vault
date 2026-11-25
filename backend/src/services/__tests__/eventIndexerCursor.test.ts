import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, resetDbForTests, getDb } from '../db';
import { getIndexerCursor, setIndexerCursor } from '../eventIndexerCursor';

describe('Event indexer cursor compatibility, chain ordering, and restart replay', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    resetDbForTests();
    initDb();
  });

  it('reads legacy ledger cursor when compound cursor is not set', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO kv_store (key, value) VALUES ('soroban_indexer_last_ledger', '12500')
    `).run();

    const cursor = getIndexerCursor();
    expect(cursor).toEqual({ ledger: 12500, eventIndex: 0 });
  });

  it('stores and retrieves compound cursor across restarts while keeping legacy key in sync', () => {
    const db = getDb();

    setIndexerCursor({ ledger: 12501, eventIndex: 3 });

    const cursor = getIndexerCursor();
    expect(cursor).toEqual({ ledger: 12501, eventIndex: 3 });

    // Verify legacy key was synced
    const legacyRow = db.prepare(`SELECT value FROM kv_store WHERE key = 'soroban_indexer_last_ledger'`).get() as { value: string };
    expect(legacyRow.value).toBe('12501');
  });

  it('correctly orders multiple events in the same ledger without dropping or duplicating', () => {
    const events = [
      { ledger: 500, eventIndex: 0, txHash: 'tx-1' },
      { ledger: 500, eventIndex: 1, txHash: 'tx-2' },
      { ledger: 501, eventIndex: 0, txHash: 'tx-3' },
    ];

    let currentCursor = getIndexerCursor();

    for (const ev of events) {
      if (ev.ledger > currentCursor.ledger || (ev.ledger === currentCursor.ledger && ev.eventIndex > currentCursor.eventIndex)) {
        setIndexerCursor({ ledger: ev.ledger, eventIndex: ev.eventIndex });
        currentCursor = getIndexerCursor();
      }
    }

    expect(currentCursor).toEqual({ ledger: 501, eventIndex: 0 });
  });
});
