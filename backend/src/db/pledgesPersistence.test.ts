/**
 * Isolated pledges persistence tests (#876)
 *
 * These tests operate directly against the SQLite layer (better-sqlite3) through
 * the db module — no Express routing, no campaignStore business logic.  They are
 * specifically designed to reproduce failure modes that happy-path API tests
 * and service-layer unit tests cannot catch:
 *
 *  1. DB-level constraints  — NULL required fields, FK violation, UNIQUE
 *     transaction_hash enforcement.
 *  2. Transaction rollback  — a raw db.transaction() that throws mid-way must
 *     leave no partial state.
 *  3. Ordered reads         — pledges must come back newest-first regardless of
 *     insertion order.
 *  4. Edge-case data        — zero, negative, fractional amounts; empty strings;
 *     unicode in contributor/asset_code fields.
 *
 * Patterns followed:
 *  - Unique /tmp DB path per test file (process.pid + Date.now in module scope).
 *  - beforeEach resets the singleton and wipes the file; afterEach does the same
 *    so each test starts from a clean database.
 *  - Imports come from './index' (the db module entry point).
 *  - No mocks — every assertion hits real SQLite behaviour.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb, initDb, resetDbForTests } from './index';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TEST_DB = path.join(
  '/tmp',
  `sgv-pledges-persistence-876-${process.pid}-${Date.now()}.db`,
);

function removeTestDb(dbPath: string = TEST_DB): void {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Seed one campaign row so FK constraints can be satisfied. */
function seedCampaign(db: ReturnType<typeof getDb>, id = 'c1'): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO campaigns (
      id, creator, title, description, accepted_tokens_json,
      target_amount, pledged_amount, deadline, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 'GCREATOR', `Campaign ${id}`, `Desc for ${id}`, '["XLM"]', 1000, 0, now + 86_400, now);
}

/** Insert a pledge directly without going through campaignStore. */
function insertPledge(
  db: ReturnType<typeof getDb>,
  fields: {
    campaignId?: string;
    contributor?: string;
    amount?: number;
    assetCode?: string;
    createdAt?: number;
    transactionHash?: string | null;
    refundedAt?: number | null;
  } = {},
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO pledges
     (campaign_id, contributor, amount, asset_code, created_at, transaction_hash, refunded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    fields.campaignId ?? 'c1',
    fields.contributor ?? 'GCONTRIB',
    fields.amount ?? 100,
    fields.assetCode ?? 'XLM',
    fields.createdAt ?? now,
    fields.transactionHash ?? null,
    fields.refundedAt ?? null,
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDbForTests();
  removeTestDb();
  initDb(TEST_DB);
});

afterEach(() => {
  resetDbForTests();
  removeTestDb();
});

// ===========================================================================
// 1. DB-LEVEL CONSTRAINT ENFORCEMENT
// ===========================================================================

