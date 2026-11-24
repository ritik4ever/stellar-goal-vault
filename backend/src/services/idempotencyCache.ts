import { LRUCache } from 'lru-cache';
import { getCacheValue, setCacheValue, isCacheAvailable } from './cache';

export const IDEMPOTENCY_TTL_SECONDS = 86_400;

const MAX_CACHE_SIZE = Number(process.env.IDEMPOTENCY_CACHE_MAX_SIZE ?? 1000);

export interface IdempotencyCacheEntry {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  /** Hash of the request that produced this response. Absent on entries stored before it existed. */
  fingerprint?: string;
  /** Epoch milliseconds when the entry was stored. Absent on entries stored before it existed. */
  storedAt?: number;
}

const memoryCache = new LRUCache<string, IdempotencyCacheEntry>({
  max: MAX_CACHE_SIZE,
  ttl: IDEMPOTENCY_TTL_SECONDS * 1000,
});

/**
 * `scope` separates callers that share an API key (or have none) so that one
 * contributor's key can never replay another contributor's response.
 */
export function buildIdempotencyCacheKey(
  apiKey: string,
  campaignId: string,
  idempotencyKey: string,
  scope = '',
): string {
  return `idempotency:${apiKey}:${campaignId}:${scope}:${idempotencyKey}`;
}

/**
 * An entry is replayable for exactly IDEMPOTENCY_TTL_SECONDS. The age is checked
 * here, against the stored timestamp, rather than left to each backing store's
 * own clock and rounding, so the boundary is the same in memory and in Redis.
 */
function isExpired(entry: IdempotencyCacheEntry, now: number): boolean {
  return entry.storedAt !== undefined && now - entry.storedAt >= IDEMPOTENCY_TTL_SECONDS * 1000;
}

export async function getIdempotencyCacheEntry(key: string): Promise<IdempotencyCacheEntry | null> {
  const now = Date.now();

  if (isCacheAvailable()) {
    const cached = await getCacheValue(key);
    if (cached) {
      const entry = JSON.parse(cached) as IdempotencyCacheEntry;
      if (!isExpired(entry, now)) {
        return entry;
      }
    }
  }

  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (isExpired(memoryEntry, now)) {
      memoryCache.delete(key);
      return null;
    }
    return memoryEntry;
  }

  return null;
}

export async function setIdempotencyCacheEntry(
  key: string,
  entry: IdempotencyCacheEntry,
): Promise<void> {
  const stored: IdempotencyCacheEntry = { ...entry, storedAt: entry.storedAt ?? Date.now() };

  // Memory first: a request waiting on this key in the same process must see
  // the entry as soon as the response is sent, without waiting on Redis.
  memoryCache.set(key, stored);

  if (isCacheAvailable()) {
    await setCacheValue(key, JSON.stringify(stored), IDEMPOTENCY_TTL_SECONDS).catch(() => {
      // Silently fail Redis writes; memory cache still works
    });
  }
}

export function clearIdempotencyCache(): void {
  memoryCache.clear();
}
