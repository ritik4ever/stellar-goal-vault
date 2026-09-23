import pino from 'pino';
import { getRequestId } from './requestContext';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
type LogFields = Record<string, unknown>;

export function normalizeLogLevel(rawLevel: string | undefined): LogLevel {
  const normalized = rawLevel?.trim().toLowerCase();
  return LOG_LEVELS.includes(normalized as LogLevel) ? (normalized as LogLevel) : 'info';
}

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: normalizeLogLevel(process.env.LOG_LEVEL),
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  redact: {
    paths: ['req.headers.authorization', 'headers.authorization', 'address', 'creator'],
    censor: (value: any, path: string[]) => {
      if (typeof value === 'string' && (path.includes('address') || path.includes('creator')) && value.startsWith('G') && value.length > 50) {
        return `${value.slice(0, 5)}...${value.slice(-5)}`;
      }
      return '[REDACTED]';
    }
  },
  mixin() {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  }
});

export function logInfo(event: string, fields: LogFields, _configuredLevel?: LogLevel): void {
  logger.info({ event, ...fields });
}

export function logError(
  error: unknown,
  context: {
    event?: string;
    requestId?: string;
    method?: string;
    path?: string;
    status?: number;
    [key: string]: unknown;
  },
  _configuredLevel?: LogLevel,
): void {
  const normalizedError =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');

  logger.error({
    ...context,
    event: context.event ?? 'error',
    err: {
      message: normalizedError.message,
      stack: normalizedError.stack,
      name: normalizedError.name,
    }
  });
}

/**
 * Coarse result of a request, for filtering without parsing status codes.
 * `aborted` means the client disconnected before the response finished.
 */
export type RequestOutcome = 'success' | 'client_error' | 'server_error' | 'aborted';

export function requestOutcome(status: number, aborted = false): RequestOutcome {
  if (aborted) return 'aborted';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'success';
}

export function logRequest(
  request: {
    requestId?: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    /** Matched Express route pattern, e.g. `/api/campaigns/:id/pledges`. */
    route?: string;
    /** Stable operation name: `<METHOD> <route>`, or `unmatched`. */
    operation?: string;
    campaignId?: string;
    /** Application error code (e.g. `VALIDATION_ERROR`) for failed requests. */
    errorCode?: string;
    aborted?: boolean;
  },
  _configuredLevel?: LogLevel,
): void {
  const durationMs = Number(request.durationMs.toFixed(2));
  logger.info({
    event: 'http_request',
    message: `${request.method} ${request.path} ${request.status} ${durationMs}ms`,
    requestId: request.requestId,
    operation: request.operation ?? 'unmatched',
    route: request.route,
    campaignId: request.campaignId,
    method: request.method,
    path: request.path,
    status: request.status,
    outcome: requestOutcome(request.status, request.aborted),
    errorCode: request.errorCode,
    duration_ms: durationMs,
  });
}

export function logLine(
  level: LogLevel,
  event: string,
  fields: LogFields,
  _configuredLevel?: LogLevel,
): void {
  if (level === 'debug') {
    logger.debug({ event, ...fields });
  } else if (level === 'warn') {
    logger.warn({ event, ...fields });
  } else if (level === 'error') {
    logger.error({ event, ...fields });
  } else {
    logger.info({ event, ...fields });
  }
}