describe('pledges persistence — DB-level constraints (#876)', () => {
  /**
   * Failure mode missed by happy-path tests:
   * The API always validates contributor/assetCode before reaching the DB.
   * A direct INSERT with NULL contributor exposes a schema gap that would
   * silently succeed if NOT NULL were missing from the DDL.
   */
  it('rejects a pledge with NULL contributor (NOT NULL constraint)', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    expect(() => {
      db.prepare(
        `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
         VALUES (?, NULL, ?, ?, ?)`,
      ).run('c1', 100, 'XLM', now);
    }).toThrow(/NOT NULL constraint failed: pledges\.contributor/i);
  });

  it('rejects a pledge with NULL amount (NOT NULL constraint)', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    expect(() => {
      db.prepare(
        `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
         VALUES (?, ?, NULL, ?, ?)`,
      ).run('c1', 'GCONTRIB', 'XLM', now);
    }).toThrow(/NOT NULL constraint failed: pledges\.amount/i);
  });

  it('rejects a pledge with NULL asset_code (NOT NULL constraint)', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    expect(() => {
      db.prepare(
        `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      ).run('c1', 'GCONTRIB', 100, now);
    }).toThrow(/NOT NULL constraint failed: pledges\.asset_code/i);
  });

  it('rejects a pledge with NULL created_at (NOT NULL constraint)', () => {
    const db = getDb();
    seedCampaign(db);

    expect(() => {
      db.prepare(
        `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
         VALUES (?, ?, ?, ?, NULL)`,
      ).run('c1', 'GCONTRIB', 100, 'XLM');
    }).toThrow(/NOT NULL constraint failed: pledges\.created_at/i);
  });

  /**
   * Failure mode missed by happy-path tests:
   * createCampaign always creates the campaign before pledging.  A direct DB
   * INSERT with a non-existent campaign_id exercises the FK path that the API
   * layer never reaches.
   */
  it('rejects a pledge referencing a non-existent campaign (FK constraint)', () => {
    const db = getDb();
    // Do NOT seed a campaign — the FK should fire.
    const now = Math.floor(Date.now() / 1000);

    expect(() => {
      db.prepare(
        `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('does-not-exist', 'GCONTRIB', 100, 'XLM', now);
    }).toThrow(/FOREIGN KEY constraint failed/i);
  });

  /**
   * Failure mode missed by happy-path tests:
   * reconcileOnChainPledge deduplicates by transaction_hash in the application
   * layer.  Without the UNIQUE partial index, a race between two reconcile
   * calls for the same hash could produce two rows silently.  This test
   * exercises the raw DB enforcement that the index provides.
   */
  it('rejects a second pledge with a duplicate non-NULL transaction_hash (UNIQUE partial index)', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);
    const txHash = 'abc123def456';

    // First insert must succeed
    insertPledge(db, { transactionHash: txHash, createdAt: now - 10 });

    // Second insert with same hash must fail
    expect(() =>
      insertPledge(db, { transactionHash: txHash, createdAt: now }),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it('allows multiple pledges with NULL transaction_hash (partial index only covers non-NULL)', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    // Both inserts have NULL transaction_hash — should coexist without error.
    expect(() => {
      insertPledge(db, { transactionHash: null, createdAt: now - 5 });
      insertPledge(db, { transactionHash: null, createdAt: now });
    }).not.toThrow();

    const count = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM pledges WHERE transaction_hash IS NULL`)
        .get() as { n: number }
    ).n;
    expect(count).toBe(2);
  });
});

// ===========================================================================
// 2. TRANSACTION ROLLBACK AT THE RAW DB LEVEL
// ===========================================================================

describe('pledges persistence — transaction rollback (#876)', () => {
  /**
   * Failure mode missed by happy-path tests:
   * The API never rolls back mid-pledge.  This test verifies that SQLite's
   * own ROLLBACK mechanism works correctly when code inside a db.transaction()
   * callback throws — ensuring no partial pledge row or campaign total survives.
   */
  it('rolls back pledge INSERT and campaign balance UPDATE when the transaction throws', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    const balanceBefore = (
      db
        .prepare(`SELECT pledged_amount FROM campaigns WHERE id = 'c1'`)
        .get() as { pledged_amount: number }
    ).pledged_amount;

    expect(() => {
      db.transaction(() => {
        // Step 1: insert pledge row
        db.prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run('c1', 'GCONTRIB', 50, 'XLM', now);

        // Step 2: update campaign total
        db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount + ? WHERE id = ?`).run(
          50,
          'c1',
        );

        // Step 3: simulate an error mid-transaction (e.g. event INSERT failure)
        throw new Error('Simulated failure inside transaction');
      })();
    }).toThrow('Simulated failure inside transaction');

    // Pledge row must not exist
    const pledgeCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM pledges WHERE campaign_id = 'c1'`).get() as { n: number }
    ).n;
    expect(pledgeCount).toBe(0);

    // Campaign balance must be unchanged
    const balanceAfter = (
      db
        .prepare(`SELECT pledged_amount FROM campaigns WHERE id = 'c1'`)
        .get() as { pledged_amount: number }
    ).pledged_amount;
    expect(balanceAfter).toBe(balanceBefore);
  });

  it('rolls back a refund UPDATE when the transaction throws before commit', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    // Seed a pledge and give the campaign a positive balance
    insertPledge(db, { amount: 75, createdAt: now - 20 });
    db.prepare(`UPDATE campaigns SET pledged_amount = 75 WHERE id = 'c1'`).run();

    const pledgeId = (
      db
        .prepare(`SELECT id FROM pledges WHERE campaign_id = 'c1' LIMIT 1`)
        .get() as { id: number }
    ).id;

    expect(() => {
      db.transaction(() => {
        // Step 1: mark pledge refunded
        db.prepare(`UPDATE pledges SET refunded_at = ? WHERE id = ?`).run(now, pledgeId);

        // Step 2: decrement campaign total
        db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount - ? WHERE id = ?`).run(
          75,
          'c1',
        );

        // Step 3: simulate downstream failure (e.g. event write)
        throw new Error('Simulated refund event failure');
      })();
    }).toThrow('Simulated refund event failure');

    // Pledge must still have no refunded_at
    const refundedAt = (
      db
        .prepare(`SELECT refunded_at FROM pledges WHERE id = ?`)
        .get(pledgeId) as { refunded_at: number | null }
    ).refunded_at;
    expect(refundedAt).toBeNull();

    // Campaign balance must be restored
    const balance = (
      db
        .prepare(`SELECT pledged_amount FROM campaigns WHERE id = 'c1'`)
        .get() as { pledged_amount: number }
    ).pledged_amount;
    expect(balance).toBe(75);
  });

  it('allows a retry after a failed transaction to succeed cleanly', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    // First attempt fails
    expect(() => {
      db.transaction(() => {
        insertPledge(db, { amount: 40, createdAt: now - 5 });
        throw new Error('First attempt fails');
      })();
    }).toThrow();

    // No pledge rows should exist
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM pledges`).get() as { n: number }).n,
    ).toBe(0);

    // Retry succeeds without error
    expect(() => {
      db.transaction(() => {
        insertPledge(db, { amount: 40, createdAt: now });
        db.prepare(`UPDATE campaigns SET pledged_amount = pledged_amount + 40 WHERE id = 'c1'`).run();
      })();
    }).not.toThrow();

    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM pledges`).get() as { n: number }).n,
    ).toBe(1);

    const balance = (
      db
        .prepare(`SELECT pledged_amount FROM campaigns WHERE id = 'c1'`)
        .get() as { pledged_amount: number }
    ).pledged_amount;
    expect(balance).toBe(40);
  });
});

