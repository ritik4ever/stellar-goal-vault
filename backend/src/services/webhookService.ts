import crypto from 'crypto';
import axios from 'axios';
import { getDb } from './db';
import { config } from '../config';
import { logError, logInfo } from '../logger';

export type WebhookEvent =
  | 'campaign_funded'
  | 'campaign_failed'
  | 'vault_claimed'
  | 'pledge_refunded';

export interface WebhookPayload {
  event: WebhookEvent;
  campaign_id: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface DeadLetterEntry {
  id: number;
  event: string;
  campaign_id: string;
  payload: string;
  error_message: string | null;
  failed_at: number;
  attempts: number;
}

export interface WebhookDispatchOptions {
  webhookUrl?: string;
  webhookSecret?: string;
  maxRetries?: number;
  initialDelayMs?: number;
}

/**
 * Computes an HMAC-SHA256 signature for the given payload string using the secret key.
 */
export function generateHmacSignature(payloadString: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

/**
 * Verifies an HMAC-SHA256 signature against a raw payload string and secret key.
 * Handles both raw hex digests and 'sha256=' prefixed headers.
 */
export function verifyWebhookSignature(
  payloadString: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }
  const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const expectedSignature = generateHmacSignature(payloadString, secret);

  try {
    const signatureBuffer = Buffer.from(cleanSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Persists a failed webhook delivery attempt to the dead-letter queue table.
 */
function recordDeadLetter(
  event: string,
  campaignId: string,
  payload: string,
  errorMessage: string,
  attempts: number,
): void {
  try {
    const db = getDb();
    const failedAt = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO webhook_dead_letter_queue (event, campaign_id, payload, error_message, failed_at, attempts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(event, campaignId, payload, errorMessage, failedAt, attempts);

    logError(
      new Error(`Webhook delivery failed after ${attempts} attempts: ${errorMessage}`),
      { event: 'webhook_dead_letter_enqueued', campaignId, webhookEvent: event },
      config.logLevel,
    );
  } catch (err) {
    logError(err, { event: 'webhook_dlq_insert_error', campaignId }, config.logLevel);
  }
}

/**
 * Dispatches a campaign status change webhook POST request to the configured WEBHOOK_URL.
 * Retries up to 5 times with exponential backoff before sending to the Dead-Letter Queue.
 */
export async function dispatchWebhook(
  event: WebhookEvent,
  campaignId: string,
  data: Record<string, unknown>,
  options?: WebhookDispatchOptions,
): Promise<boolean> {
  const webhookUrl = options?.webhookUrl ?? config.webhookUrl ?? process.env.WEBHOOK_URL ?? '';
  const webhookSecret =
    options?.webhookSecret ?? config.webhookSecret ?? process.env.WEBHOOK_SECRET ?? '';

  if (!webhookUrl) {
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload: WebhookPayload = {
    event,
    campaign_id: campaignId,
    timestamp,
    data,
  };

  const payloadString = JSON.stringify(payload);
  const signature = webhookSecret ? generateHmacSignature(payloadString, webhookSecret) : '';

  const maxRetries = options?.maxRetries ?? 5;
  const initialDelayMs = options?.initialDelayMs ?? 100;

  let attempt = 0;
  let lastErrorMessage = '';

  while (attempt <= maxRetries) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (signature) {
        headers['X-GoalVault-Signature'] = signature;
      }

      const response = await axios.post(webhookUrl, payloadString, {
        headers,
        timeout: 4000,
      });

      if (response.status >= 200 && response.status < 300) {
        logInfo(
          'webhook_delivered',
          { event, campaignId, attempt: attempt + 1, status: response.status },
          config.logLevel,
        );
        return true;
      }

      lastErrorMessage = `Server responded with status ${response.status}`;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        lastErrorMessage = err.message || `Axios error: ${err.code}`;
      } else if (err instanceof Error) {
        lastErrorMessage = err.message;
      } else {
        lastErrorMessage = String(err);
      }
    }

    attempt++;
    if (attempt <= maxRetries) {
      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  recordDeadLetter(event, campaignId, payloadString, lastErrorMessage, attempt);
  return false;
}

/**
 * Returns all dead-letter queue records, sorted by most recent first.
 */
export function getDeadLetterQueue(limit = 50): DeadLetterEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, event, campaign_id, payload, error_message, failed_at, attempts
       FROM webhook_dead_letter_queue
       ORDER BY failed_at DESC, id DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    event: string;
    campaign_id: string;
    payload: string;
    error_message: string | null;
    failed_at: number;
    attempts: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    campaign_id: row.campaign_id,
    payload: row.payload,
    error_message: row.error_message,
    failed_at: row.failed_at,
    attempts: row.attempts,
  }));
}

/**
 * Clears all records from the dead-letter queue.
 */
export function clearDeadLetterQueue(): void {
  const db = getDb();
  db.prepare(`DELETE FROM webhook_dead_letter_queue`).run();
}

/**
 * Retries delivering a dead-letter queue entry by ID. If successful, removes it from DLQ.
 */
export async function retryDeadLetter(id: number, webhookUrlOverride?: string): Promise<boolean> {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM webhook_dead_letter_queue WHERE id = ?`)
    .get(id) as DeadLetterEntry | undefined;

  if (!row) {
    return false;
  }

  const payload: WebhookPayload = JSON.parse(row.payload);
  const success = await dispatchWebhook(
    payload.event,
    payload.campaign_id,
    payload.data,
    { webhookUrl: webhookUrlOverride, maxRetries: 1 },
  );

  if (success) {
    db.prepare(`DELETE FROM webhook_dead_letter_queue WHERE id = ?`).run(id);
  }

  return success;
}
