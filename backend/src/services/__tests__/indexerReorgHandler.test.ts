import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb, resetDbForTests } from '../db';
import {
  IndexerReorgHandler,
  confirmationsFor,
  isConfirmed,
  redactReference,
} from '../indexerReorgHandler';

describe('Indexer reorganization boundary handling and observability', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    resetDbForTests();
    initDb();
  });

  it('redacts references cleanly for observability logs', () => {
    expect(redactReference('campaign-reorg-999')).toBe('camp...-999');
    expect(redactReference('short')).toBe('***');
    expect(redactReference('')).toBe('unknown');
  });

  it('distinguishes pending tentative events from committed chain outcomes', () => {
    const handler = new IndexerReorgHandler(2);

    const event = {
      txHash: '0xtx1',
      ledger: 100,
      campaignId: 'campaign-12345',
      eventType: 'pledged',
    };

    // 0 confirmations -> pending
    expect(handler.evaluateEvent(100, event)).toBe('pending');

    // 1 confirmation -> pending (min is 2)
    expect(handler.evaluateEvent(101, event)).toBe('pending');

    // 2 confirmations -> committed
    expect(handler.evaluateEvent(102, event)).toBe('committed');
  });

  it('exposes the confirmation window as pure predicates', () => {
    expect(confirmationsFor(110, 100)).toBe(10);
    expect(confirmationsFor(100, 100)).toBe(0);
    expect(confirmationsFor(99, 100)).toBe(-1);
    expect(isConfirmed(102, 100, 2)).toBe(true);
    expect(isConfirmed(101, 100, 2)).toBe(false);
  });

  it('normalizes a non-positive or non-numeric depth to one confirmation', () => {
    expect(new IndexerReorgHandler(0).evaluateEvent(100, event(100))).toBe('pending');
    expect(new IndexerReorgHandler(Number.NaN).evaluateEvent(101, event(100))).toBe('committed');
  });

  it('never mutates persisted history when evaluating a tentative event', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO campaigns (id, creator, title, description, target_amount, deadline, created_at)
       VALUES ('campaign-12345', 'GCREATOR', 'Title', 'Desc', 100, 9999999999, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO campaign_events (campaign_id, event_type, timestamp, blockchain_metadata)
       VALUES (?, 'pledged', 1, ?)`,
    ).run('campaign-12345', JSON.stringify({ txHash: '0xtx1', ledgerNumber: 100 }));

    const handler = new IndexerReorgHandler(5);
    expect(handler.evaluateEvent(101, event(100))).toBe('pending');
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM campaign_events`).get(),
    ).toEqual({ n: 1 });
  });
});

function event(ledger: number) {
  return {
    txHash: '0xtx1',
    ledger,
    campaignId: 'campaign-12345',
    eventType: 'pledged',
  };
}