// ===========================================================================
// 3. ORDERED READS
// ===========================================================================

describe('pledges persistence — ordered reads (#876)', () => {
  /**
   * Failure mode missed by happy-path tests:
   * The API test fixture inserts pledges in timestamp order and then asserts on
   * the first element.  Without an explicit ORDER BY the results could be in
   * any order — SQLite does not guarantee insertion order. This test inserts
   * out of timestamp order and asserts newest-first.
   */
  it('returns pledges newest-first (created_at DESC, id DESC) regardless of insertion order', () => {
    const db = getDb();
    seedCampaign(db);
    const base = Math.floor(Date.now() / 1000);

    // Insert intentionally out of order
    insertPledge(db, { contributor: 'GALICE', amount: 10, createdAt: base + 30 }); // newest
    insertPledge(db, { contributor: 'GBOB', amount: 20, createdAt: base + 10 }); // middle
    insertPledge(db, { contributor: 'GCAROL', amount: 30, createdAt: base }); // oldest

    const rows = db
      .prepare(
        `SELECT contributor, amount, created_at
         FROM pledges
         WHERE campaign_id = 'c1'
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as Array<{ contributor: string; amount: number; created_at: number }>;

    expect(rows).toHaveLength(3);
    expect(rows[0].contributor).toBe('GALICE'); // newest
    expect(rows[1].contributor).toBe('GBOB'); // middle
    expect(rows[2].contributor).toBe('GCAROL'); // oldest
  });

  it('breaks ties in created_at by descending id so newest-inserted wins', () => {
    const db = getDb();
    seedCampaign(db);
    const sameTs = Math.floor(Date.now() / 1000);

    // Three pledges with the exact same created_at — tie-breaker is id DESC
    insertPledge(db, { contributor: 'G1', amount: 5, createdAt: sameTs });
    insertPledge(db, { contributor: 'G2', amount: 10, createdAt: sameTs });
    insertPledge(db, { contributor: 'G3', amount: 15, createdAt: sameTs });

    const rows = db
      .prepare(
        `SELECT contributor FROM pledges
         WHERE campaign_id = 'c1'
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as Array<{ contributor: string }>;

    // Last inserted (G3, highest id) must appear first
    expect(rows[0].contributor).toBe('G3');
    expect(rows[rows.length - 1].contributor).toBe('G1');
  });

  it('returns only unrefunded pledges when filtering refunded_at IS NULL', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    insertPledge(db, { contributor: 'GALICE', amount: 50, createdAt: now - 20 });
    insertPledge(db, { contributor: 'GBOB', amount: 30, createdAt: now - 10 });
    insertPledge(db, { contributor: 'GCAROL', amount: 20, createdAt: now });

    // Refund Alice's pledge
    db.prepare(
      `UPDATE pledges SET refunded_at = ? WHERE contributor = 'GALICE'`,
    ).run(now);

    const activeRows = db
      .prepare(
        `SELECT contributor FROM pledges
         WHERE campaign_id = 'c1' AND refunded_at IS NULL
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as Array<{ contributor: string }>;

    expect(activeRows).toHaveLength(2);
    expect(activeRows.map((r) => r.contributor)).not.toContain('GALICE');
  });

  it('sums only unrefunded amounts for campaign balance calculation', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    insertPledge(db, { amount: 100, createdAt: now - 30 });
    insertPledge(db, { amount: 200, createdAt: now - 20 });
    insertPledge(db, { amount: 300, createdAt: now - 10 });

    // Refund the first pledge
    db.prepare(
      `UPDATE pledges SET refunded_at = ?
       WHERE campaign_id = 'c1' AND amount = 100`,
    ).run(now);

    const result = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM pledges
         WHERE campaign_id = 'c1' AND refunded_at IS NULL`,
      )
      .get() as { total: number };

    expect(result.total).toBe(500); // 200 + 300
  });
});

