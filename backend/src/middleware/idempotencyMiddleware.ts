import type { Request, Response, NextFunction } from 'express';
import {
  getIdempotencyCacheEntry,
  setIdempotencyCacheEntry,
  buildIdempotencyCacheKey,
} from '../services/idempotencyCache';
import type { RequestWithApiKey } from './apiKeyAuth';

interface IdempotencyRequest extends Request {
  idempotencyKey?: string;
}

export function idempotencyMiddleware(
  req: IdempotencyRequest,
  res: Response,
  next: NextFunction,
): void {
  const idempotencyKey = req.header('Idempotency-Key');

  if (!idempotencyKey) {
    return next();
  }

  const apiKey = (req as unknown as RequestWithApiKey).apiKey ?? 'anonymous';
  const campaignId = req.params.id as string;
  const cacheKey = buildIdempotencyCacheKey(apiKey, campaignId, idempotencyKey);

  getIdempotencyCacheEntry(cacheKey).then(
    (cached) => {
      if (cached) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-Idempotency-Cache', 'HIT');
        for (const [name, value] of Object.entries(cached.headers)) {
          res.setHeader(name, value);
        }
        res.status(cached.statusCode).send(cached.body);
        return;
      }

      const originalSend = res.send.bind(res);
      res.send = function (data: unknown) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = typeof data === 'string' ? data : JSON.stringify(data);
          const entry = {
            statusCode: res.statusCode,
            body,
            headers: {
              'Content-Type': res.getHeader('Content-Type') as string,
            },
          };
          setIdempotencyCacheEntry(cacheKey, entry).catch(() => {
            // Silently fail cache writes
          });
          res.setHeader('X-Idempotency-Cache', 'MISS');
        }

        return originalSend(data);
      };

      next();
    },
    () => {
      next();
    },
  );
}