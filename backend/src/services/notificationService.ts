import { getDb } from './db';

export type NotificationType = 'new_pledge' | 'campaign_funded' | 'refund_available' | 'creator_update';

export interface Notification {
  id: number;
  campaignId: string;
  type: NotificationType;
  title: string;
  body: string;
  targetWallet: string;
  actorWallet?: string;
  isRead: boolean;
  createdAt: number;
}

interface NotificationRow {
  id: number;
  campaign_id: string;
  type: NotificationType;
  title: string;
  body: string;
  target_wallet: string;
  actor_wallet: string | null;
  is_read: number;
  created_at: number;
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    type: row.type,
    title: row.title,
    body: row.body,
    targetWallet: row.target_wallet,
    actorWallet: row.actor_wallet ?? undefined,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

export function createNotification(params: {
  campaignId: string;
  type: NotificationType;
  title: string;
  body: string;
  targetWallet: string;
  actorWallet?: string;
}): Notification {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO notifications (campaign_id, type, title, body, target_wallet, actor_wallet, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    params.campaignId,
    params.type,
    params.title,
    params.body,
    params.targetWallet,
    params.actorWallet ?? null,
    now,
  );
  return {
    id: result.lastInsertRowid as number,
    campaignId: params.campaignId,
    type: params.type,
    title: params.title,
    body: params.body,
    targetWallet: params.targetWallet,
    actorWallet: params.actorWallet,
    isRead: false,
    createdAt: now,
  };
}

export function listNotifications(
  wallet: string,
  options: { limit?: number; offset?: number } = {},
): { data: Notification[]; total: number } {
  const db = getDb();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const countRow = db
    .prepare('SELECT COUNT(*) as total FROM notifications WHERE target_wallet = ?')
    .get(wallet) as { total: number };

  const rows = db
    .prepare(
      'SELECT * FROM notifications WHERE target_wallet = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(wallet, limit, offset) as NotificationRow[];

  return {
    data: rows.map(rowToNotification),
    total: countRow.total,
  };
}

export function getUnreadCount(wallet: string): number {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE target_wallet = ? AND is_read = 0',
    )
    .get(wallet) as { count: number };
  return row.count;
}

export function markAllRead(wallet: string): void {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE target_wallet = ? AND is_read = 0').run(
    wallet,
  );
}

export function getContributorsForCampaign(campaignId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT DISTINCT contributor FROM pledges WHERE campaign_id = ? AND refunded_at IS NULL')
    .all(campaignId) as { contributor: string }[];
  return rows.map((r) => r.contributor);
}