// ===========================================================================
// 4. EDGE-CASE DATA
// ===========================================================================

describe('pledges persistence — edge-case data (#876)', () => {
  /**
   * Failure mode missed by happy-path tests:
   * The API validates positive amounts before they reach the DB.  If the DB
   * schema ever loses its NOT NULL on amount, a zero or negative value would
   * silently persist and corrupt campaign totals.  These tests document the
   * current raw schema behaviour.
   */
  it('stores a zero amount at the DB level (schema has no > 0 CHECK on pledges.amount)', () => {
    // This test documents that pledges.amount has NO positive CHECK constraint
    // at the DDL level — validation is enforced by the application layer.
    // If a CHECK were added, this test would catch it.
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    // Zero amount goes in without error (application layer is the guard)
    expect(() =>
      db
        .prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
           VALUES ('c1', 'GCONTRIB', 0, 'XLM', ?)`,
        )
        .run(now),
    ).not.toThrow();

    const stored = db
      .prepare(`SELECT amount FROM pledges WHERE campaign_id = 'c1'`)
      .get() as { amount: number };
    expect(stored.amount).toBe(0);
  });

  it('stores a negative amount at the DB level (no CHECK in schema — app layer guards this)', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    expect(() =>
      db
        .prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
           VALUES ('c1', 'GCONTRIB', -50, 'XLM', ?)`,
        )
        .run(now),
    ).not.toThrow();

    const stored = db
      .prepare(`SELECT amount FROM pledges WHERE campaign_id = 'c1'`)
      .get() as { amount: number };
    expect(stored.amount).toBe(-50);
  });

  it('stores a high-precision fractional amount without loss', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);
    const precise = 123.456789;

    insertPledge(db, { amount: precise, createdAt: now });

    const stored = db
      .prepare(`SELECT amount FROM pledges WHERE campaign_id = 'c1'`)
      .get() as { amount: number };

    // SQLite REAL (IEEE 754 double) should round-trip without truncation at
    // normal pledge precisions.
    expect(stored.amount).toBeCloseTo(precise, 5);
  });

  it('stores and retrieves unicode characters in contributor address field', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);
    const unicodeContributor = 'G\u00e9\u00e0\u00fc\u4e2d\u6587\u6d4b\u8bd5'; // includes non-ASCII

    insertPledge(db, { contributor: unicodeContributor, amount: 10, createdAt: now });

    const row = db
      .prepare(`SELECT contributor FROM pledges WHERE campaign_id = 'c1'`)
      .get() as { contributor: string };

    expect(row.contributor).toBe(unicodeContributor);
  });

  it('stores and retrieves unicode in asset_code field without corruption', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);
    const unicodeAsset = '\u6d4b\u8bd5'; // "测试" (Chinese: "test")

    insertPledge(db, { assetCode: unicodeAsset, amount: 5, createdAt: now });

    const row = db
      .prepare(`SELECT asset_code FROM pledges WHERE campaign_id = 'c1'`)
      .get() as { asset_code: string };

    expect(row.asset_code).toBe(unicodeAsset);
  });

  it('stores an empty string contributor (no length CHECK at DB level)', () => {
    // Documents that contributor has no non-empty CHECK in the pledges DDL
    // (the campaigns table has one, but pledges does not).
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);

    expect(() =>
      db
        .prepare(
          `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
           VALUES ('c1', '', 10, 'XLM', ?)`,
        )
        .run(now),
    ).not.toThrow();

    const stored = db
      .prepare(`SELECT contributor FROM pledges WHERE campaign_id = 'c1'`)
      .get() as { contributor: string };
    expect(stored.contributor).toBe('');
  });

  it('stores a very large amount without overflow (SQLite REAL range)', () => {
    const db = getDb();
    seedCampaign(db);
    const now = Math.floor(Date.now() / 1000);
    const huge = Number.MAX_SAFE_INTEGER; // 9007199254740991

    insertPledge(db, { amount: huge, createdAt: now });

    const stored = db
      .prepare(`SELECT amount FROM pledges WHERE campaign_id = 'c1'`)
      .get() as { amount: number };

    // SQLite stores as IEEE 754 double; value may lose precision beyond 2^53
    // but must not error or produce a wildly different value.
    expect(stored.amount).toBe(huge);
  });

  /**
   * Failure mode missed by happy-path tests:
   * The SUM accounting query used by campaign balance checks must return 0,
   * not NULL, when no active pledges exist.  Without COALESCE, an empty
   * campaign would silently produce a NULL total that could propagate as NaN
   * in JavaScript arithmetic.
   */
  it('SUM of amounts returns 0 (not NULL) on an empty pledges table via COALESCE', () => {
    const db = getDb();
    seedCampaign(db);

    const result = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM pledges
         WHERE campaign_id = 'c1' AND refunded_at IS NULL`,
      )
      .get() as { total: number };

    expect(result.total).toBe(0);
    expect(result.total).not.toBeNull();
  });
});
