/**
 * Integration tests confirming that `createCampaignPayloadSchema`
 * uses the SSRF-safe `httpsOnlyUrlSchema` for campaign metadata URLs.
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

describe('createCampaignPayloadSchema metadata', () => {
  it('accepts valid https metadata URLs', () => {
    const result = createCampaignPayloadSchema.safeParse(
      buildPayload({
        imageUrl: 'https://cdn.example.com/banner.png',
        externalLink: 'https://example.com/about',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts campaigns without metadata', () => {
    expect(createCampaignPayloadSchema.safeParse(buildPayload()).success).toBe(true);
  });

  it.each([
    ['http://example.com/banner.png', 'insecure protocol'],
    ['file:///etc/passwd', 'file URL'],
    ['data:image/png;base64,iVBORw0K', 'data URL'],
    ['https://10.0.0.1/banner.png', 'private IPv4 host'],
    ['https://localhost/admin', 'loopback host'],
    ['https://172.20.0.5/x.png', 'private 172.16/12 host'],
    ['https://192.168.1.1/', 'private 192.168/16 host'],
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata host'],
  ])('rejects %s (%s)', (url) => {
    expect(createCampaignPayloadSchema.safeParse(buildPayload({ imageUrl: url })).success).toBe(
      false,
    );
  });
});
