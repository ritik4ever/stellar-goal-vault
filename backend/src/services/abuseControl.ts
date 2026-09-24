import { LRUCache } from 'lru-cache';

interface FailedAttempt {
  count: number;
  resetAt: number;
}

const MAX_FAILED_ATTEMPTS = 10;
const FAILED_ATTEMPT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_CACHE_SIZE = 10000;

// Cache for tracking failed API key attempts by IP
const failedApiKeyAttempts = new LRUCache<string, FailedAttempt>({
  max: MAX_CACHE_SIZE,
});

// Cache for tracking per-API-key usage
const apiKeyUsage = new LRUCache<string, FailedAttempt>({
  max: MAX_CACHE_SIZE,
});

/**
 * Records a failed API key authentication attempt and returns true if the limit is exceeded.
 */
export function recordFailedApiKeyAttempt(ip: string): boolean {
  if (!ip) {
    return false;
  }

  // Skip in development to avoid blocking normal workflow
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production') {
    return false;
  }

  const key = `failed_api_key:${ip}`;
  const now = Date.now();
  const current = failedApiKeyAttempts.get(key);

  let count = 1;
  let resetAt = now + FAILED_ATTEMPT_WINDOW_MS;

  if (current && now < current.resetAt) {
    count = current.count + 1;
    resetAt = current.resetAt;
  }

  failedApiKeyAttempts.set(key, { count, resetAt });

  return count >= MAX_FAILED_ATTEMPTS;
}

/**
 * Records API key usage and returns true if the per-key rate limit is exceeded.
 * Uses a higher limit than the general rate limit to allow legitimate high-volume usage.
 */
export function recordApiKeyUsage(apiKey: string): boolean {
  if (!apiKey) {
    return false;
  }

  // Skip in development to avoid blocking normal workflow
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production') {
    return false;
  }

  const key = `api_key_usage:${apiKey}`;
  const now = Date.now();
  const current = apiKeyUsage.get(key);

  // Per-key limit: 1000 requests per minute (much higher than general limit)
  const MAX_PER_KEY_REQUESTS = 1000;
  const KEY_USAGE_WINDOW_MS = 60 * 1000; // 1 minute

  let count = 1;
  let resetAt = now + KEY_USAGE_WINDOW_MS;

  if (current && now < current.resetAt) {
    count = current.count + 1;
    resetAt = current.resetAt;
  }

  apiKeyUsage.set(key, { count, resetAt });

  return count >= MAX_PER_KEY_REQUESTS;
}

/**
 * Clears all abuse control caches (useful for testing).
 */
export function clearAbuseControlCaches(): void {
  failedApiKeyAttempts.clear();
  apiKeyUsage.clear();
}

/**
 * Gets current abuse control statistics (for monitoring/ debugging).
 */
export function getAbuseControlStats() {
  return {
    failedApiKeyAttempts: failedApiKeyAttempts.size,
    apiKeyUsage: apiKeyUsage.size,
  };
}
