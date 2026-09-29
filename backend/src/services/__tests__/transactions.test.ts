/**
 * Transaction boundary tests for issue #875
 * [DB] Make transactions explicit in pledges persistence
 *
 * Verifies that multi-step write operations in campaignStore are atomic:
 *   - refundContributor: pledge rows + campaign balance + event must all commit
 *     or all roll back together.
 *   - createCampaign: campaign row + "created" event must commit or roll back
 *     together.
 *
 * Strategy: We inject a fault by temporarily replacing the `recordEvent`
 * export on the eventHistory module at the SQLite level so that the event
 * INSERT throws inside the transaction.  We then assert that the previously
 * executed pledge/campaign mutations were rolled back and that retrying the
 * operation with the fault removed succeeds cleanly.
 */

import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

const TEST_DB_PATH = path.join(
  '/tmp',
  `stellar-goal-vault-transactions-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

// ── Type imports ──────────────────────────────────────────────────────────────
type CampaignStoreModule = typeof import('../campaignStore');
type DbModule = typeof import('../db');
type EventHistoryModule = typeof import('../eventHistory');

// ── Module references populated in beforeAll ──────────────────────────────────
let createCampaign: CampaignStoreModule['createCampaign'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let addPledge: CampaignStoreModule['addPledge'];
let getCampaign: CampaignStoreModule['getCampaign'];
let getPledges: CampaignStoreModule['getPledges'];
let refundContributor: CampaignStoreModule['refundContributor'];
let getDb: DbModule['getDb'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];
let eventHistoryModule: EventHistoryModule;

// ── Test constants ────────────────────────────────────────────────────────────
const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;
const future = (offset = 86400) => Math.floor(Date.now() / 1000) + offset;
const past = (offset = 86400) => Math.floor(Date.now() / 1000) - offset;

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,
    initCampaignStore,
    addPledge,
    getCampaign,
    getPledges,
    refundContributor,
  } = await import('../campaignStore'));
  ({ getDb } = await import('../db'));
  ({ getCampaignHistory } = await import('../eventHistory'));
  eventHistoryModule = await import('../eventHistory');

  initCampaignStore();
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM notifications`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

// ── Helper: create a failed campaign with one pledge ─────────────────────────
function createFailedCampaignWithPledge() {
  const deadline = past(100); // already expired
  const campaign = createCampaign({
    creator: CREATOR,
    title: 'Refund Test Campaign',
    description: 'Campaign used to test refund transaction atomicity.',
    assetCode: 'USDC',
    targetAmount: 1000,
    deadline,
  });

  // Manually insert a pledge so the campaign has something to refund.
  // We skip addPledge here because the campaign deadline is already past; we
  // write directly to the DB to set up the fixture.
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(campaign.id, CONTRIBUTOR, 50, 'USDC', now - 200);
  db.prepare(`UPDATE campaigns SET pledged_amount = 50 WHERE id = ?`).run(campaign.id);

  return campaign;
}

// ─────────────────────────────────────────────────────────────────────────────
// refundContributor transaction atomicity
// ─────────────────────────────────────────────────────────────────────────────
describe('refundContributor — transaction atomicity', () => {
  it('commits pledge rows, campaign balance, and event in a single step', () => {
    const campaign = createFailedCampaignWithPledge();
    const db = getDb();

    const before = getCampaign(campaign.id)!;
    expect(before.pledgedAmount).toBe(50);

    const result = refundContributor(campaign.id, CONTRIBUTOR);

    // Pledge row must be marked refunded
    const pledges = getPledges(campaign.id);
    expect(pledges).toHaveLength(1);
    expect(pledges[0].refundedAt).toBeDefined();

    // Campaign balance must be decremented
    const after = getCampaign(campaign.id)!;
    expect(after.pledgedAmount).toBe(0);

    // Event must be recorded
    const history = getCampaignHistory(campaign.id);
    const refundEvent = history.find((e) => e.eventType === 'refunded');
    expect(refundEvent).toBeDefined();
    expect(refundEvent?.amount).toBe(50);

    // Return value must match
    expect(result.refundedAmount).toBe(50);
  });

  it('rolls back pledge and campaign changes when the event insert fails mid-transaction', () => {
    const campaign = createFailedCampaignWithPledge();
    const db = getDb();

    const snapshotPledgedAmount = getCampaign(campaign.id)!.pledgedAmount;

    // Inject a fault: make recordEvent throw after the pledge/campaign UPDATEs
    // have executed but before the transaction is committed.
    const originalRecordEvent = eventHistoryModule.recordEvent;
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated event insert failure');
    });

    // The operation must surface the injected error to the caller.
    expect(() => refundContributor(campaign.id, CONTRIBUTOR)).toThrow(
      'Simulated event insert failure',
    );

    // ── Assert no partial state was persisted ────────────────────────────────

    // Pledge row must still be un-refunded (rolled back)
    const pledgesAfterFailure = getPledges(campaign.id);
    expect(pledgesAfterFailure).toHaveLength(1);
    expect(pledgesAfterFailure[0].refundedAt).toBeUndefined();

    // Campaign balance must be unchanged (rolled back)
    const campaignAfterFailure = getCampaign(campaign.id)!;
    expect(campaignAfterFailure.pledgedAmount).toBe(snapshotPledgedAmount);

    // No event must exist for this attempted refund (rolled back)
    const historyAfterFailure = getCampaignHistory(campaign.id);
    const refundEvents = historyAfterFailure.filter((e) => e.eventType === 'refunded');
    expect(refundEvents).toHaveLength(0);

    // ── Verify retry succeeds after the fault is removed ────────────────────
    vi.restoreAllMocks();
    const retryResult = refundContributor(campaign.id, CONTRIBUTOR);

    expect(retryResult.refundedAmount).toBe(50);

    const pledgesAfterRetry = getPledges(campaign.id);
    expect(pledgesAfterRetry[0].refundedAt).toBeDefined();

    expect(getCampaign(campaign.id)!.pledgedAmount).toBe(0);

    const historyAfterRetry = getCampaignHistory(campaign.id);
    expect(historyAfterRetry.filter((e) => e.eventType === 'refunded')).toHaveLength(1);
  });

  it('rolls back when the campaign balance UPDATE fails mid-transaction', () => {
    const campaign = createFailedCampaignWithPledge();
    const db = getDb();

    // Inject a fault at the DB layer: make the prepare().run() for the campaign
    // UPDATE throw after the pledges UPDATE has already executed inside the tx.
    const originalPrepare = db.prepare.bind(db);
    let callCount = 0;
    const prepareSpy = vi
      .spyOn(db, 'prepare')
      .mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('UPDATE campaigns SET pledged_amount = pledged_amount -')) {
          callCount++;
          if (callCount === 1) {
            // Wrap the real run() to throw once
            const originalRun = stmt.run.bind(stmt);
            stmt.run = (...args: Parameters<typeof stmt.run>) => {
              throw new Error('Simulated campaign balance update failure');
            };
          }
        }
        return stmt;
      });

    expect(() => refundContributor(campaign.id, CONTRIBUTOR)).toThrow(
      'Simulated campaign balance update failure',
    );

    prepareSpy.mockRestore();

    // Pledge row must still be un-refunded (rolled back)
    const pledges = getPledges(campaign.id);
    expect(pledges[0].refundedAt).toBeUndefined();

    // Campaign balance must be unchanged (rolled back)
    expect(getCampaign(campaign.id)!.pledgedAmount).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCampaign transaction atomicity
