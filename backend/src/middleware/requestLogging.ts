import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { RequestWithId } from './types';

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    
    // Using string replacement or URL parse to remove query string
    const path = req.originalUrl.split('?')[0];

    const requestId = (req as RequestWithId).requestId;
    const logData = {
      method: req.method,
      path: path,
      statusCode: res.statusCode,
      durationMs,
      duration: `${durationMs.toFixed(2)}ms`,
      requestId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    if (process.env.NODE_ENV === 'production') {
      logger.info(logData);
    } else {
      logger.info(`[${new Date().toISOString()}] ${req.method} ${path} status=${res.statusCode} duration=${durationMs.toFixed(2)}ms requestId=${logData.requestId || ''} ip=${req.ip || ''}`);
    }
  });

  next();
}
