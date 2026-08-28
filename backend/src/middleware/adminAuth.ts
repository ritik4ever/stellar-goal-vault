import { Request, Response, NextFunction } from 'express';

import { AppError } from '../types/errors';

/**
 * Admin authentication middleware for privileged endpoints such as the
 * abuse-report moderation routes (`/api/admin/*`).
 *
 * Admin keys are supplied via the `ADMIN_API_KEYS` environment variable as a
 * comma-separated list and presented by the caller as a bearer token:
 *
 *   Authorization: Bearer <admin-key>
 *
 * Behaviour when `ADMIN_API_KEYS` is not configured:
 *   - `NODE_ENV=production` → the route is refused with 503 so admin
 *     endpoints are never left unauthenticated in production.
 *   - any other environment → the request is allowed through, keeping local
 *     development and the test suite friction-free.
 */
export function adminAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const configuredKeys = (process.env.ADMIN_API_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  if (configuredKeys.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(
        'Admin API is not configured. Set ADMIN_API_KEYS to enable admin endpoints.',
        503,
        'ADMIN_NOT_CONFIGURED',
      );
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  const providedKey =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!providedKey || !configuredKeys.includes(providedKey)) {
    throw new AppError(
      'Admin authentication required. Provide a valid admin key as a bearer token.',
      401,
      'ADMIN_UNAUTHORIZED',
    );
  }

  next();
}
