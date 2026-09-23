import { randomUUID } from 'crypto';
import { NextFunction, Response } from 'express';

import { logRequest } from '../logger';
import { config } from '../config';
import { requestContext } from '../requestContext';
import type { RequestWithId } from './types';

export const REQUEST_ID_HEADER = 'X-Request-ID';

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
  const requestId = incoming?.trim() ? incoming.trim() : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const startedAt = process.hrtime.bigint();
  let logged = false;

  const log = (aborted: boolean) => {
    if (logged) return;
    logged = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    // Query strings can carry user input; keep them out of the log line.
    const path = (req.originalUrl || req.path).split('?')[0];
    const routePattern = typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : undefined;

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
