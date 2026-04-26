import { Request } from "express";

export interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  duration: string;
  requestId?: string;
  userAgent?: string;
  remoteIp?: string;
}

type RequestWithId = Request & { requestId?: string };

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  }

  return `${durationMs.toFixed(2)}ms`;
}

function toStatusLevel(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) {
    return "error";
  }
  if (statusCode >= 400) {
    return "warn";
  }
  return "info";
}

function getRequestPath(req: Request): string {
  const url = req.originalUrl ?? req.url ?? req.path;
  if (!url) {
    return "/";
  }

  const [pathOnly] = url.split("?");
  return pathOnly || "/";
}

function getRemoteIp(req: Request): string {
  const forwardedForHeader = req.headers["x-forwarded-for"];
  if (typeof forwardedForHeader === "string") {
    const [firstIp] = forwardedForHeader.split(",");
    if (firstIp) {
      return firstIp.trim();
    }
  }

  return req.socket.remoteAddress ?? "unknown";
}

export function createRequestLog(
  req: RequestWithId,
  statusCode: number,
  durationMs: number,
): RequestLog {
  return {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: getRequestPath(req),
    statusCode,
    durationMs: Number(durationMs.toFixed(2)),
    duration: formatDuration(durationMs),
    requestId: req.requestId,
    userAgent: req.get("user-agent"),
    remoteIp: getRemoteIp(req),
  };
}

export function logRequest(log: RequestLog): void {
  const level = toStatusLevel(log.statusCode);

  if (process.env.NODE_ENV === "production") {
    console.log(
      JSON.stringify({
        level,
        ...log,
      }),
    );
    return;
  }

  const requestIdSuffix = log.requestId ? ` requestId=${log.requestId}` : "";
  const remoteIpSuffix = log.remoteIp ? ` ip=${log.remoteIp}` : "";

  console.log(
    `[${log.timestamp}] ${log.method} ${log.path} status=${log.statusCode} duration=${log.duration}${requestIdSuffix}${remoteIpSuffix}`,
  );
}
