import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, initDb, resetDbForTests } from '../db';
import { getIndexerCursor } from '../eventIndexerCursor';
import type { SorobanEvent } from '../eventIndexer';

const { logInfoMock } = vi.hoisted(() => ({ logInfoMock: vi.fn() }));

vi.mock('../../logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../logger')>();
  return { ...actual, logInfo: logInfoMock };
});

const CONTRACT = 'CTESTCONTRACT';
const CAMPAIGN = 'campaign-abcdef-123456';

function created(ledger: number, eventIndex: number | undefined, txHash: string): SorobanEvent {
  return {
    type: 'contract',
    contract_id: CONTRACT,
    txHash,
    ledger,
    event_index: eventIndex,
    topic: ['CampaignCreated', CAMPAIGN],
    value: { campaign_id: CAMPAIGN, creator: 'GCREATOR' },
  };
}

function pledged(ledger: number, eventIndex: number, txHash: string, campaignId = CAMPAIGN) {
  return {
    type: 'contract',
    contract_id: CONTRACT,
    txHash,
    ledger,
    event_index: eventIndex,
    topic: ['CampaignPledged', campaignId],
    value: { campaign_id: campaignId, contributor: 'GCONTRIB', amount: 5 },
  } as SorobanEvent;
}

/**
 * Rows the indexer wrote, identified by the event position in their metadata.
 * reconcileOnChainPledge also records its own `pledged` row (txHash only, no
 * position), which is not an indexed event and is excluded here.
 */
function recordedEvents(): Array<{ ledger: number; eventIndex: number; txHash: string }> {
  const rows = getDb()
    .prepare(
      `SELECT blockchain_metadata AS m FROM campaign_events
       WHERE json_extract(blockchain_metadata, '$.eventIndex') IS NOT NULL ORDER BY id`,
    )
    .all() as Array<{ m: string }>;
  return rows.map((row) => {
    const meta = JSON.parse(row.m);
    return { ledger: meta.ledgerNumber, eventIndex: meta.eventIndex, txHash: meta.txHash };
  });
}

function outcomes(): Array<Record<string, unknown>> {
  return logInfoMock.mock.calls
    .filter(([event]) => event === 'soroban_event_outcome')
    .map(([, fields]) => fields as Record<string, unknown>);
}

