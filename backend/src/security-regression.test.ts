import request from 'supertest';
import { describe, it, expect } from 'vitest';

// Set env before importing app so body parser limits and test DB are applied
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.SOROBAN_RPC_URL = 'http://localhost:8000';
// Make the JSON body limit small so we can trigger the 413 path reliably
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

describe('Security regression — request input handling', () => {
  it('rejects attempts to bypass JSON validation by sending JSON as text/plain', async () => {
    const payload = validCampaignPayload();
    const raw = JSON.stringify(payload);

    const res = await request(app)
      .post('/api/campaigns')
      .set('Content-Type', 'text/plain')
      .send(raw);

    expect(res.status).toBe(400);
    // validateBody now uses the structured error envelope via next(AppError)
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('rejects create campaign when metadata.imageUrl uses plain http (protocol enforcement)', async () => {
    const payload = validCampaignPayload({
      metadata: { imageUrl: 'http://127.0.0.1/unsafe.png' },
    });

    const res = await request(app).post('/api/campaigns').send(payload);

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

    const res = await request(app).post('/api/campaigns').send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const messages = res.body.error.details.map((d: any) => String(d.message).toLowerCase());
    expect(messages.some((m: string) => m.includes('private') || m.includes('loopback'))).toBe(true);
  });

  it('returns 413 Payload Too Large for oversized request bodies', async () => {
    // Build a payload with a very large description to exceed the 1kb limit
    const largeDescription = 'A'.repeat(2 * 1024);
    const payload = validCampaignPayload({ description: largeDescription });

    const res = await request(app).post('/api/campaigns').send(payload);

    expect(res.status).toBe(413);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'PAYLOAD_TOO_LARGE');
  });
});
