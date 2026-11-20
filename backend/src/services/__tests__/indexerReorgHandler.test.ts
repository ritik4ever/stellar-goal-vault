import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, resetDbForTests } from '../db';
import { IndexerReorgHandler, redactReference } from '../indexerReorgHandler';

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

  it('safely purges tentative events when RPC disagrees after a reorg', () => {
    const handler = new IndexerReorgHandler(1);
    const outcome = handler.handleReorgDisagreement('0xbadtx', 'campaign-12345', 'Transaction dropped by reorg');
    expect(outcome).toBe('rejected');
  });
});
