import { randomUUID } from 'crypto';
import { NextFunction, Response } from 'express';

import { logRequest } from '../logger';
import { config } from '../config';
import { requestContext } from '../requestContext';
import type { RequestWithId } from './types';

export const REQUEST_ID_HEADER = 'X-Request-ID';

export function requestIdMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming?.trim() ? incoming.trim() : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    logRequest(
      {
        requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        status: res.statusCode,
        durationMs,
      },
      config.logLevel,
    );
  });

  requestContext.run({ requestId }, () => {
    next();
  });
}
