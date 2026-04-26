import { NextFunction, Request, Response } from "express";
import { createRequestLog, logRequest } from "../services/logger";

type RequestWithId = Request & { requestId?: string };

export function requestLoggingMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs) / 1_000_000;

    const requestLog = createRequestLog(req, res.statusCode, durationMs);
    logRequest(requestLog);
  });

  next();
}
