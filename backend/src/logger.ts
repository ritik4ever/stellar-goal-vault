import pino from 'pino';
import { getRequestId } from './requestContext';


/**
 * Keys that must never appear in logs.
 * Covers auth headers, wallet material, and secret-configuration env/config fields
 * (API_KEYS, WEBHOOK_SECRET, SECRET_KEY, SERVER_PRIVATE_KEY, REDIS_URL, etc.).
 */
const SENSITIVE_KEY_RE =
  /^(authorization|cookie|set-cookie|x-api-key|api[_-]?keys?|secret|password|passwd|private[_-]?key|seed|mnemonic|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|wallet[_-]?secret|webhook[_-]?secret|secret[_-]?key|server[_-]?private[_-]?key|redis[_-]?url|database[_-]?url|db[_-]?url|connection[_-]?string)$/i;

/** Secret-configuration env var names (uppercase) used for presence-only summaries. */
export const SECRET_CONFIG_ENV_KEYS = [
  'API_KEYS',
  'WEBHOOK_SECRET',
  'SECRET_KEY',
  'SERVER_PRIVATE_KEY',
  'REDIS_URL',
  'DATABASE_URL',
] as const;

function redactUrlCredentials(value: string): string {
  // redis://:password@host / postgres://user:pass@host → keep structure, drop secrets
  return value.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)([^/@]*?)(:[^@]*)?@/i,
    (_m, scheme: string, user: string, _pass?: string) => {
      if (user === '' || user === ':') {
        return `${scheme}:***@`;
      }
      return `${scheme}${user}:***@`;
    },
  );
}

/**
 * Deep-redact sensitive keys and credential-bearing URL strings from log payloads.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') {
    if (/^Bearer\s+\S+/i.test(value)) return 'Bearer [REDACTED]';
    if (/^ghp_[A-Za-z0-9]+/.test(value) || /^gho_[A-Za-z0-9]+/.test(value)) return '[REDACTED_TOKEN]';
    if (/^[a-z][a-z0-9+.-]*:\/\/[^\s]*@[^\s]+/i.test(value)) return redactUrlCredentials(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : redactSensitive(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Redact a secret-configuration object (env snapshot / config dump) while keeping
 * useful diagnostic context: which secrets are set, without their values.
 */
export function redactSecretConfig(
  config: Record<string, unknown> | NodeJS.ProcessEnv,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY_RE.test(key)) {
      if (typeof value === 'string' && value.length === 0) {
        out[key] = '';
      } else if (typeof value === 'string' && key.toUpperCase().includes('API_KEY')) {
        const count = value.split(',').map((s) => s.trim()).filter(Boolean).length;
        out[key] = `[REDACTED:${count} key${count === 1 ? '' : 's'}]`;
      } else if (typeof value === 'string' && /url/i.test(key) && /:\/\//.test(value)) {
        out[key] = redactUrlCredentials(value).replace(/:\/\/[^@]*@/, '://***@');
        // still fully redact password-bearing URLs for secret config dumps
        out[key] = '[REDACTED_URL]';
      } else {
        out[key] = '[REDACTED]';
      }
      continue;
    }
    out[key] = redactSensitive(value);
  }
  return out;
}

/**
 * Presence-only summary of secret configuration for startup / failure-path logs.
 * Never includes secret values — only whether each known secret env var is set.
 */
export function summarizeSecretConfig(
  env: Record<string, string | undefined> = process.env,
): Record<string, boolean> {
  const summary: Record<string, boolean> = {};
  for (const key of SECRET_CONFIG_ENV_KEYS) {
    const raw = env[key];
    summary[`${key}_configured`] = Boolean(raw && String(raw).trim());
  }
  return summary;
}

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
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'req.headers.cookie',
      'headers.cookie',
      'req.body.password',
      'req.body.secret',
      'req.body.token',
      'req.body.api_key',
      'req.body.apiKey',
      'req.body.apiKeys',
      'req.body.wallet_secret',
      'req.body.walletSecret',
      'req.body.private_key',
      'req.body.privateKey',
      'req.body.mnemonic',
      'req.body.seed',
      'req.body.webhookSecret',
      'req.body.webhook_secret',
      'apiKeys',
      'API_KEYS',
      'webhookSecret',
      'WEBHOOK_SECRET',
      'SECRET_KEY',
      'SERVER_PRIVATE_KEY',
      'REDIS_URL',
      'redisUrl',
      'address',
      'creator',
    ],
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
  const safeFields = redactSensitive(fields) as LogFields;
  logger.info({ event, ...safeFields });
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

  const safeContext = redactSensitive(context) as typeof context;
  const safeMessage = redactSensitive(normalizedError.message);
  logger.error({
    ...safeContext,
    event: safeContext.event ?? 'error',
    err: {
      message: typeof safeMessage === 'string' ? safeMessage : normalizedError.message,
      stack: normalizedError.stack,
      name: normalizedError.name,
    }
  });
}

export function logRequest(
  request: {
    requestId?: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    headers?: Record<string, string>;
  },
  _configuredLevel?: LogLevel,
): void {
  const durationMs = Number(request.durationMs.toFixed(2));

  // Always emit http_request at info level so operators can filter by event name
  // without having to cross-correlate warn/error streams.  The status field
  // carries sufficient information to derive severity programmatically.
  logger.info({
    event: 'http_request',
    message: `${request.method} ${request.path} ${request.status} ${durationMs}ms`,
    requestId: request.requestId,
    method: request.method,
    path: request.path,
    status: request.status,
    duration_ms: durationMs,
  });
}

export function logLine(
  level: LogLevel,
  event: string,
  fields: LogFields,
  _configuredLevel?: LogLevel,
): void {
  const safeFields = redactSensitive(fields) as LogFields;
  if (level === 'debug') {
    logger.debug({ event, ...safeFields });
  } else if (level === 'warn') {
    logger.warn({ event, ...safeFields });
  } else if (level === 'error') {
    logger.error({ event, ...safeFields });
  } else {
    logger.info({ event, ...safeFields });
  }
}
