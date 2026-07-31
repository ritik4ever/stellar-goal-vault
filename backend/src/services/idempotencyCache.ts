import { LRUCache } from 'lru-cache';
import { getCacheValue, setCacheValue, isCacheAvailable } from './cache';

const IDEMPOTENCY_TTL_SECONDS = 86_400;

const MAX_CACHE_SIZE = Number(process.env.IDEMPOTENCY_CACHE_MAX_SIZE ?? 1000);

interface IdempotencyCacheEntry {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

const memoryCache = new LRUCache<string, IdempotencyCacheEntry>({
  max: MAX_CACHE_SIZE,
  ttl: IDEMPOTENCY_TTL_SECONDS * 1000,
});

export function buildIdempotencyCacheKey(
  apiKey: string,
  campaignId: string,
  idempotencyKey: string,
): string {
  return `idempotency:${apiKey}:${campaignId}:${idempotencyKey}`;
}

export async function getIdempotencyCacheEntry(
  key: string,
): Promise<IdempotencyCacheEntry | null> {
  if (isCacheAvailable()) {
    const cached = await getCacheValue(key);
    if (cached) {
      return JSON.parse(cached) as IdempotencyCacheEntry;
    }
  }

  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    return memoryEntry;
  }

  return null;
}

export async function setIdempotencyCacheEntry(
  key: string,
  entry: IdempotencyCacheEntry,
): Promise<void> {
  const serialized = JSON.stringify(entry);

  if (isCacheAvailable()) {
    await setCacheValue(key, serialized, IDEMPOTENCY_TTL_SECONDS).catch(() => {
      // Silently fail Redis writes; memory cache still works
    });
  }

  memoryCache.set(key, entry);
}

export function clearIdempotencyCache(): void {
  memoryCache.clear();
}