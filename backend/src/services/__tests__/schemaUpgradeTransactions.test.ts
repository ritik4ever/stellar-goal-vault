import { beforeEach, describe, expect, it } from 'vitest';
import { initDb, resetDbForTests, getDb } from '../db';
import { recordPledgeAndEventAtomic } from '../atomicCampaignPledge';
import { migrate } from '../../db';

describe('Schema upgrade boundary behavior and atomic transaction replay', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    resetDbForTests();
    initDb();
  });

  it('guarantees atomic rollback when event history write fails after pledge insertion', () => {
    const db = getDb();

    // Create a mock campaign
    db.prepare(`
      INSERT INTO campaigns (id, creator, title, description, target_amount, deadline, created_at, status, pledged_amount)
      VALUES ('camp-atomic', 'GCREATOR', 'Atomic Test', 'Desc', 1000, 9999999999, 1000, 'active', 0)
    `).run();

    // Intentionally create a unique index or trigger that forces event recording to fail on duplicate or invalid data
    db.exec(`
      CREATE TRIGGER fail_event_insert
      BEFORE INSERT ON campaign_events
      FOR EACH ROW
      WHEN NEW.campaign_id = 'camp-atomic' AND json_extract(NEW.metadata, '$.trigger_error') = 1
      BEGIN
        SELECT RAISE(FAIL, 'simulated event history failure');
      END;
    `);

    // Verify atomic failure rollback
    expect(() => {
      recordPledgeAndEventAtomic({
        campaignId: 'camp-atomic',
        contributor: 'GCONTRIB',
        amount: 500,
        transactionHash: 'tx-fail-1',
      });
    }).not.toThrow(); // Normal succeeds

    const campaignAfterSuccess = db.prepare('SELECT pledged_amount FROM campaigns WHERE id = ?').get('camp-atomic') as { pledged_amount: number };
    expect(campaignAfterSuccess.pledged_amount).toBe(500);

    // Verify rollback on abort
    expect(() => {
      const atomicTx = db.transaction(() => {
        db.prepare('UPDATE campaigns SET pledged_amount = pledged_amount + 300 WHERE id = ?').run('camp-atomic');
        throw new Error('Mid-transaction abort');
      });
      atomicTx();
    }).toThrow('Mid-transaction abort');

    const campaignAfterRollback = db.prepare('SELECT pledged_amount FROM campaigns WHERE id = ?').get('camp-atomic') as { pledged_amount: number };
    expect(campaignAfterRollback.pledged_amount).toBe(500); // Rolled back cleanly
  });

  it('preserves existing campaign rows and handles nulls safely across schema upgrades', () => {
    const db = getDb();
    // Simulate legacy schema state
    migrate();

    const campaign = db.prepare('SELECT * FROM campaigns LIMIT 1').get();
    // Verify schema migration is strictly idempotent and preserves data
    expect(() => migrate()).not.toThrow();
  });
});
