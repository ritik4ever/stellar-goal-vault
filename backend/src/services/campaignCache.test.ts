import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCampaignCacheKey,
  getCampaignCacheEntry,
  setCampaignCacheEntry,
  invalidateCampaignCache,
} from './campaignCache';

describe('campaignCache', () => {
  beforeEach(async () => {
    await invalidateCampaignCache();
  });

  it('returns undefined for a key that has not been set', async () => {
    expect(await getCampaignCacheEntry('campaigns:missing')).toBeUndefined();
  });

  it('returns the stored body after a set', async () => {
    const key = buildCampaignCacheKey('status=open');
    const body = JSON.stringify({ data: [], pagination: {} });
    await setCampaignCacheEntry(key, body);
    expect(await getCampaignCacheEntry(key)).toBe(body);
  });

  it('buildCampaignCacheKey namespaces the key correctly', () => {
    expect(buildCampaignCacheKey('foo=bar')).toBe('campaigns:list:foo=bar');
    expect(buildCampaignCacheKey('')).toBe('campaigns:list:');
  });

  it('stores separate entries for different query strings', async () => {
    const k1 = buildCampaignCacheKey('status=open');
    const k2 = buildCampaignCacheKey('status=funded');
    await setCampaignCacheEntry(k1, 'open-response');
    await setCampaignCacheEntry(k2, 'funded-response');
    expect(await getCampaignCacheEntry(k1)).toBe('open-response');
    expect(await getCampaignCacheEntry(k2)).toBe('funded-response');
  });

  it('invalidateCampaignCache clears all entries', async () => {
    await setCampaignCacheEntry(buildCampaignCacheKey('a=1'), 'body-a');
    await setCampaignCacheEntry(buildCampaignCacheKey('b=2'), 'body-b');

    await invalidateCampaignCache();

    expect(await getCampaignCacheEntry(buildCampaignCacheKey('a=1'))).toBeUndefined();
  });

  it('overwrites an existing entry for the same key', async () => {
    const key = buildCampaignCacheKey('page=1');
    await setCampaignCacheEntry(key, 'first');
    await setCampaignCacheEntry(key, 'second');
    expect(await getCampaignCacheEntry(key)).toBe('second');
  });
});
