import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCampaignCacheKey,
  getCampaignCacheEntry,
  setCampaignCacheEntry,
  invalidateCampaignCache,
  getCampaignCacheSize,
} from './campaignCache';

describe('campaignCache', () => {
  beforeEach(() => {
    invalidateCampaignCache();
  });

  it('returns undefined for a key that has not been set', () => {
    expect(getCampaignCacheEntry('campaigns:missing')).toBeUndefined();
  });

  it('returns the stored body after a set', () => {
    const key = buildCampaignCacheKey('status=open');
    const body = JSON.stringify({ data: [], pagination: {} });
    setCampaignCacheEntry(key, body);
    expect(getCampaignCacheEntry(key)).toBe(body);
  });

  it('buildCampaignCacheKey namespaces the key correctly', () => {
    expect(buildCampaignCacheKey('foo=bar')).toBe('campaigns:foo=bar');
    expect(buildCampaignCacheKey('')).toBe('campaigns:');
  });

  it('stores separate entries for different query strings', () => {
    const k1 = buildCampaignCacheKey('status=open');
    const k2 = buildCampaignCacheKey('status=funded');
    setCampaignCacheEntry(k1, 'open-response');
    setCampaignCacheEntry(k2, 'funded-response');
    expect(getCampaignCacheEntry(k1)).toBe('open-response');
    expect(getCampaignCacheEntry(k2)).toBe('funded-response');
  });

  it('invalidateCampaignCache clears all entries', () => {
    setCampaignCacheEntry(buildCampaignCacheKey('a=1'), 'body-a');
    setCampaignCacheEntry(buildCampaignCacheKey('b=2'), 'body-b');
    expect(getCampaignCacheSize()).toBe(2);

    invalidateCampaignCache();

    expect(getCampaignCacheSize()).toBe(0);
    expect(getCampaignCacheEntry(buildCampaignCacheKey('a=1'))).toBeUndefined();
  });

  it('overwrites an existing entry for the same key', () => {
    const key = buildCampaignCacheKey('page=1');
    setCampaignCacheEntry(key, 'first');
    setCampaignCacheEntry(key, 'second');
    expect(getCampaignCacheEntry(key)).toBe('second');
  });
});
