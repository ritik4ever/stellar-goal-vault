import { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { getDb } from './services/db';

export const metricsRegistry = new Registry();

const requestCount = new Counter({
  name: 'request_count',
  help: 'Total number of HTTP requests.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

const requestDuration = new Histogram({
  name: 'request_duration_ms',
  help: 'HTTP request duration in milliseconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [metricsRegistry],
});

const errorCount = new Counter({
  name: 'error_count',
  help: 'Total number of HTTP responses with a 4xx or 5xx status.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

new Gauge({
  name: 'pledge_count',
  help: 'Current number of persisted pledges.',
  registers: [metricsRegistry],
  collect() {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS count FROM pledges')
      .get() as { count: number };
    this.set(row.count);
  },
});

new Gauge({
  name: 'campaign_count',
  help: 'Current number of persisted campaigns.',
  registers: [metricsRegistry],
  collect() {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS count FROM campaigns')
      .get() as { count: number };
    this.set(row.count);
  },
});

function routeLabel(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath !== 'string') {
    return 'unmatched';
  }

  return `${req.baseUrl}${routePath}` || '/';
}

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === '/metrics') {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(res.statusCode),
    };
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    requestCount.inc(labels);
    requestDuration.observe(labels, durationMs);
    if (res.statusCode >= 400) {
      errorCount.inc(labels);
    }
  });

  next();
}

export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}
