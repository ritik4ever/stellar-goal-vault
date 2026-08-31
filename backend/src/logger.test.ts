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

  it('logs requests as JSON with method, path, status, and duration', () => {
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
