/**
 * Redis-backed cache layer for backend API responses.
 * Falls back to in-memory Map when Redis is unavailable.
 */

import { config } from "../config";

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

// ── In-memory fallback ──────────────────────────────────────────────

const memoryStore = new Map<string, CacheEntry>();

// ── TTL configuration ───────────────────────────────────────────────

const DEFAULT_TTL_MS = 60_000; // 60 seconds

// ── Redis client (lazy init) ────────────────────────────────────────

let redisClient: import("ioredis").Redis | null = null;

async function getRedisClient(): Promise<import("ioredis").Redis | null> {
  if (redisClient) return redisClient;

  const redisUrl = config.redisUrl;
  if (!redisUrl) return null;

  try {
    const { Redis } = await import("ioredis");
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      lazyConnect: true,
    });
    redisClient.on("error", (_err: Error) => {
      // Logged by the logger if available; swallow to avoid crash
    });
    await redisClient.connect();
    console.info(`[redisCache] Connected to Redis at ${redisUrl}`);
    return redisClient;
  } catch {
    console.warn("[redisCache] Redis unavailable, falling back to in-memory cache");
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  if (client) {
    try {
      const raw = await client.get(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      // Fall through to memory
    }
  }

  const entry = memoryStore.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  memoryStore.delete(key);
  return null;
}

export async function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
  const client = await getRedisClient();
  if (client) {
    try {
      await client.setex(key, Math.ceil(ttlMs / 1000), JSON.stringify(data));
      return;
    } catch {
      // Fall through to memory
    }
  }

  memoryStore.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export async function cacheDel(key: string): Promise<void> {
  const client = await getRedisClient();
  if (client) {
    try {
      await client.del(key);
    } catch {
      // ignore
    }
  }
  memoryStore.delete(key);
}

export async function cacheFlush(pattern: string = "*"): Promise<void> {
  const client = await getRedisClient();
  if (client) {
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) await client.del(...keys);
    } catch {
      // ignore
    }
  }
  memoryStore.clear();
}
