import { createClient, RedisClientType } from "redis";
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
    logInfo(
      "redis_cache_disabled",
      { message: "Redis cache disabled (not in production or REDIS_URL not set)" },
      config.logLevel,
    );
    return;
  }

  try {
    redisClient = createClient({ url: redisUrl });

    redisClient.on("error", (err) => {
      logError(err, { event: "redis_client_error" }, config.logLevel);
      isConnected = false;
    });

    redisClient.on("connect", () => {
      logInfo("redis_cache_connected", {}, config.logLevel);
      isConnected = true;
    });

    await redisClient.connect();
    isConnected = true;
    logInfo("redis_cache_initialized", {}, config.logLevel);
  } catch (error) {
    logError(error, { event: "redis_cache_init_failed" }, config.logLevel);
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
    logError(error, { event: "cache_get_error", key }, config.logLevel);
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
    logError(error, { event: "cache_set_error", key }, config.logLevel);
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
    logError(error, { event: "cache_delete_error", key }, config.logLevel);
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
    logError(error, { event: "cache_pattern_clear_error", pattern }, config.logLevel);
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
      logInfo("redis_cache_connection_closed", {}, config.logLevel);
    } catch (error) {
      logError(error, { event: "redis_close_error" }, config.logLevel);
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
