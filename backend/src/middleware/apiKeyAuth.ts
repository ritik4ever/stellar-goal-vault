import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types/errors';

export interface RequestWithApiKey extends Request {
  apiKey?: string;
  isAuthenticated?: boolean;
}

/**
 * API Key authentication middleware.
 * Validates API key from Authorization header (Bearer token format).
 * 
 * SECURITY: Write routes (POST, PUT, PATCH, DELETE) ALWAYS require authentication in production.
 * Public endpoints (health, config, stats, leaderboard, open-issues) are exempt from authentication.
 * 
 * Environment variable: API_KEYS (comma-separated list of valid API keys)
 * Header format: Authorization: Bearer <api-key>
 */
export function apiKeyAuthMiddleware(
  req: RequestWithApiKey,
  res: Response,
  next: NextFunction,
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);

  // Public endpoints that don't require authentication (read-only)
  const publicPaths = [
    '/api/health',
    '/api/config',
    '/api/stats',
    '/api/leaderboard',
    '/api/open-issues',
  ];

  // Check if current path is public
  const isPublicPath = publicPaths.some((path) => req.path.startsWith(path));

  // In production, write routes ALWAYS require authentication
  if (isProduction && isWriteMethod && !isPublicPath) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(
        'Missing or invalid Authorization header. Write routes require authentication. Use format: Bearer <api-key>',
        401,
        'UNAUTHORIZED',
      );
    }

    const apiKey = authHeader.slice(7); // Remove "Bearer " prefix
    const validApiKeys = (process.env.API_KEYS || '').split(',').filter(Boolean);

    if (validApiKeys.length === 0) {
      // This should never happen due to validateEnv validation, but defend defensively
      throw new AppError(
        'API authentication is not configured. Set API_KEYS environment variable to secure write endpoints.',
        500,
        'CONFIGURATION_ERROR',
      );
    }

    if (!validApiKeys.includes(apiKey)) {
      throw new AppError('Invalid API key', 403, 'FORBIDDEN');
    }

    req.isAuthenticated = true;
    req.apiKey = apiKey;
    return next();
  }

  // For public paths or non-production environments
  if (isPublicPath) {
    req.isAuthenticated = true;
    return next();
  }

  // In development/test, allow requests without API keys but validate if provided
  if (!isProduction) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const apiKey = authHeader.slice(7);
      const validApiKeys = (process.env.API_KEYS || '').split(',').filter(Boolean);
      
      if (validApiKeys.length > 0 && !validApiKeys.includes(apiKey)) {
        throw new AppError('Invalid API key', 403, 'FORBIDDEN');
      }
      
      req.isAuthenticated = true;
      req.apiKey = apiKey;
    } else {
      req.isAuthenticated = true;
    }
    return next();
  }

  // For production read routes on non-public paths, require authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(
      'Missing or invalid Authorization header. Use format: Bearer <api-key>',
      401,
      'UNAUTHORIZED',
    );
  }

  const apiKey = authHeader.slice(7);
  const validApiKeys = (process.env.API_KEYS || '').split(',').filter(Boolean);

  if (validApiKeys.length === 0) {
    throw new AppError(
      'API authentication is not configured. Set API_KEYS environment variable.',
      500,
      'CONFIGURATION_ERROR',
    );
  }

  if (!validApiKeys.includes(apiKey)) {
    throw new AppError('Invalid API key', 403, 'FORBIDDEN');
  }

  req.isAuthenticated = true;
  req.apiKey = apiKey;
  next();
}
