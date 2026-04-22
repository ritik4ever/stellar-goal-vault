export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

type LogFields = Record<string, unknown>;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function normalizeLogLevel(rawLevel: string | undefined): LogLevel {
  const normalized = rawLevel?.trim().toLowerCase();
  return LOG_LEVELS.includes(normalized as LogLevel) ? (normalized as LogLevel) : "info";
}

export function shouldLog(level: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

export function createLogLine(
  level: LogLevel,
  event: string,
  fields: LogFields,
  now: Date = new Date(),
): string {
  return JSON.stringify({
    timestamp: now.toISOString(),
    level,
    event,
    ...fields,
  });
}

function getConsoleMethod(level: LogLevel): (message?: unknown, ...optionalParams: unknown[]) => void {
  switch (level) {
    case "debug":
      return console.debug;
    case "warn":
      return console.warn;
    case "error":
      return console.error;
    case "info":
    default:
      return console.info;
  }
}

export function logLine(
  level: LogLevel,
  event: string,
  fields: LogFields,
  configuredLevel: LogLevel,
): void {
  if (!shouldLog(level, configuredLevel)) {
    return;
  }

  getConsoleMethod(level)(createLogLine(level, event, fields));
}

export function logInfo(event: string, fields: LogFields, configuredLevel: LogLevel): void {
  logLine("info", event, fields, configuredLevel);
}

export function logRequest(
  request: {
    requestId?: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
  },
  configuredLevel: LogLevel,
): void {
  const durationMs = Number(request.durationMs.toFixed(2));

  logInfo(
    "http_request",
    {
      message: `${request.method} ${request.path} ${request.status} ${durationMs}ms`,
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      status: request.status,
      durationMs,
    },
    configuredLevel,
  );
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
  configuredLevel: LogLevel,
): void {
  const normalizedError =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Unknown error");

  logLine(
    "error",
    typeof context.event === "string" ? context.event : "error",
    {
      ...context,
      message: normalizedError.message,
      stack: normalizedError.stack,
      errorName: normalizedError.name,
    },
    configuredLevel,
  );
}
