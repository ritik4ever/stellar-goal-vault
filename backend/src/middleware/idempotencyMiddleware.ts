import crypto from 'crypto';
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

/** How long a request waits for an identical request that is already running. */
export const IN_FLIGHT_WAIT_MS = 10_000;

/**
 * Keys whose first request is still being processed in this process. A second
 * request with the same key waits for it instead of starting a second effect.
 * This is per process: it does not coordinate separate workers.
 */
const inFlight = new Map<string, Promise<void>>();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Order-independent hash of a request body. */
export function fingerprintRequestBody(body: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function contributorOf(req: Request): string {
  const contributor = (req.body as { contributor?: unknown } | undefined)?.contributor;
  return typeof contributor === 'string' ? contributor : '';
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Resolves true when the in-flight request finished, false if the wait timed out. */
async function waitFor(pending: Promise<void>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), IN_FLIGHT_WAIT_MS);
  });
  try {
    return await Promise.race([pending.then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Replay semantics for requests that carry an `Idempotency-Key` header:
 *
 * - The key is scoped to API key, campaign and contributor, so two contributors
 *   who happen to send the same key each get their own pledge.
 * - Only successful (2xx) responses are stored. A failed request leaves no
 *   record, so retrying it runs again.
 * - Repeating a stored request replays its response and has no further effect.
 * - Reusing a key with a different request body is rejected with 422
 *   `IDEMPOTENCY_KEY_REUSED`; the original response is never replayed for it.
 * - An identical request that arrives while the first is still running waits
 *   for it and then replays its response (409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`
 *   if the first does not finish within IN_FLIGHT_WAIT_MS).
 * - A stored response is replayable for 24 hours.
 */
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
  const cacheKey = buildIdempotencyCacheKey(apiKey, campaignId, idempotencyKey, contributorOf(req));
  const fingerprint = fingerprintRequestBody(req.body);

  const handle = async (): Promise<void> => {
    // Wait out any identical request that is already running.
    let pending = inFlight.get(cacheKey);
    while (pending) {
      if (!(await waitFor(pending))) {
        sendError(
          res,
          409,
          'IDEMPOTENCY_REQUEST_IN_PROGRESS',
          'A request with this Idempotency-Key is still being processed. Retry shortly.',
        );
        return;
      }
      pending = inFlight.get(cacheKey);
    }

    const cached = await getIdempotencyCacheEntry(cacheKey);
    if (cached) {
      if (cached.fingerprint && cached.fingerprint !== fingerprint) {
        sendError(
          res,
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used with a different request body.',
        );
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Idempotency-Cache', 'HIT');
      for (const [name, value] of Object.entries(cached.headers)) {
        res.setHeader(name, value);
      }
      (req as IdempotencyRequest & { finalOutcome?: string }).finalOutcome = 'idempotent_replay';
      res.status(cached.statusCode).send(cached.body);
      return;
    }

    // Claim the key until this response has been sent and stored.
    let release!: () => void;
    inFlight.set(
      cacheKey,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    let released = false;
    const releaseOnce = (): void => {
      if (released) return;
      released = true;
      inFlight.delete(cacheKey);
      release();
    };
    res.once('close', releaseOnce);

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
          fingerprint,
        };
        setIdempotencyCacheEntry(cacheKey, entry).catch(() => {
          // Silently fail cache writes
        });
        res.setHeader('X-Idempotency-Cache', 'MISS');
      }

      return originalSend(data);
    };

    next();
  };

  handle().catch(() => {
    if (!res.headersSent) {
      next();
    }
  });
}
