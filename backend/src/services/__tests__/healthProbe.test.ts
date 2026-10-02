import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../logger';
import { classifyProbeError, probeSorobanRpc } from '../healthProbe';

/**
 * Retry visibility for the deep health check Soroban RPC probe (issue #1035).
 */

const RPC_URL = 'https://user:fake-pass-1@rpc.example.test/v1?apikey=FAKE-RPC-KEY-123';
const SECRETS = ['fake-pass-1', 'FAKE-RPC-KEY-123', 'rpc.example.test'];

function connectError(code: string): Error {
  // Mirrors undici: a generic TypeError whose cause carries the errno code and
  // host details that must never reach logs.
  return Object.assign(new TypeError(`fetch failed to ${RPC_URL}`), {
    cause: Object.assign(new Error(`connect ${code} ${RPC_URL}`), { code }),
  });
}

function response(status: number): Response {
  return new Response('{}', { status });
}

function captureWarn() {
  return vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
}

function retryLines(spy: ReturnType<typeof captureWarn>) {
  return spy.mock.calls
    .map(([payload]) => payload as unknown as Record<string, unknown>)
    .filter((payload) => payload?.event === 'health_check_retry');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeSorobanRpc', () => {
  it('logs one retry line per failure, then reports success after N retries', async () => {
    const warnSpy = captureWarn();
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(connectError('ECONNREFUSED'))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await probeSorobanRpc({
      rpcUrl: RPC_URL,
      maxAttempts: 3,
      initialDelayMs: 100,
      fetchImpl,
      sleep,
    });

    expect(result).toEqual({
      healthy: true,
      attempts: 3,
      retryCount: 2,
      retryReasons: ['network_error:ECONNREFUSED', 'http_503'],
      failureReason: null,
    });
    expect(sleep.mock.calls).toEqual([[100], [200]]);

    const lines = retryLines(warnSpy);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      operation: 'health_check_deep',
      component: 'soroban_rpc',
      attempt: 1,
      max_attempts: 3,
      reason: 'network_error:ECONNREFUSED',
      next_retry_ms: 100,
    });
    expect(lines[1]).toMatchObject({ attempt: 2, reason: 'http_503', next_retry_ms: 200 });

    // Retry lines never carry an outcome, and the probe emits no success line of
    // its own: the caller's single health_check line owns the outcome.
    for (const line of lines) expect(line).not.toHaveProperty('outcome');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('reports the final failure reason when every attempt fails', async () => {
    const warnSpy = captureWarn();
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(502))
      .mockRejectedValueOnce(connectError('ENOTFOUND'))
      .mockRejectedValueOnce(timeout);

    const result = await probeSorobanRpc({
      rpcUrl: RPC_URL,
      maxAttempts: 3,
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result).toEqual({
      healthy: false,
      attempts: 3,
      retryCount: 2,
      retryReasons: ['http_502', 'network_error:ENOTFOUND'],
      failureReason: 'timeout',
    });
    // No retry is scheduled after the last attempt.
    expect(retryLines(warnSpy)).toHaveLength(2);
  });

  it('does not retry when the first attempt succeeds', async () => {
    const warnSpy = captureWarn();
    const fetchImpl = vi.fn().mockResolvedValue(response(200));

    const result = await probeSorobanRpc({ rpcUrl: RPC_URL, maxAttempts: 3, fetchImpl });

    expect(result).toMatchObject({ healthy: true, attempts: 1, retryCount: 0, retryReasons: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(retryLines(warnSpy)).toHaveLength(0);
  });

  it('treats 4xx as reachable and does not retry it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(405));

    const result = await probeSorobanRpc({ rpcUrl: RPC_URL, maxAttempts: 3, fetchImpl });

    expect(result).toMatchObject({ healthy: true, attempts: 1, retryCount: 0 });
  });

  it('makes no attempts when no RPC URL is configured', async () => {
    const fetchImpl = vi.fn();

    const result = await probeSorobanRpc({ rpcUrl: '', fetchImpl });

    expect(result).toEqual({
      healthy: false,
      attempts: 0,
      retryCount: 0,
      retryReasons: [],
      failureReason: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never writes the RPC URL, credentials or raw error text to retry logs', async () => {
    const warnSpy = captureWarn();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(connectError('ECONNRESET'))
      .mockRejectedValueOnce(new Error(`request to ${RPC_URL} failed`))
      .mockResolvedValueOnce(response(200));

    const result = await probeSorobanRpc({
      rpcUrl: RPC_URL,
      maxAttempts: 3,
      fetchImpl,
      sleep: async () => undefined,
    });

    const serialized = JSON.stringify([warnSpy.mock.calls, result]);
    for (const secret of SECRETS) {
      expect(serialized, `logs leaked "${secret}"`).not.toContain(secret);
    }
    expect(result.retryReasons).toEqual(['network_error:ECONNRESET', 'network_error']);
  });
});

describe('classifyProbeError', () => {
  it('maps timeouts and aborts to "timeout"', () => {
    expect(classifyProbeError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timeout');
    expect(classifyProbeError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('timeout');
  });

  it('keeps only well-formed errno codes', () => {
    expect(classifyProbeError({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })).toBe(
      'network_error:UND_ERR_CONNECT_TIMEOUT',
    );
    expect(classifyProbeError({ code: 'https://secret@host' })).toBe('network_error');
    expect(classifyProbeError('boom')).toBe('network_error');
    expect(classifyProbeError(null)).toBe('network_error');
  });
});
