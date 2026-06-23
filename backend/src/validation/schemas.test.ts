/**
 * Integration tests confirming that `createCampaignPayloadSchema`
 * uses the SSRF-safe `httpsOnlyUrlSchema` for `imageUrl` and
 * `externalLink`. These tests are intentionally focused — full
 * lifecycle coverage lives in `api.test.ts` and
 * `pledgesEndpoint.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { createCampaignPayloadSchema } from './schemas';

const CREATOR = `G${'A'.repeat(55)}`;
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 86400;

function buildPayload(metadata?: Record<string, unknown>) {
  return {
    creator: CREATOR,
    title: 'Save the oceans',
    description: 'A long-form description that meets the 20-character minimum.',
    acceptedTokens: ['USDC'],
    targetAmount: 100,
    deadline: FUTURE_DEADLINE,
    ...(metadata ? { metadata } : {}),
  };
}

describe('createCampaignPayloadSchema metadata (issue #308)', () => {
  it('accepts a valid https imageUrl and externalLink', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({
        imageUrl: 'https://cdn.example.com/banner.png',
        externalLink: 'https://example.com/about',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a campaign without metadata at all', () => {
    const result = createCampaignPayloadSchema.safeParse(buildPayload());
    expect(result.success).toBe(true);
  });

  it('rejects an http:// image URL', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({ imageUrl: 'http://example.com/banner.png' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a file:// image URL', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({ imageUrl: 'file:///etc/passwd' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a data: URI image', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({ imageUrl: 'data:image/png;base64,iVBORw0K' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a private IPv4 host in imageUrl', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({ imageUrl: 'https://10.0.0.1/banner.png' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a loopback host in externalLink', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({ externalLink: 'https://localhost/admin' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a 172.16/12 IPv4 host in imageUrl', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({ imageUrl: 'https://172.20.0.5/x.png' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a 192.168/16 IPv4 host in externalLink', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({ externalLink: 'https://192.168.1.1/' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an AWS IMDS link in externalLink', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({
        externalLink: 'https://169.254.169.254/latest/meta-data/',
      }),
    );
    expect(result.success).toBe(false);
  });
});
