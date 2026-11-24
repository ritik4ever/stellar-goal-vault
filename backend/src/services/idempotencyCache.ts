import { LRUCache } from 'lru-cache';
import { getDb, type SQLiteDatabase } from './db';
import { getCacheValue, setCacheValue, deleteCacheValue, isCacheAvailable } from './cache';

export const IDEMPOTENCY_TTL_SECONDS = 86_400;
const TTL_MS = IDEMPOTENCY_TTL_SECONDS * 1000;

/**
 * How long an `in_progress` claim in SQLite stays valid before another worker
 * may treat the original holder as crashed and reclaim the key.
 */
export const IN_FLIGHT_LEASE_MS = 30_000;

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

interface IdempotencyRow {
  key: string;
  fingerprint: string;
  status: 'in_progress' | 'completed';
  owner_id: string | null;
  status_code: number | null;
  body: string | null;
  headers_json: string | null;
  stored_at: number;
  updated_at: number;
}

export type ClaimResult =
  | { status: 'acquired' }
  | { status: 'in_progress' }
  | { status: 'conflict' }
  | { status: 'completed'; entry: IdempotencyCacheEntry };

export type PollResult =
  | { status: 'in_progress' }
  | { status: 'missing' }
  | { status: 'conflict' }
  | { status: 'completed'; entry: IdempotencyCacheEntry };

const memoryCache = new LRUCache<string, IdempotencyCacheEntry>({
  max: MAX_CACHE_SIZE,
  ttl: TTL_MS,
});

function tryGetDb(): SQLiteDatabase | null {
  try {
    return getDb();
  } catch {
    return null;
  }
}

function rowToEntry(row: IdempotencyRow): IdempotencyCacheEntry {
  let headers: Record<string, string> = {};
  if (row.headers_json) {
    try {
      headers = JSON.parse(row.headers_json) as Record<string, string>;
    } catch {
      headers = {};
    }
  }
  return {
    statusCode: row.status_code ?? 200,
    body: row.body ?? '',
    headers,
    fingerprint: row.fingerprint,
    storedAt: row.stored_at,
  };
}

function deleteDbEntry(db: SQLiteDatabase, key: string): void {
  try {
    db.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).run(key);
  } catch {
    // Ignore if table is not present in minimal test harnesses
  }
}

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
 * own clock and rounding, so the boundary is the same in memory, SQLite, and Redis.
 */
export function isExpired(entry: IdempotencyCacheEntry, now: number = Date.now()): boolean {
  return entry.storedAt !== undefined && now - entry.storedAt >= TTL_MS;
}

export async function getIdempotencyCacheEntry(key: string): Promise<IdempotencyCacheEntry | null> {
  const now = Date.now();
  const db = tryGetDb();

  if (isCacheAvailable()) {
    const cached = await getCacheValue(key);
    if (cached) {
      try {
        const entry = JSON.parse(cached) as IdempotencyCacheEntry;
        if (!isExpired(entry, now)) {
          return entry;
        }
        await deleteCacheValue(key).catch(() => {});
        memoryCache.delete(key);
        if (db) deleteDbEntry(db, key);
      } catch {
        await deleteCacheValue(key).catch(() => {});
        memoryCache.delete(key);
        if (db) deleteDbEntry(db, key);
      }
    }
  }

  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (isExpired(memoryEntry, now)) {
      memoryCache.delete(key);
      if (db) deleteDbEntry(db, key);
      return null;
    }
    return memoryEntry;
  }

  if (db) {
    try {
      const row = db
        .prepare(`SELECT * FROM idempotency_keys WHERE key = ? AND status = 'completed'`)
        .get(key) as IdempotencyRow | undefined;
      if (row) {
        const entry = rowToEntry(row);
        if (!isExpired(entry, now)) {
          memoryCache.set(key, entry);
          return entry;
        }
        deleteDbEntry(db, key);
      }
    } catch {
      // Ignore if table is not present in minimal test harnesses
    }
  }

  return null;
}

