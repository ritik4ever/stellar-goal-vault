import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from './types/errors';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.SOROBAN_RPC_URL = 'http://localhost:8000';

vi.mock('./services/sorobanRpc', () => ({
  ensureSorobanRefundConfig: vi.fn(),
  verifyRefundTransaction: vi.fn(),
}));

import { app } from './index';
import { redactSecretMaterial, redactSensitive } from './logger';
import { verifyRefundTransaction } from './services/sorobanRpc';

// Obviously fake values shaped like a Stellar secret seed and an XDR envelope.
const FAKE_SECRET = `S${'A'.repeat(55)}`;
const FAKE_XDR = `AAAA${'B'.repeat(120)}==`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;

function refundBody() {
  return {
    contributor: CONTRIBUTOR,
    soroban: {
      txHash: 'c'.repeat(64),
      contractId: `C${'A'.repeat(55)}`,
      networkPassphrase: 'Test SDF Network ; September 2015',
      rpcUrl: 'http://localhost:8000',
      walletAddress: CONTRIBUTOR,
    },
  };
}

describe('signing/submission error responses (#936)', () => {
  it('returns a structured code instead of raw exception text for unexpected errors', async () => {
    vi.mocked(verifyRefundTransaction).mockRejectedValueOnce(
      new Error(`signer crashed with seed ${FAKE_SECRET} while handling ${FAKE_XDR}`),
    );

    const res = await request(app).post('/api/campaigns/1/refund').send(refundBody());

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(res.body.error.message).toBe('An unexpected error occurred');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(FAKE_SECRET);
    expect(raw).not.toContain(FAKE_XDR);
    expect(raw).not.toContain('signer crashed');
  });

  it('keeps application error codes and their authored messages', async () => {
    vi.mocked(verifyRefundTransaction).mockRejectedValueOnce(
      new AppError(
        'Unable to verify the Soroban refund transaction right now.',
        502,
        'SOROBAN_RPC_UNAVAILABLE',
      ),
    );

    const res = await request(app).post('/api/campaigns/1/refund').send(refundBody());

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({
      code: 'SOROBAN_RPC_UNAVAILABLE',
      message: 'Unable to verify the Soroban refund transaction right now.',
    });
  });

  it('does not echo the raw request body for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/campaigns/1/refund')
      .set('Content-Type', 'application/json')
      .send(`{"secret": "${FAKE_SECRET}",`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_JSON',
      message: 'Request body is not valid JSON.',
    });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_SECRET);
  });
});

describe('secret material redaction in logs (#936)', () => {
  it('redacts Stellar secret seeds and XDR envelopes from free text', () => {
    const redacted = redactSecretMaterial(`seed=${FAKE_SECRET} envelope=${FAKE_XDR}`);

    expect(redacted).toBe('seed=[REDACTED_SECRET] envelope=[REDACTED_XDR]');
  });

  it('leaves public keys and transaction hashes intact', () => {
    const text = `account ${CONTRIBUTOR} tx ${'c'.repeat(64)}`;

    expect(redactSecretMaterial(text)).toBe(text);
  });

  it('applies to nested string values in log payloads', () => {
    const redacted = redactSensitive({ err: { message: `bad key ${FAKE_SECRET}` } });

    expect(JSON.stringify(redacted)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(redacted)).toContain('[REDACTED_SECRET]');
  });
});
