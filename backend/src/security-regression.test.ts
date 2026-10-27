/**
 * Security regression tests for write-route protection and malformed payloads.
 *
 * These are negative tests by design: the request is expected to fail if the
 * boundary is weakened or bypassed. A passing result for a disallowed request
 * indicates the protected boundary was removed.
 */

import request from 'supertest';
import { describe, it, expect } from 'vitest';

// Set env before importing app so the app boots with the intended security guard
// and the body parser limit is active for the malformed-payload checks below.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'production';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.SOROBAN_RPC_URL = 'https://horizon.example.com';
process.env.SOROBAN_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.API_KEYS = 'prod-write-key';
process.env.ALLOWED_ORIGINS = 'https://app.example.com';
process.env.MAX_BODY_SIZE = '1kb';

import { app } from './index';

function validCampaignPayload(overrides = {}) {
  return {
    creator: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    title: 'A valid campaign title',
    description: 'A reasonably long description that satisfies the minimum length requirement.',
    acceptedTokens: ['USDC'],
    targetAmount: 100,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe('Security regression — write-route boundary', () => {
  it('rejects create requests without an Authorization header', async () => {
    const res = await request(app).post('/api/campaigns').send(validCampaignPayload());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects create requests that use a malformed or wrong API key', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Token prod-write-key')
      .send(validCampaignPayload());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');

    const invalidKey = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer wrong-key')
      .send(validCampaignPayload());

    expect(invalidKey.status).toBe(403);
    expect(invalidKey.body.success).toBe(false);
    expect(invalidKey.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Security regression — request input handling', () => {
  it('rejects attempts to bypass JSON validation by sending JSON as text/plain', async () => {
    const payload = validCampaignPayload();
    const raw = JSON.stringify(payload);

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer prod-write-key')
      .set('Content-Type', 'text/plain')
      .send(raw);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('rejects create campaign when metadata.imageUrl uses plain http (protocol enforcement)', async () => {
    const payload = validCampaignPayload({
      metadata: { imageUrl: 'http://127.0.0.1/unsafe.png' },
    });

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer prod-write-key')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const messages = res.body.error.details.map((d: any) => String(d.message).toLowerCase());
    expect(messages.some((m: string) => m.includes('https'))).toBe(true);
  });

  it('rejects create campaign when metadata.imageUrl targets a private IP literal', async () => {
    const payload = validCampaignPayload({
      metadata: { imageUrl: 'https://127.0.0.1/secret' },
    });

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer prod-write-key')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const messages = res.body.error.details.map((d: any) => String(d.message).toLowerCase());
    expect(messages.some((m: string) => m.includes('private') || m.includes('loopback'))).toBe(
      true,
    );
  });

  it('returns 413 Payload Too Large for oversized request bodies', async () => {
    const largeDescription = 'A'.repeat(2 * 1024);
    const payload = validCampaignPayload({ description: largeDescription });

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer prod-write-key')
      .send(payload);

    expect(res.status).toBe(413);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'PAYLOAD_TOO_LARGE');
  });

  it('returns 400 for malformed JSON input', async () => {
    const raw = '{"title": "test", '; // Unterminated JSON

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer prod-write-key')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects JSON array instead of object (type coercion bypass)', async () => {
    const payload = [validCampaignPayload()];
    const raw = JSON.stringify(payload);

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer prod-write-key')
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects urlencoded body when JSON is expected', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', 'Bearer prod-write-key')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('title=test&targetAmount=100');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
