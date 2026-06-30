import { createClient, RedisClientType } from "redis";
import { config } from "../config";
import { logInfo, logError } from "../logger";
import { config } from "../config";

type RedisClient = RedisClientType;

let redisClient: RedisClient | null = null;
let isConnected = false;

/**
 * Initialize Redis client for caching.
 * Only connects if REDIS_URL is configured and NODE_ENV is production.
 */
export async function initRedisCache(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  const nodeEnv = process.env.NODE_ENV;

  if (!redisUrl || nodeEnv !== "production") {

    return;
  }

  try {
    redisClient = createClient({ url: redisUrl });

    redisClient.on("error", (err) => {

      isConnected = false;
    });

    redisClient.on("connect", () => {

      isConnected = true;
    });

    await redisClient.connect();
    isConnected = true;

    redisClient = null;
    isConnected = false;
  }
}

/**
 * Get a value from cache.
 * Returns null if key doesn't exist or cache is unavailable.
 */
export async function getCacheValue(key: string): Promise<string | null> {
  if (!redisClient || !isConnected) {
    return null;
  }

  try {
    return await redisClient.get(key);
  } catch (error) {

    return null;
  }
}

/**
 * Set a value in cache with optional TTL (in seconds).
 * Returns true if successful, false otherwise.
 */
export async function setCacheValue(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<boolean> {
  if (!redisClient || !isConnected) {
    return false;
  }

  try {
    if (ttlSeconds) {
      await redisClient.setEx(key, ttlSeconds, value);
    } else {
      await redisClient.set(key, value);
    }
    return true;
  } catch (error) {

    return false;
  }
}

/**
 * Delete a value from cache.
 * Returns true if key was deleted, false if key didn't exist or error occurred.
 */
export async function deleteCacheValue(key: string): Promise<boolean> {
  if (!redisClient || !isConnected) {
    return false;
  }

  try {
    const result = await redisClient.del(key);
    return result > 0;
  } catch (error) {

    return false;
  }
}

/**
 * Clear all cache entries matching a pattern.
 * Pattern uses Redis glob syntax (e.g., "campaign:*" matches all campaign keys).
 */
export async function clearCachePattern(pattern: string): Promise<number> {
  if (!redisClient || !isConnected) {
    return 0;
  }

  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length === 0) {
      return 0;
    }
    return await redisClient.del(keys);
  } catch (error) {

    return 0;
  }
}

/**
 * Close Redis connection.
 */
export async function closeRedisCache(): Promise<void> {
  if (redisClient && isConnected) {
    try {
      await redisClient.quit();
      isConnected = false;

    }
  }
}

/**
 * Check if cache is available.
 */
export function isCacheAvailable(): boolean {
  return isConnected && redisClient !== null;
}

/**
 * Get cache statistics (for monitoring).
 */
export async function getCacheStats(): Promise<{
  available: boolean;
  connected: boolean;
} | null> {
  if (!redisClient) {
    return null;
  }

  return {
    available: isConnected,
    connected: isConnected,
  };
}