export async function setIdempotencyCacheEntry(
  key: string,
  entry: IdempotencyCacheEntry,
): Promise<void> {
  const now = entry.storedAt ?? Date.now();
  const stored: IdempotencyCacheEntry = { ...entry, storedAt: now };

  // Memory first: a request waiting on this key in the same process must see
  // the entry as soon as the response is sent, without waiting on Redis.
  memoryCache.set(key, stored);

  const db = tryGetDb();
  if (db) {
    try {
      db.prepare(
        `INSERT INTO idempotency_keys
           (key, fingerprint, status, owner_id, status_code, body, headers_json, stored_at, updated_at)
         VALUES (?, ?, 'completed', NULL, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           status = 'completed',
           owner_id = NULL,
           status_code = excluded.status_code,
           body = excluded.body,
           headers_json = excluded.headers_json,
           stored_at = excluded.stored_at,
           updated_at = excluded.updated_at`,
      ).run(
        key,
        stored.fingerprint ?? '',
        stored.statusCode,
        stored.body,
        JSON.stringify(stored.headers),
        now,
        now,
      );
    } catch {
      // Ignore if table is not present in minimal test harnesses
    }
  }

  if (isCacheAvailable()) {
    await setCacheValue(key, JSON.stringify(stored), IDEMPOTENCY_TTL_SECONDS).catch(() => {
      // Silently fail Redis writes; memory and SQLite stores still work
    });
  }
}

/**
 * Atomically claim an idempotency key in SQLite so that concurrent workers
 * sharing the database coordinate without racing.
 */
export async function claimIdempotencyKey(
  key: string,
  fingerprint: string,
  ownerId: string,
  now: number = Date.now(),
): Promise<ClaimResult> {
  // Check Redis first when available so expired shared entries are purged cleanly.
  if (isCacheAvailable()) {
    const cached = await getCacheValue(key);
    if (cached) {
      try {
        const entry = JSON.parse(cached) as IdempotencyCacheEntry;
        if (!isExpired(entry, now)) {
          if (entry.fingerprint && entry.fingerprint !== fingerprint) {
            return { status: 'conflict' };
          }
          return { status: 'completed', entry };
        }
        await deleteCacheValue(key).catch(() => {});
        memoryCache.delete(key);
      } catch {
        await deleteCacheValue(key).catch(() => {});
        memoryCache.delete(key);
      }
    }
  }

  const db = tryGetDb();
  if (!db) {
    const existing = await getIdempotencyCacheEntry(key);
    if (existing) {
      if (existing.fingerprint && existing.fingerprint !== fingerprint) {
        return { status: 'conflict' };
      }
      return { status: 'completed', entry: existing };
    }
    return { status: 'acquired' };
  }

  try {
    const result = db.transaction((): ClaimResult => {
      const row = db
        .prepare(`SELECT * FROM idempotency_keys WHERE key = ?`)
        .get(key) as IdempotencyRow | undefined;

      if (row) {
        if (row.status === 'completed') {
          const entry = rowToEntry(row);
          if (!isExpired(entry, now)) {
            if (entry.fingerprint && entry.fingerprint !== fingerprint) {
              return { status: 'conflict' };
            }
            memoryCache.set(key, entry);
            return { status: 'completed', entry };
          }
          db.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).run(key);
        } else {
          // status === 'in_progress'
          if (row.updated_at + IN_FLIGHT_LEASE_MS > now) {
            if (row.fingerprint && row.fingerprint !== fingerprint) {
              return { status: 'conflict' };
            }
            return { status: 'in_progress' };
          }
          // Stale in-flight lease from a crashed worker: reclaim it.
          db.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).run(key);
        }
      }

      db.prepare(
        `INSERT INTO idempotency_keys
           (key, fingerprint, status, owner_id, status_code, body, headers_json, stored_at, updated_at)
         VALUES (?, ?, 'in_progress', ?, NULL, NULL, NULL, ?, ?)`,
      ).run(key, fingerprint, ownerId, now, now);

      return { status: 'acquired' };
    }).immediate();

    return result;
  } catch {
    return { status: 'acquired' };
  }
}

