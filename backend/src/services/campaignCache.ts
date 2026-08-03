import { createClient, RedisClientType } from 'redis';
import { LRUCache } from 'lru-cache';
import { config } from '../config';

const CACHE_TTL_MS = 30_000;
const CACHE_TTL_SECONDS = 30;
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

const memoryCache = new LRUCache<string, CacheEntry>({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL_MS,
});

let redisClient: RedisClientType | null = null;
let isRedisConnected = false;

if (config.redisUrl) {
  redisClient = createClient({ url: config.redisUrl });
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  redisClient.on('connect', () => { isRedisConnected = true; });
  redisClient.on('disconnect', () => { isRedisConnected = false; });
  // Fire and forget connect
  redisClient.connect().catch(console.error);
}

export function buildCampaignCacheKey(queryString: string): string {
  return `campaigns:list:${queryString}`;
}

export function buildCampaignDetailCacheKey(id: string): string {
  return `campaigns:detail:${id}`;
}

export async function getCampaignCacheEntry(key: string): Promise<string | undefined> {
  if (redisClient && isRedisConnected) {
    try {
      const val = await redisClient.get(key);
      if (val !== null) return val;
      return undefined;
    } catch (err) {
      console.error('Redis get error', err);
      // Fallback to memory cache
    }
  }
  return memoryCache.get(key)?.body;
}

export async function setCampaignCacheEntry(key: string, body: string): Promise<void> {
  if (redisClient && isRedisConnected) {
    try {
      await redisClient.set(key, body, { EX: CACHE_TTL_SECONDS });
      return;
    } catch (err) {
      console.error('Redis set error', err);
    }
  }
  memoryCache.set(key, { body });
}

export async function invalidateCampaignCache(): Promise<void> {
  if (redisClient && isRedisConnected) {
    try {
      // Invalidate all campaigns keys.
      const keys = await redisClient.keys('campaigns:*');
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } catch (err) {
      console.error('Redis invalidate error', err);
    }
  }
  memoryCache.clear();
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
  }
}
