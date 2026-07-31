import { LRUCache } from 'lru-cache';

const CACHE_TTL_MS = 5_000;
const CACHE_MAX_SIZE = Number(process.env.CAMPAIGN_CACHE_MAX_SIZE ?? 100);

// Trending endpoint cache: 10 minutes TTL as per spec
const TRENDING_CACHE_TTL_MS = 10 * 60 * 1000;
const TRENDING_CACHE_KEY = 'trending:campaigns';

const trendingCache = new LRUCache<string, string>({
  max: 1,
  ttl: TRENDING_CACHE_TTL_MS,
});

export function getTrendingCacheEntry(): string | undefined {
  return trendingCache.get(TRENDING_CACHE_KEY);
}

export function setTrendingCacheEntry(body: string): void {
  trendingCache.set(TRENDING_CACHE_KEY, body);
}

export function invalidateTrendingCache(): void {
  trendingCache.clear();
}

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