describe('event indexer cursor: same-ledger ordering, restart recovery, outcomes', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    process.env.CONTRACT_ID = CONTRACT;
    resetDbForTests();
    initDb();
    getDb()
      .prepare(
        `INSERT INTO campaigns (id, creator, title, description, target_amount, deadline, created_at)
         VALUES (?, 'GCREATOR', 'Title', 'Desc', 100, 9999999999, 1)`,
      )
      .run(CAMPAIGN);
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDbForTests();
    delete process.env.CONTRACT_ID;
  });

  async function load() {
    return import('../eventIndexer');
  }

  it('creates kv_store at startup so the cursor persists before the worker runs', () => {
    const table = getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv_store'`)
      .get();
    expect(table).toBeDefined();
  });

  describe('two contract events in the same ledger (#1531)', () => {
    it('indexes each event once, in chain order, even when the RPC returns them shuffled', async () => {
      const { processSorobanEvents } = await load();

      const result = processSorobanEvents([
        pledged(500, 2, 'tx-c'),
        created(500, 0, 'tx-a'),
        pledged(500, 1, 'tx-b'),
      ]);

      expect(result.committed).toBe(3);
      expect(recordedEvents().map((e) => e.eventIndex)).toEqual([0, 1, 2]);
      expect(getIndexerCursor()).toEqual({ ledger: 500, eventIndex: 2 });
    });

    it('does not drop a second event that shares a transaction hash', async () => {
      const { processSorobanEvents } = await load();

      const result = processSorobanEvents([
        created(500, 0, 'tx-shared'),
        pledged(500, 1, 'tx-shared'),
      ]);

      expect(result.committed).toBe(2);
      expect(recordedEvents()).toHaveLength(2);
    });

    it('does not let the pledge reconciliation row hide later events in the same transaction', async () => {
      const { processSorobanEvents } = await load();

      // The first pledge makes reconcileOnChainPledge write its own txHash-only row.
      const result = processSorobanEvents([
        pledged(500, 0, 'tx-shared'),
        pledged(500, 1, 'tx-shared'),
      ]);

      expect(result.committed).toBe(2);
      expect(recordedEvents().map((e) => e.eventIndex)).toEqual([0, 1]);
    });

    it('assigns ordinals within the ledger when the RPC supplies no event_index', async () => {
      const { processSorobanEvents } = await load();

      processSorobanEvents([
        created(700, undefined, 'tx-a'),
        pledged(700, undefined as unknown as number, 'tx-b'),
      ]);

      expect(recordedEvents().map((e) => e.eventIndex)).toEqual([0, 1]);
      expect(getIndexerCursor()).toEqual({ ledger: 700, eventIndex: 1 });
    });

    it('resumes mid-ledger: only events after the cursor are processed on the next batch', async () => {
      const { processSorobanEvents } = await load();

      processSorobanEvents([created(500, 0, 'tx-a'), pledged(500, 1, 'tx-b')]);
      const next = processSorobanEvents([
        created(500, 0, 'tx-a'),
        pledged(500, 1, 'tx-b'),
        pledged(500, 2, 'tx-c'),
        pledged(501, 0, 'tx-d'),
      ]);

      expect(next.skipped).toBe(2);
      expect(next.committed).toBe(2);
      expect(recordedEvents()).toHaveLength(4);
      expect(getIndexerCursor()).toEqual({ ledger: 501, eventIndex: 0 });
    });

    it('processes the whole next-ledger boundary for a legacy cursor that only stored a ledger', async () => {
      const { processSorobanEvents } = await load();
      getDb()
        .prepare(`INSERT INTO kv_store (key, value) VALUES ('soroban_indexer_last_ledger', '600')`)
        .run();

      const result = processSorobanEvents([
        created(599, 0, 'tx-old'),
        created(600, 0, 'tx-first'),
        pledged(600, 1, 'tx-second'),
      ]);

      expect(result.skipped).toBe(1);
      expect(result.committed).toBe(2);
      expect(recordedEvents().map((e) => e.txHash)).toEqual(['tx-first', 'tx-second']);
    });
  });

  describe('restart between persist and cursor update (#1532)', () => {
    it('does not duplicate an event that was recorded before the cursor moved', async () => {
      const { processSorobanEvents } = await load();

      // State left by a worker that stopped after recording but before the cursor update.
      getDb()
        .prepare(
          `INSERT INTO campaign_events (campaign_id, event_type, timestamp, blockchain_metadata)
           VALUES (?, 'created', 1, ?)`,
        )
        .run(CAMPAIGN, JSON.stringify({ txHash: 'tx-a', ledgerNumber: 500, eventIndex: 0 }));
      expect(getIndexerCursor()).toEqual({ ledger: 0, eventIndex: 0 });

      const result = processSorobanEvents([created(500, 0, 'tx-a'), pledged(500, 1, 'tx-b')]);

      expect(result.recovered).toBe(1);
      expect(result.committed).toBe(1);
      expect(recordedEvents()).toHaveLength(2);
      expect(getIndexerCursor()).toEqual({ ledger: 500, eventIndex: 1 });
    });

    it('rolls the event back when the cursor cannot be written, then commits it once on retry', async () => {
      const { processSorobanEvents } = await load();
      const db = getDb();
      db.exec(`
        CREATE TRIGGER block_cursor_write BEFORE INSERT ON kv_store
        BEGIN SELECT RAISE(ABORT, 'simulated crash before cursor update'); END;
      `);

      expect(() =>
        processSorobanEvents([created(500, 0, 'tx-a'), pledged(500, 1, 'tx-b')]),
      ).toThrow(/simulated crash/);

      // Neither the event nor the cursor persisted, so nothing is half-applied.
      expect(recordedEvents()).toHaveLength(0);
      expect(getIndexerCursor()).toEqual({ ledger: 0, eventIndex: 0 });

      db.exec(`DROP TRIGGER block_cursor_write`);
      const retry = processSorobanEvents([created(500, 0, 'tx-a'), pledged(500, 1, 'tx-b')]);

      expect(retry.committed).toBe(2);
      expect(recordedEvents()).toHaveLength(2);
      expect(getIndexerCursor()).toEqual({ ledger: 500, eventIndex: 1 });
    });

    it('keeps events committed before a failure and retries only the rest', async () => {
      const { processSorobanEvents } = await load();
      const db = getDb();

      processSorobanEvents([created(500, 0, 'tx-a')]);
      db.exec(`
        CREATE TRIGGER block_events BEFORE INSERT ON campaign_events
        WHEN json_extract(NEW.blockchain_metadata, '$.eventIndex') = 2
        BEGIN SELECT RAISE(ABORT, 'disk error'); END;
      `);

      expect(() =>
        processSorobanEvents([
          created(500, 0, 'tx-a'),
          pledged(500, 1, 'tx-b'),
          pledged(500, 2, 'tx-c'),
          pledged(500, 3, 'tx-d'),
        ]),
      ).toThrow(/disk error/);

      expect(recordedEvents().map((e) => e.eventIndex)).toEqual([0, 1]);
      expect(getIndexerCursor()).toEqual({ ledger: 500, eventIndex: 1 });

      db.exec(`DROP TRIGGER block_events`);
      const retry = processSorobanEvents([
        pledged(500, 2, 'tx-c'),
        pledged(500, 3, 'tx-d'),
      ]);
      expect(retry.committed).toBe(2);
      expect(recordedEvents().map((e) => e.eventIndex)).toEqual([0, 1, 2, 3]);
    });
  });

  describe('observability of cursor outcomes (#1534)', () => {
    it('logs committed outcomes with redacted campaign and transaction references', async () => {
      const { processSorobanEvents } = await load();

      processSorobanEvents([created(500, 0, 'txhash-abcdef-0123456789')]);

      const [entry] = outcomes();
      expect(entry).toMatchObject({
        outcome: 'committed',
        ledger: 500,
        eventIndex: 0,
        campaignRef: 'camp...3456',
        txRef: 'txha...6789',
      });
      expect(JSON.stringify(entry)).not.toContain(CAMPAIGN);
      expect(JSON.stringify(entry)).not.toContain('txhash-abcdef-0123456789');
    });

    it('logs a rejected outcome with a reason and still advances past it', async () => {
      const { processSorobanEvents } = await load();

      const result = processSorobanEvents([pledged(500, 0, 'tx-a', 'unknown-campaign-id-9999')]);

      expect(result.rejected).toBe(1);
      expect(outcomes()[0]).toMatchObject({ outcome: 'rejected', reason: 'unknown_campaign' });
      expect(getIndexerCursor()).toEqual({ ledger: 500, eventIndex: 0 });
    });

    it('logs a pending outcome and the resume position when a restart interrupts a batch', async () => {
      const { processSorobanEvents } = await load();
      const db = getDb();
      db.exec(`
        CREATE TRIGGER block_cursor_write BEFORE INSERT ON kv_store
        BEGIN SELECT RAISE(ABORT, 'worker restart'); END;
      `);

      expect(() => processSorobanEvents([created(500, 0, 'tx-a')])).toThrow();

      expect(outcomes()).toContainEqual(
        expect.objectContaining({ outcome: 'pending', ledger: 500, reason: 'worker restart' }),
      );
      const interrupted = logInfoMock.mock.calls.find(
        ([event]) => event === 'soroban_indexer_batch_interrupted',
      );
      expect(interrupted?.[1]).toMatchObject({ pending: 1, resumeLedger: 0, resumeEventIndex: 0 });
    });

    it('distinguishes recovered events from fresh commits', async () => {
      const { processSorobanEvents } = await load();
      getDb()
        .prepare(
          `INSERT INTO campaign_events (campaign_id, event_type, timestamp, blockchain_metadata)
           VALUES (?, 'created', 1, ?)`,
        )
        .run(CAMPAIGN, JSON.stringify({ txHash: 'tx-a', ledgerNumber: 500, eventIndex: 0 }));

      processSorobanEvents([created(500, 0, 'tx-a')]);

      expect(outcomes()[0]).toMatchObject({
        outcome: 'committed',
        reason: 'recovered_after_restart',
      });
    });
  });
});
