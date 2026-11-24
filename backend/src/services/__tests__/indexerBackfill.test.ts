import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, resetDbForTests, getDb } from '../db';
import { runIndexerBackfill, redactReference, RawRpcEvent } from '../indexerBackfill';

describe('Indexer backfill behavior and replay safety', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    resetDbForTests();
    initDb();
  });

  it('redacts references cleanly for observability', () => {
    expect(redactReference('campaign-123456789')).toBe('camp...6789');
    expect(redactReference('short')).toBe('***');
    expect(redactReference('')).toBe('unknown');
  });

  it('idempotently backfills ledger ranges overlapping live polling without duplicate events', async () => {
    const db = getDb();
    const mockEvents: RawRpcEvent[] = [
      {
        contract_id: 'contract-1',
        txHash: '0xabc1',
        ledger: 100,
        event_index: 0,
        value: { campaign_id: 'camp-1', event_type: 'pledged', amount: 50 },
      },
      {
        contract_id: 'contract-1',
        txHash: '0xabc2',
        ledger: 101,
        event_index: 0,
        value: { campaign_id: 'camp-1', event_type: 'pledged', amount: 100 },
      },
    ];

    const fetchFn = async () => mockEvents;

    // First backfill run
    const result1 = await runIndexerBackfill({ startLedger: 100, endLedger: 105 }, fetchFn);
    expect(result1.status).toBe('committed');
    expect(result1.eventsProcessed).toBe(2);

    // Replay / overlap run
    const result2 = await runIndexerBackfill({ startLedger: 99, endLedger: 105 }, fetchFn);
    expect(result2.status).toBe('committed');
    expect(result2.eventsProcessed).toBe(0); // 0 new events because they are deduplicated

    // Verify row count in DB
    const count = (db.prepare('SELECT count(*) as count FROM campaign_events').get() as { count: number }).count;
    expect(count).toBe(2);
  });

  it('rejects invalid ledger boundary ranges cleanly', async () => {
    const result = await runIndexerBackfill(
      { startLedger: 200, endLedger: 100 },
      async () => [],
    );
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('exceeds endLedger');
  });
});
