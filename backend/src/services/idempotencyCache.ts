import { createHash } from 'node:crypto';
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
  requestFingerprint: string,
): string {
  return `idempotency:${apiKey}:${campaignId}:${idempotencyKey}:${requestFingerprint}`;
}

/**
 * Fingerprint of the request payload an idempotency key is bound to.
 *
 * Two requests that carry the same Idempotency-Key but different bodies are
 * different logical operations (for example two different contributors
 * pledging through an anonymous client), so they must not replay each
 * other's cached response. Binding the key to a hash of the body keeps
 * genuine retries - identical body - on the same cached response.
 */
export function createIdempotencyRequestFingerprint(body: unknown): string {
  const serialized = JSON.stringify(body ?? null);
  return createHash('sha256').update(serialized).digest('hex').slice(0, 32);
}

export async function getIdempotencyCacheEntry(key: string): Promise<IdempotencyCacheEntry | null> {
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