/**
 * Inspect the current durable state of an idempotency key while waiting on
 * another worker's in-progress execution.
 */
export async function pollIdempotencyKey(
  key: string,
  fingerprint: string,
  now: number = Date.now(),
): Promise<PollResult> {
  const db = tryGetDb();
  if (!db) {
    const existing = await getIdempotencyCacheEntry(key);
    if (!existing) return { status: 'missing' };
    if (existing.fingerprint && existing.fingerprint !== fingerprint) {
      return { status: 'conflict' };
    }
    return { status: 'completed', entry: existing };
  }

  try {
    const row = db
      .prepare(`SELECT * FROM idempotency_keys WHERE key = ?`)
      .get(key) as IdempotencyRow | undefined;

    if (!row) {
      return { status: 'missing' };
    }

    if (row.status === 'completed') {
      const entry = rowToEntry(row);
      if (isExpired(entry, now)) {
        deleteDbEntry(db, key);
        return { status: 'missing' };
      }
      if (entry.fingerprint && entry.fingerprint !== fingerprint) {
        return { status: 'conflict' };
      }
      memoryCache.set(key, entry);
      return { status: 'completed', entry };
    }

    if (row.updated_at + IN_FLIGHT_LEASE_MS <= now) {
      return { status: 'missing' };
    }

    if (row.fingerprint && row.fingerprint !== fingerprint) {
      return { status: 'conflict' };
    }

    return { status: 'in_progress' };
  } catch {
    return { status: 'missing' };
  }
}

/**
 * Persist a completed 2xx response synchronously to SQLite and memory, and
 * replicate to Redis when configured.
 */
export async function completeIdempotencyKey(
  key: string,
  entry: IdempotencyCacheEntry,
  ownerId: string,
): Promise<void> {
  const now = entry.storedAt ?? Date.now();
  const stored: IdempotencyCacheEntry = { ...entry, storedAt: now };

  memoryCache.set(key, stored);

  const db = tryGetDb();
  if (db) {
    try {
      db.prepare(
        `INSERT INTO idempotency_keys
           (key, fingerprint, status, owner_id, status_code, body, headers_json, stored_at, updated_at)
         VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           status = 'completed',
           owner_id = excluded.owner_id,
           status_code = excluded.status_code,
           body = excluded.body,
           headers_json = excluded.headers_json,
           stored_at = excluded.stored_at,
           updated_at = excluded.updated_at`,
      ).run(
        key,
        stored.fingerprint ?? '',
        ownerId,
        stored.statusCode,
        stored.body,
        JSON.stringify(stored.headers),
        now,
        now,
      );
    } catch {
      // Ignore if table is not present in minimal test harnesses
    }
  }

  if (isCacheAvailable()) {
    await setCacheValue(key, JSON.stringify(stored), IDEMPOTENCY_TTL_SECONDS).catch(() => {
      // Silently fail Redis writes; memory and SQLite stores still work
    });
  }
}

/**
 * Release an `in_progress` claim when the request fails (non-2xx) or aborts
 * before completing, so a retry or waiting worker can run immediately.
 */
export function releaseIdempotencyKey(key: string, ownerId: string): void {
  const db = tryGetDb();
  if (!db) return;

  try {
    db.prepare(
      `DELETE FROM idempotency_keys WHERE key = ? AND status = 'in_progress' AND owner_id = ?`,
    ).run(key, ownerId);
  } catch {
    // Ignore if table is not present in minimal test harnesses
  }
}

export async function deleteIdempotencyCacheEntry(key: string): Promise<void> {
  memoryCache.delete(key);
  const db = tryGetDb();
  if (db) {
    deleteDbEntry(db, key);
  }
  if (isCacheAvailable()) {
    await deleteCacheValue(key).catch(() => {});
  }
}

export function clearIdempotencyCache(): void {
  memoryCache.clear();
}
