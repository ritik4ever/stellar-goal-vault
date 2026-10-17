import { randomUUID } from 'crypto';
import { NextFunction, Response } from 'express';

import { logRequest } from '../logger';
import { config } from '../config';
import { requestContext } from '../requestContext';
import type { RequestWithId } from './types';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Request IDs are copied into response headers and structured logs. Restrict
// caller-supplied values to a log/header-safe token so a proxy cannot inject
// control characters or an unbounded value into the tracing path.
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// Sensitive headers and query parameters to redact from logs
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-wallet-secret',
  'x-secret-key',
  'x-webhook-secret',
  'x-signature',
]);

/**
 * Redacts sensitive headers from an object.
 */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/** Route prefix whose `:id` segment is a campaign ID. */
const CAMPAIGN_ROUTE_PREFIX = '/api/campaigns/:id';

/**
 * Structured routing fields for the request log, derived from the matched
 * Express route so they stay low-cardinality and don't depend on the raw URL.
 */
export function describeRoute(
  method: string,
  routePattern: string | undefined,
  path: string,
): { route?: string; operation: string; campaignId?: string } {
  if (!routePattern) {
    return { operation: 'unmatched' };
  }

  let campaignId: string | undefined;
  if (routePattern === CAMPAIGN_ROUTE_PREFIX || routePattern.startsWith(`${CAMPAIGN_ROUTE_PREFIX}/`)) {
    // `/api/campaigns/:id/...` -> the ID is the fourth path segment.
    const segment = path.split('/')[3];
    if (segment) {
      try {
        campaignId = decodeURIComponent(segment);
      } catch {
        campaignId = segment;
      }
    }
  }

  return { route: routePattern, operation: `${method} ${routePattern}`, campaignId };
}

export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const candidate = incoming?.trim();
  const requestId = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  // Extract retry info from headers (often set by proxies or client interceptors)
  const retryCountStr = req.header('x-retry-count');
  if (retryCountStr) req.retryCount = parseInt(retryCountStr, 10);
  const retryReason = req.header('x-retry-reason');
  if (retryReason) req.retryReason = retryReason;

  const startedAt = process.hrtime.bigint();
  let logged = false;

  const log = (aborted: boolean) => {
    if (logged) return;
    logged = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    // Query strings can carry user input; keep them out of the log line.
    const path = (req.originalUrl || req.path).split('?')[0];
    const routePattern = typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : undefined;

    // Redact sensitive information from request context for logging
    const redactedHeaders = redactHeaders(req.headers as Record<string, string>);

    const finalOutcome = req.finalOutcome || (res.statusCode >= 400 ? 'failure' : 'success');

    logRequest(
      {
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs,
        ...describeRoute(req.method, routePattern, path),
        errorCode: typeof res.locals.errorCode === 'string' ? res.locals.errorCode : undefined,
        aborted,
        headers: redactedHeaders,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        retryCount: req.retryCount,
        retryReason: req.retryReason,
        finalOutcome,
      },
      config.logLevel,
    );
  };

  res.on('finish', () => log(false));
  res.on('close', () => log(!res.writableFinished));

  requestContext.run({ requestId }, () => {
    next();
  });
}
