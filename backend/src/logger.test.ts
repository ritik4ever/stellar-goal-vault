import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, logError, logRequest, normalizeLogLevel } from './logger';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes log levels', () => {
    expect(normalizeLogLevel('ERROR')).toBe('error');
    expect(normalizeLogLevel('invalid')).toBe('info');
    expect(normalizeLogLevel('debug')).toBe('debug');
  });

  it('logs success requests as info with structured fields', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logRequest(
      {
        requestId: 'req-123',
        method: 'POST',
        path: '/api/campaigns',
        status: 201,
        durationMs: 18.567,
      },
      'info',
    );

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = infoSpy.mock.calls[0][0] as any;

    expect(payload).toMatchObject({
      event: 'http_request',
      requestId: 'req-123',
      method: 'POST',
      path: '/api/campaigns',
      status: 201,
      duration_ms: 18.57,
    });
    expect(payload.message).toContain('POST /api/campaigns 201');
  });

  // http_request is always emitted at info level so operators can filter by
  // event name without cross-correlating warn/error streams.  The status field
  // carries sufficient information to derive severity programmatically.
  it('logs 4xx requests via logger.info (status field carries severity)', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logRequest(
      {
        requestId: 'req-456',
        method: 'GET',
        path: '/api/not-found',
        status: 404,
        durationMs: 5.123,
      },
      'info',
    );

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = infoSpy.mock.calls[0][0] as any;

    expect(payload).toMatchObject({
      event: 'http_request',
      requestId: 'req-456',
      method: 'GET',
      path: '/api/not-found',
      status: 404,
      duration_ms: 5.12,
    });
  });

  it('logs 5xx requests via logger.info (status field carries severity)', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logRequest(
      {
        requestId: 'req-789',
        method: 'POST',
        path: '/api/error',
        status: 500,
        durationMs: 12.345,
      },
      'info',
    );

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = infoSpy.mock.calls[0][0] as any;

    expect(payload).toMatchObject({
      event: 'http_request',
      requestId: 'req-789',
      method: 'POST',
      path: '/api/error',
      status: 500,
      duration_ms: 12.35,
    });
  });

  it('logs errors with the message and stack', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const err = new Error('Boom');

    logError(err, { event: 'request_error', path: '/api/campaigns', status: 500 }, 'info');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = errorSpy.mock.calls[0][0] as any;

    expect(payload).toMatchObject({
      event: 'request_error',
      path: '/api/campaigns',
      status: 500,
    });
    expect(payload.err.message).toBe('Boom');
    expect(payload.err.stack).toContain('Boom');
    expect(payload.err.name).toBe('Error');
  });
});

describe('redactSensitive (issue #965)', () => {
  it('redacts authorization headers and tokens from dependency/log payloads', async () => {
    const { redactSensitive } = await import('./logger');
    const redacted = redactSensitive({
      authorization: 'Bearer secret-token',
      apiKey: 'abc',
      message: 'ok',
      nested: { privateKey: '0xdead', path: '/deps' },
    }) as Record<string, unknown>;
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.message).toBe('ok');
    expect((redacted.nested as Record<string, unknown>).privateKey).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).path).toBe('/deps');
  });
});

describe('redactSecretConfig (issue #955)', () => {
  it('redacts secret configuration values while preserving non-secret diagnostics', async () => {
    const { redactSecretConfig, summarizeSecretConfig } = await import('./logger');

    const redacted = redactSecretConfig({
      NODE_ENV: 'production',
      PORT: '3001',
      API_KEYS: 'key-one,key-two',
      WEBHOOK_SECRET: 'super-secret-webhook',
      SECRET_KEY: 'deploy-key',
      SERVER_PRIVATE_KEY: 'SXXXX',
      REDIS_URL: 'redis://:hunter2@cache.internal:6379/0',
      CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      nested: { webhookSecret: 'nested-secret', path: '/health' },
    });

    expect(redacted.NODE_ENV).toBe('production');
    expect(redacted.PORT).toBe('3001');
    expect(redacted.CONTRACT_ID).toBe('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(redacted.API_KEYS).toBe('[REDACTED:2 keys]');
    expect(redacted.WEBHOOK_SECRET).toBe('[REDACTED]');
    expect(redacted.SECRET_KEY).toBe('[REDACTED]');
    expect(redacted.SERVER_PRIVATE_KEY).toBe('[REDACTED]');
    expect(redacted.REDIS_URL).toBe('[REDACTED_URL]');
    expect((redacted.nested as Record<string, unknown>).webhookSecret).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).path).toBe('/health');

    const summary = summarizeSecretConfig({
      API_KEYS: 'a,b',
      WEBHOOK_SECRET: 'x',
      SECRET_KEY: '',
      SERVER_PRIVATE_KEY: undefined,
      REDIS_URL: 'redis://localhost',
      DATABASE_URL: '',
    });
    expect(summary).toEqual({
      API_KEYS_configured: true,
      WEBHOOK_SECRET_configured: true,
      SECRET_KEY_configured: false,
      SERVER_PRIVATE_KEY_configured: false,
      REDIS_URL_configured: true,
      DATABASE_URL_configured: false,
    });
  });

  it('redacts credential-bearing URLs and secret keys via redactSensitive', async () => {
    const { redactSensitive } = await import('./logger');
    const redacted = redactSensitive({
      redisUrl: 'redis://:hunter2@cache:6379',
      API_KEYS: 'k1,k2',
      webhook_secret: 'whsec',
      note: 'config ok',
    }) as Record<string, unknown>;
    expect(redacted.redisUrl).toBe('[REDACTED]');
    expect(redacted.API_KEYS).toBe('[REDACTED]');
    expect(redacted.webhook_secret).toBe('[REDACTED]');
    expect(redacted.note).toBe('config ok');
  });
});
