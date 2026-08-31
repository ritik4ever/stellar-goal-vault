import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types/errors';

export interface RequestWithApiKey extends Request {
  apiKey?: string;
  isAuthenticated?: boolean;
  apiKeyRecord?: ApiKeyRecord;
  isReadOnly?: boolean;
}

// Paths that are always public (don't require any authentication)
const PUBLIC_PATHS = [
  '/api/health',
  '/api/config',
  '/api/stats',
  '/api/leaderboard',
  '/api/open-issues',
  '/api/openapi.json',
  // API key management routes are excluded from auth
  '/api/api-keys',
];

// Paths that require read-write access (mutation endpoints)
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const READ_WRITE_PATHS = ['/api/campaigns', '/api/pledges'];

/**
 * API Key authentication middleware.
 * Supports both X-API-Key header and Authorization: Bearer header formats.
 * Validates API key against database (new) or environment variable (legacy).
 * Skips authentication for public endpoints.
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
  const isPublicPath = PUBLIC_PATHS.some((path) => req.path.startsWith(path));

  if (isPublicPath) {
    req.isAuthenticated = true;
    return next();
  }

  // Extract API key from X-API-Key header or Authorization header
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
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
    // If no API keys configured anywhere, allow all requests (development mode)
    req.isAuthenticated = true;
    req.apiKey = apiKey;
    return next();
  }

  if (!validApiKeys.includes(apiKey)) {
    throw new AppError('Invalid API key', 403, 'FORBIDDEN');
  }

  req.isAuthenticated = true;
  req.apiKey = apiKey;
  next();
}

/**
 * Determines if the request is a mutation (write) operation.
 */
function isMutationRequest(req: Request): boolean {
  if (!WRITE_METHODS.includes(req.method)) {
    return false;
  }

  // Check if the path matches a read-write path
  return READ_WRITE_PATHS.some((path) => req.path.startsWith(path));
}
