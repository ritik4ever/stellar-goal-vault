import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

function credentialsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function metricsBasicAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const expectedUsername = process.env.METRICS_USERNAME;
  const expectedPassword = process.env.METRICS_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    res.status(503).json({
      error: 'Metrics authentication is not configured.',
    });
    return;
  }

  const authorization = req.headers.authorization;
  const encoded = authorization?.startsWith('Basic ')
    ? authorization.slice('Basic '.length)
    : undefined;

  let username = '';
  let password = '';
  if (encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex >= 0) {
      username = decoded.slice(0, separatorIndex);
      password = decoded.slice(separatorIndex + 1);
    }
  }

  if (
    !credentialsMatch(username, expectedUsername) ||
    !credentialsMatch(password, expectedPassword)
  ) {
    res.setHeader('WWW-Authenticate', 'Basic realm="metrics", charset="UTF-8"');
    res.status(401).json({ error: 'Invalid metrics credentials.' });
    return;
  }

  next();
}
