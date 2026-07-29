import { logInfo } from "../logger";
import { getDb } from "./db";

export interface NotificationPayload {
  campaignId: string;
  updateId: number;
  creatorAddress: string;
  content: string;
  createdAt: number;
  recipients: string[];
}

export type NotificationHandler = (payload: NotificationPayload) => Promise<void> | void;

const notificationHandlers: NotificationHandler[] = [];

/**
 * Registers a handler for campaign update notifications (useful for tests or custom webhooks/emails).
 */
export function registerNotificationHandler(handler: NotificationHandler): () => void {
  notificationHandlers.push(handler);
  return () => {
    const index = notificationHandlers.indexOf(handler);
    if (index !== -1) {
      notificationHandlers.splice(index, 1);
    }
  };
}

/**
 * Clears all registered notification handlers (useful for unit testing).
 */
export function clearNotificationHandlers(): void {
  notificationHandlers.length = 0;
}

/**
 * Gets unique contributor account IDs for a campaign.
 */
export function getCampaignContributors(campaignId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT contributor FROM pledges WHERE campaign_id = ? AND refunded_at IS NULL`,
    )
    .all(campaignId) as Array<{ contributor: string }>;

  return rows.map((r) => r.contributor);
}

/**
 * Sends notifications (webhook/email) to all contributors of a campaign when a new update is posted.
 */
export async function notifyContributorsOnUpdate(update: {
  id: number;
  campaignId: string;
  creatorAddress: string;
  content: string;
  createdAt: number;
}): Promise<NotificationPayload> {
  const recipients = getCampaignContributors(update.campaignId);

  const payload: NotificationPayload = {
    campaignId: update.campaignId,
    updateId: update.id,
    creatorAddress: update.creatorAddress,
    content: update.content,
    createdAt: update.createdAt,
    recipients,
  };

  logInfo("campaign_update_notification_sent", {
    campaignId: update.campaignId,
    updateId: update.id,
    recipientCount: recipients.length,
    recipients,
  });

  // Dispatch to registered handlers (webhooks, email dispatchers, etc.)
  for (const handler of notificationHandlers) {
    try {
      await handler(payload);
    } catch (err) {
      // Log error but don't prevent update creation
      console.error("Notification handler error:", err);
    }
  }

  // Webhook integration: if WEBHOOK_URL environment variable is set, fire HTTP POST
  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const axios = require("axios");
      await axios.post(webhookUrl, payload, { timeout: 5000 });
    } catch (err) {
      console.error("Failed to deliver update notification webhook:", err);
    }
  }

  return payload;
}