// ─────────────────────────────────────────────────────────────────────────────
describe('createCampaign — transaction atomicity', () => {
  it('commits campaign row and "created" event in a single step', () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: 'Atomic Campaign',
      description: 'Campaign to test createCampaign atomicity.',
      assetCode: 'USDC',
      targetAmount: 500,
      deadline: future(),
    });

    // Campaign row must exist
    const stored = getCampaign(campaign.id);
    expect(stored).toBeDefined();
    expect(stored?.title).toBe('Atomic Campaign');

    // "created" event must exist
    const history = getCampaignHistory(campaign.id);
    const createdEvent = history.find((e) => e.eventType === 'created');
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.actor).toBe(CREATOR);
  });

  it('rolls back the campaign INSERT when the event insert fails mid-transaction', () => {
    // Spy on recordEvent so the first call (from createCampaign) throws.
    vi.spyOn(eventHistoryModule, 'recordEvent').mockImplementationOnce(() => {
      throw new Error('Simulated event insert failure during createCampaign');
    });

    // createCampaign must propagate the injected error.
    expect(() =>
      createCampaign({
        creator: CREATOR,
        title: 'Doomed Campaign',
        description: 'This campaign should not persist.',
        assetCode: 'USDC',
        targetAmount: 300,
        deadline: future(),
      }),
    ).toThrow('Simulated event insert failure during createCampaign');

    // The DB must contain no campaigns (the INSERT was rolled back).
    const db = getDb();
    const count = (
      db.prepare(`SELECT COUNT(*) AS c FROM campaigns WHERE title = 'Doomed Campaign'`).get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(0);

    // ── Verify retry succeeds ────────────────────────────────────────────────
    vi.restoreAllMocks();
    const retryCampaign = createCampaign({
      creator: CREATOR,
      title: 'Retry Campaign',
      description: 'Retried after fault removed.',
      assetCode: 'USDC',
      targetAmount: 300,
      deadline: future(),
    });

    expect(getCampaign(retryCampaign.id)).toBeDefined();
    expect(getCampaignHistory(retryCampaign.id).find((e) => e.eventType === 'created')).toBeDefined();
  });
});
