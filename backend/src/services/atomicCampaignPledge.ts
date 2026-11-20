import { getDb } from './db';
import { recordEvent, BlockchainMetadata } from './eventHistory';
import { logInfo, logError } from '../logger';
import { config } from '../config';

export interface AtomicPledgeInput {
  campaignId: string;
  contributor: string;
  amount: number;
  transactionHash: string;
  confirmedAt?: number;
}

/**
 * Atomically records a pledge, updates the campaign totals, and records the event history.
 * If any step fails (e.g. event history insertion throws), the entire SQLite transaction
 * rolls back, guaranteeing zero partial writes or accounting drift.
 */
export function recordPledgeAndEventAtomic(input: AtomicPledgeInput): { success: boolean; pledgeId?: number } {
  const db = getDb();
  const confirmedAt = input.confirmedAt ?? Math.floor(Date.now() / 1000);

  const atomicTx = db.transaction(() => {
    // 1. Insert pledge
    const insertStmt = db.prepare(`
      INSERT INTO pledges (campaign_id, contributor, amount, transaction_hash, created_at, status)
      VALUES (?, ?, ?, ?, ?, 'confirmed')
    `);
    const info = insertStmt.run(
      input.campaignId,
      input.contributor,
      input.amount,
      input.transactionHash,
      confirmedAt,
    );
    const pledgeId = Number(info.lastInsertRowid);

    // 2. Update campaign pledged amount
    db.prepare(`
      UPDATE campaigns
      SET pledged_amount = pledged_amount + ?,
          updated_at = ?
      WHERE id = ?
    `).run(input.amount, confirmedAt, input.campaignId);

    // 3. Record event history atomically inside the same transaction
    const blockchainMetadata: BlockchainMetadata = {
      txHash: input.transactionHash,
      source: 'atomic_pledge',
    };

    recordEvent(
      input.campaignId,
      'pledged',
      confirmedAt,
      input.contributor,
      input.amount,
      { pledgeId, atomic: true },
      blockchainMetadata,
    );

    return pledgeId;
  });

  try {
    const pledgeId = atomicTx();
    logInfo('atomic_pledge_committed', { campaignId: input.campaignId, pledgeId }, config.logLevel);
    return { success: true, pledgeId };
  } catch (err) {
    logError(err, { event: 'atomic_pledge_rollback', campaignId: input.campaignId }, config.logLevel);
    throw err;
  }
}
