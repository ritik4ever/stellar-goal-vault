import { LRUCache } from 'lru-cache';

const CACHE_TTL_MS = 5_000;
const CACHE_MAX_SIZE = Number(process.env.CAMPAIGN_CACHE_MAX_SIZE ?? 100);

interface CacheEntry {
  body: string;
}

const cache = new LRUCache<string, CacheEntry>({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL_MS,
});

export function buildCampaignCacheKey(queryString: string): string {
  return `campaigns:${queryString}`;
}

export function getCampaignCacheEntry(key: string): string | undefined {
  return cache.get(key)?.body;
}

export function setCampaignCacheEntry(key: string, body: string): void {
  cache.set(key, { body });
}

export function invalidateCampaignCache(): void {
  cache.clear();
}

export function getCampaignCacheSize(): number {
  return cache.size;
}
