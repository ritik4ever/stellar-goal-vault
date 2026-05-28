/**
 * Express middleware for response caching.
 * Wraps route handlers with Redis-backed caching.
 */

import { Request, Response, NextFunction } from "express";
import { cacheGet, cacheSet } from "../services/redisCache";

const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Middleware factory: caches GET responses by request URL.
 * Skips caching when `Cache-Control: no-cache` is present.
 */
export function cacheResponse(ttlMs: number = CACHE_TTL_MS) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();

    // Respect client cache-busting headers
    if (req.headers["cache-control"]?.includes("no-cache")) return next();

    const cacheKey = `cache:${req.originalUrl}`;

    const cached = await cacheGet<{ body: string; status: number; headers: Record<string, string> }>(cacheKey);
    if (cached !== null) {
      for (const [k, v] of Object.entries(cached.headers)) {
        res.setHeader(k, v);
      }
      res.status(cached.status).send(cached.body);
      return;
    }

    // Intercept res.json to cache
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const responseBody = JSON.stringify(body);
      const headers: Record<string, string> = {
        "X-Cache": "miss",
      };
      cacheSet(cacheKey, { body: responseBody, status: res.statusCode, headers }, ttlMs).catch(() => {});
      res.setHeader("X-Cache", "miss");
      return originalJson(body);
    };

    next();
  };
}

/**
 * Invalidate cache entries matching a pattern.
 * Call from mutation endpoints to keep cache fresh.
 */
export async function invalidateCache(pattern: string = "*"): Promise<void> {
  const { cacheFlush } = await import("../services/redisCache");
  await cacheFlush(pattern);
}
