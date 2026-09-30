import { createClient, RedisClientType } from 'redis';
import { LRUCache } from 'lru-cache';
import { config } from '../config';
import { logError, logInfo } from '../logger';

const CACHE_TTL_MS = 30000;
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
  redisClient.on('error', (err) => logError(err, { event: 'redis_client_error' }));
  redisClient.on('connect', () => {
    isRedisConnected = true;
  });
  redisClient.on('disconnect', () => {
    isRedisConnected = false;
  });
  // Fire and forget connect
  redisClient.connect().catch((err) => logError(err, { event: 'redis_connect_error' }));
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
      logError(err, { event: 'redis_get_error', key });
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
      logError(err, { event: 'redis_set_error', key });
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
      logError(err, { event: 'redis_invalidate_error' });
    }
  }
  memoryCache.clear();
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
  }
}
