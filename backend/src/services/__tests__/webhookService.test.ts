import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { initDb, resetDbForTests, getDb } from '../db';
import {
  dispatchWebhook,
  generateHmacSignature,
  verifyWebhookSignature,
  getDeadLetterQueue,
  clearDeadLetterQueue,
  retryDeadLetter,
} from '../webhookService';

vi.mock('axios');

describe('webhookService', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    resetDbForTests();
    initDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDbForTests();
  });

  describe('HMAC Signature', () => {
    it('generates reproducible HMAC-SHA256 hex signatures', () => {
      const payload = '{"event":"campaign_funded","campaign_id":"1"}';
      const secret = 'my-secret-key';
      const sig1 = generateHmacSignature(payload, secret);
      const sig2 = generateHmacSignature(payload, secret);

      expect(sig1).toHaveLength(64);
      expect(sig1).toBe(sig2);
    });

    it('verifies valid HMAC signatures with hex or sha256= prefix', () => {
      const payload = '{"event":"vault_claimed"}';
      const secret = 'test-secret';
      const sig = generateHmacSignature(payload, secret);

      expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
      expect(verifyWebhookSignature(payload, `sha256=${sig}`, secret)).toBe(true);
      expect(verifyWebhookSignature(payload, 'invalid-signature', secret)).toBe(false);
      expect(verifyWebhookSignature(payload, sig, 'wrong-secret')).toBe(false);
    });
  });

  describe('dispatchWebhook', () => {
    it('returns false immediately if no webhook URL is configured', async () => {
      const result = await dispatchWebhook('campaign_funded', '101', { amount: 100 }, { webhookUrl: '' });
      expect(result).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('sends POST request with X-GoalVault-Signature header when secret is provided', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: 'OK' });

      const result = await dispatchWebhook(
        'campaign_funded',
        '101',
        { amount: 100 },
        { webhookUrl: 'https://example.com/webhook', webhookSecret: 'secret123' },
      );

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(1);

      const [url, body, config] = vi.mocked(axios.post).mock.calls[0];
      expect(url).toBe('https://example.com/webhook');

      const parsedBody = JSON.parse(body as string);
      expect(parsedBody.event).toBe('campaign_funded');
      expect(parsedBody.campaign_id).toBe('101');

      const signature = config?.headers?.['X-GoalVault-Signature'];
      expect(signature).toBeDefined();
      expect(verifyWebhookSignature(body as string, signature as string, 'secret123')).toBe(true);
    });

    it('retries up to maxRetries on HTTP failure and records to DLQ on final failure', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('Connection refused'));

      const result = await dispatchWebhook(
        'pledge_refunded',
        '102',
        { contributor: 'GABC' },
        {
          webhookUrl: 'https://example.com/webhook',
          maxRetries: 2,
          initialDelayMs: 1,
        },
      );

      expect(result).toBe(false);
      expect(axios.post).toHaveBeenCalledTimes(3); // Initial attempt + 2 retries

      const dlq = getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].event).toBe('pledge_refunded');
      expect(dlq[0].campaign_id).toBe('102');
      expect(dlq[0].attempts).toBe(3);
    });
  });

  describe('Dead-Letter Queue Management', () => {
    it('stores, lists, retries, and clears dead-letter queue items', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('500 Server Error'));

      await dispatchWebhook(
        'vault_claimed',
        '103',
        { creator: 'GCREATOR' },
        { webhookUrl: 'https://example.com/webhook', maxRetries: 0 },
      );

      let dlq = getDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      const entryId = dlq[0].id;

      // Successful retry
      vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: 'OK' });
      const retryResult = await retryDeadLetter(entryId, 'https://example.com/webhook');
      expect(retryResult).toBe(true);

      dlq = getDeadLetterQueue();
      expect(dlq).toHaveLength(0);

      // Populate again and test clear
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('500 Error'));
      await dispatchWebhook('campaign_failed', '104', {}, { webhookUrl: 'https://example.com/webhook', maxRetries: 0 });
      expect(getDeadLetterQueue()).toHaveLength(1);

      clearDeadLetterQueue();
      expect(getDeadLetterQueue()).toHaveLength(0);
    });
  });
});
