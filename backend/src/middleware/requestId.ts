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

const SENSITIVE_QUERY_PARAMS = new Set([
  'authorization',
  'token',
  'secret',
  'password',
  'passphrase',
  'key',
  'api_key',
  'apiKey',
  'wallet_secret',
  'walletSecret',
  'private_key',
  'privateKey',
  'client_secret',
  'clientSecret',
  'webhook_secret',
  'webhookSecret',
  'signature',
  'access_token',
  'refresh_token',
  'session_token',
  'code',
]);

/**
 * Redacts sensitive values from a URL string.
 */
function redactUrl(url: string): string {
  try {
    const urlObj = new URL(url, 'http://localhost');
    // Redact query parameters
    const searchParams = urlObj.searchParams;
    for (const key of searchParams.keys()) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        searchParams.set(key, '[REDACTED]');
      }
    }
    // Reconstruct URL with redacted query string
    const redactedPath = urlObj.pathname + urlObj.search;
    return redactedPath;
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

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

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    // Redact sensitive information from request context for logging
    const redactedPath = redactUrl(req.originalUrl || req.path);
    const redactedHeaders = redactHeaders(req.headers as Record<string, string>);

    const finalOutcome = req.finalOutcome || (res.statusCode >= 400 ? 'failure' : 'success');

    logRequest(
      {
        requestId,
        method: req.method,
        path: redactedPath,
        status: res.statusCode,
        durationMs,
        headers: redactedHeaders,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        retryCount: req.retryCount,
        retryReason: req.retryReason,
        finalOutcome,
      },
      config.logLevel,
    );
  });

  requestContext.run({ requestId }, () => {
    next();
  });
}
