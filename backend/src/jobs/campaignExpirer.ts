import { getDb } from '../services/db';
import { recordEvent } from '../services/eventHistory';
import { logInfo, logError } from '../logger';
import { config } from '../config';

const POLL_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;

interface ExpirableCampaignRow {
  id: string;
  deadline: number;
}

export function expireCampaigns(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const rows = db
    .prepare(
      `SELECT id, deadline FROM campaigns
       WHERE claimed_at IS NULL
         AND failed_at IS NULL
         AND pledged_amount < target_amount
         AND deadline <= ?`,
    )
    .all(now) as ExpirableCampaignRow[];

  if (rows.length === 0) return 0;

  const expire = db.transaction(() => {
    for (const row of rows) {
      db.prepare(`UPDATE campaigns SET failed_at = ? WHERE id = ? AND failed_at IS NULL`).run(
        row.deadline,
        row.id,
      );

      recordEvent(row.id, 'campaign_expired', now, undefined, undefined, {
        deadline: row.deadline,
      });
    }
  });

  expire();
  return rows.length;
}

function tick(): void {
  try {
    const count = expireCampaigns();
    if (count > 0) {
      logInfo(
        'campaign_expirer',
        { message: `Expired ${count} campaign(s)`, count },
        config.logLevel,
      );
    }
  } catch (err) {
    logError(err, { event: 'campaign_expirer_error' }, config.logLevel);
  }
}

function scheduleNext(): void {
  timer = setTimeout(() => {
    tick();
    scheduleNext();
  }, POLL_INTERVAL_MS);
}

export function startCampaignExpirer(): void {
  logInfo(
    'campaign_expirer_started',
    { message: `Campaign expirer started. Polling every ${POLL_INTERVAL_MS / 1000}s.`, pollIntervalSeconds: POLL_INTERVAL_MS / 1000 },
    config.logLevel,
  );
  scheduleNext();
}

export function stopCampaignExpirer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
