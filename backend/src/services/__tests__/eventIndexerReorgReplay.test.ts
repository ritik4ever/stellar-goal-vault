import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const CONTRACT = 'CTESTCONTRACT';
const CAMPAIGN = 'campaign-reorg-123456';

interface RpcReply {
  status?: number;
  body: unknown;
}

type IndexerModule = typeof import('../eventIndexer');
type DbModule = typeof import('../db');

let server: http.Server;
let rpcUrl: string;
let reply: RpcReply;
let workDir: string;
let dbPath: string;
let openDb: DbModule | null = null;

function created(ledger: number, eventIndex: number, txHash: string) {
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

function pledged(ledger: number, eventIndex: number, txHash: string) {
  return {
    type: 'contract',
    contract_id: CONTRACT,
    txHash,
    ledger,
    event_index: eventIndex,
    topic: ['CampaignPledged', CAMPAIGN],
    value: { campaign_id: CAMPAIGN, contributor: 'GCONTRIB', amount: 5 },
  };
}

function page(events: unknown[], latestLedger: number): RpcReply {
  return {
    status: 200,
    body: { jsonrpc: '2.0', id: 1, result: { latestLedger, events } },
  };
}

interface Booted {
  indexer: IndexerModule;
  db: DbModule;
  database: ReturnType<DbModule['getDb']>;
}

/**
 * Opens the same on-disk SQLite database through a freshly imported module
 * graph, which is what a process restart looks like to the indexer.
 */
async function boot(): Promise<Booted> {
  vi.resetModules();
  const db = await import('../db');
  openDb?.resetDbForTests();
  openDb = db;
  db.resetDbForTests();
  db.initDb(dbPath);
  const database = db.getDb();
  database
    .prepare(
      `INSERT OR IGNORE INTO campaigns (id, creator, title, description, target_amount, deadline, created_at)
       VALUES (?, 'GCREATOR', 'Title', 'Desc', 100, 9999999999, 1)`,
    )
    .run(CAMPAIGN);
  const indexer = await import('../eventIndexer');
  return { indexer, db, database };
}

function recordedEvents(database: Booted['database']): Array<{
  eventType: string;
  ledger: number;
  eventIndex: number;
  txHash: string;
}> {
  const rows = database
    .prepare(
      `SELECT event_type AS eventType, blockchain_metadata AS m FROM campaign_events
       WHERE json_extract(blockchain_metadata, '$.eventIndex') IS NOT NULL ORDER BY id`,
    )
    .all() as Array<{ eventType: string; m: string }>;
  return rows.map((row) => {
    const meta = JSON.parse(row.m);
    return {
      eventType: row.eventType,
      ledger: meta.ledgerNumber,
      eventIndex: meta.eventIndex,
      txHash: meta.txHash,
    };
  });
}

function cursorIndexer(database: Booted['database']) {
  const row = database
    .prepare(`SELECT value FROM kv_store WHERE key = 'soroban_indexer_cursor'`)
    .get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : { ledger: 0, eventIndex: 0 };
}

describe('indexer reorganization handling: tentative events, replay and failure (#1545)', () => {
  beforeEach(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-vault-indexer-'));
    dbPath = path.join(workDir, 'indexer.db');

    server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
        res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    process.env.DB_PATH = dbPath;
    process.env.SOROBAN_RPC_URL = rpcUrl;
    process.env.CONTRACT_ID = CONTRACT;
    process.env.SOROBAN_INDEXER_CONFIRMATIONS = '2';
    process.env.NO_PROXY = '127.0.0.1';
    process.env.no_proxy = '127.0.0.1';
    reply = page([], 0);
  });

  afterEach(async () => {
    openDb?.resetDbForTests();
    openDb = null;
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    fs.rmSync(workDir, { recursive: true, force: true });
    delete process.env.CONTRACT_ID;
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.SOROBAN_INDEXER_CONFIRMATIONS;
  });

  it('leaves an event pending until it reaches the confirmation depth', async () => {
    const { indexer, database } = await boot();

    // The event is in the chain head itself: a reorg can still replace it.
    reply = page([created(100, 0, 'tx-original')], 100);
    const first = await indexer.pollSorobanEventsOnce();

    expect(first).toMatchObject({ confirmed: 0, tentative: 1, latestLedger: 100 });
    expect(recordedEvents(database)).toHaveLength(0);
    expect(cursorIndexer(database)).toEqual({ ledger: 0, eventIndex: 0 });
  });

  it('persists only the surviving event when the RPC disagrees after a reorg', async () => {
    const { indexer, database } = await boot();

    reply = page([created(100, 0, 'tx-original')], 100);
    await indexer.pollSorobanEventsOnce();
    expect(recordedEvents(database)).toHaveLength(0);

    // Two ledgers later the same position holds a different transaction: the
    // original event never made it into local state, so there is nothing to
    // purge, and the replacement is the only row that exists.
    reply = page([created(100, 0, 'tx-replaced')], 102);
    const settled = await indexer.pollSorobanEventsOnce();

    expect(settled).toMatchObject({ confirmed: 1, tentative: 0 });
    expect(recordedEvents(database)).toEqual([
      { eventType: 'created', ledger: 100, eventIndex: 0, txHash: 'tx-replaced' },
    ]);
    expect(cursorIndexer(database)).toEqual({ ledger: 100, eventIndex: 0 });
  });

  it('replays from the persisted cursor after a restart without duplicating events', async () => {
    const first = await boot();
    reply = page([created(200, 0, 'tx-a')], 202);
    await first.indexer.pollSorobanEventsOnce();
    expect(recordedEvents(first.database)).toHaveLength(1);

    const restarted = await boot();
    // The RPC serves the same page again from the cursor's ledger.
    reply = page([created(200, 0, 'tx-a'), pledged(200, 1, 'tx-b')], 203);
    const replay = await restarted.indexer.pollSorobanEventsOnce();

    // Both events are old enough to persist, but the first one is already at
    // the cursor and is skipped rather than recorded twice.
    expect(replay).toMatchObject({ confirmed: 2, tentative: 0 });
    expect(recordedEvents(restarted.database).map((e) => e.txHash)).toEqual(['tx-a', 'tx-b']);
    expect(cursorIndexer(restarted.database)).toEqual({ ledger: 200, eventIndex: 1 });
  });

  it('does not advance the cursor when the RPC fails and commits the batch on retry', async () => {
    const { indexer, database } = await boot();

    reply = { status: 502, body: 'bad gateway' };
    await expect(indexer.pollSorobanEventsOnce()).rejects.toThrow();

    reply = { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'boom' } } };
    await expect(indexer.pollSorobanEventsOnce()).rejects.toThrow(/malformed RPC response/);

    expect(recordedEvents(database)).toHaveLength(0);
    expect(cursorIndexer(database)).toEqual({ ledger: 0, eventIndex: 0 });

    reply = page([created(300, 0, 'tx-after-retry')], 302);
    const retry = await indexer.pollSorobanEventsOnce();

    expect(retry).toMatchObject({ confirmed: 1 });
    expect(recordedEvents(database)).toHaveLength(1);
    expect(cursorIndexer(database)).toEqual({ ledger: 300, eventIndex: 0 });
  });

  it('rejects a response without latestLedger instead of treating it as an empty page', async () => {
    const { indexer, database } = await boot();

    reply = {
      status: 200,
      body: { jsonrpc: '2.0', id: 1, result: { events: [created(400, 0, 'tx-lost')] } },
    };

    await expect(indexer.pollSorobanEventsOnce()).rejects.toThrow(/missing latestLedger/);
    expect(recordedEvents(database)).toHaveLength(0);
    expect(cursorIndexer(database)).toEqual({ ledger: 0, eventIndex: 0 });
  });

  it('reads the confirmation depth from the environment', async () => {
    vi.resetModules();
    const indexer = await import('../eventIndexer');

    expect(indexer.loadConfirmationDepth({})).toBe(1);
    expect(indexer.loadConfirmationDepth({ SOROBAN_INDEXER_CONFIRMATIONS: '4' })).toBe(4);
    expect(indexer.loadConfirmationDepth({ SOROBAN_INDEXER_CONFIRMATIONS: '2.9' })).toBe(2);
    expect(indexer.loadConfirmationDepth({ SOROBAN_INDEXER_CONFIRMATIONS: '0' })).toBe(1);
    expect(indexer.loadConfirmationDepth({ SOROBAN_INDEXER_CONFIRMATIONS: 'nope' })).toBe(1);
  });
});
