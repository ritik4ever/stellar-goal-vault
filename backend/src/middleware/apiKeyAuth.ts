import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types/errors';
import { recordFailedApiKeyAttempt, recordApiKeyUsage } from '../services/abuseControl';

export interface RequestWithApiKey extends Request {
  apiKey?: string;
  isAuthenticated?: boolean;
}

/**
 * API Key authentication middleware.
 * Validates API key from Authorization header (Bearer token format).
 * Skips authentication for public endpoints (health, config, stats, leaderboard, open-issues).
 *
 * Environment variable: API_KEYS (comma-separated list of valid API keys)
 * Header format: Authorization: Bearer <api-key>
 * 
 * Abuse controls:
 * - Failed authentication attempts are rate limited (10 failures per minute per IP)
 * - Per-API-key usage is tracked to prevent individual key abuse (1000 requests per minute)
 */
export function apiKeyAuthMiddleware(
  req: RequestWithApiKey,
  res: Response,
  next: NextFunction,
): void {
  // Public endpoints that don't require authentication
  const publicPaths = [
    '/api/health',
    '/api/config',
    '/api/stats',
    '/api/leaderboard',
    '/api/open-issues',
  ];

  // Check if current path is public
  const isPublicPath = publicPaths.some((path) => req.path.startsWith(path));

  if (isPublicPath) {
    req.isAuthenticated = true;
    return next();
  }

  // Extract API key from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(
      'Missing or invalid Authorization header. Use format: Bearer <api-key>',
      401,
      'UNAUTHORIZED',
    );
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer " prefix
  const validApiKeys = (process.env.API_KEYS || '').split(',').filter(Boolean);

  if (validApiKeys.length === 0) {
    // If no API keys configured, allow all requests (development mode)
    req.isAuthenticated = true;
    req.apiKey = apiKey;
    return next();
  }

  if (!validApiKeys.includes(apiKey)) {
    // Record failed attempt for abuse control (only when API keys are configured)
    if (recordFailedApiKeyAttempt(req.ip || '')) {
      throw new AppError(
        'Too many failed authentication attempts. Please try again later.',
        429,
        'TOO_MANY_FAILED_ATTEMPTS',
      );
    }
    throw new AppError('Invalid API key', 403, 'FORBIDDEN');
  }

  // Check per-API-key usage to prevent abuse (only for valid keys)
  if (recordApiKeyUsage(apiKey)) {
    throw new AppError(
      'API key rate limit exceeded. Please contact administrator for higher limits.',
      429,
      'API_KEY_RATE_LIMITED',
    );
  }

  req.isAuthenticated = true;
  req.apiKey = apiKey;
  next();
}
