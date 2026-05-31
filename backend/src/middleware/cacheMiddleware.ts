import { Request, Response, NextFunction } from "express";
import {
  getCacheValue,
  setCacheValue,
  isCacheAvailable,
} from "../services/cache";

interface CacheableRequest extends Request {
  cacheKey?: string;
}

/**
 * Cache middleware for GET requests.
 * Caches responses for read-only endpoints with configurable TTL.
 * Cache key format: "cache:{method}:{path}:{queryString}"
 */
export function cacheMiddleware(ttlSeconds: number = 300) {
  return async (
    req: CacheableRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Only cache GET requests
    if (req.method !== "GET" || !isCacheAvailable()) {
      return next();
    }

    // Generate cache key from method, path, and query params
    const queryString = Object.keys(req.query)
      .sort()
      .map((key) => `${key}=${req.query[key]}`)
      .join("&");
    const cacheKey = `cache:${req.method}:${req.path}${queryString ? "?" + queryString : ""}`;
    req.cacheKey = cacheKey;

    // Try to get from cache
    const cachedResponse = await getCacheValue(cacheKey);
    if (cachedResponse) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      return res.send(cachedResponse);
    }

    // Intercept response to cache it
    const originalSend = res.send.bind(res);
    res.send = function (data: any) {
      // Only cache successful responses (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const responseData =
          typeof data === "string" ? data : JSON.stringify(data);
        setCacheValue(cacheKey, responseData, ttlSeconds).catch(() => {
          // Silently fail cache writes
        });
        res.setHeader("X-Cache", "MISS");
      }

      return originalSend(data);
    };

    next();
  };
}

/**
 * Invalidate cache for a specific pattern.
 * Useful for clearing cache after write operations.
 */
export async function invalidateCache(pattern: string): Promise<void> {
  if (!isCacheAvailable()) {
    return;
  }

  const { clearCachePattern } = await import("../services/cache");
  await clearCachePattern(pattern);
}
