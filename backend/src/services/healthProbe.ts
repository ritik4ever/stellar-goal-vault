import { config } from '../config';
import { logLine } from '../logger';

/**
 * Soroban RPC probe used by GET /api/health/deep, with bounded retries and
 * retry visibility (issue #1035).
 *
 * Each failed attempt that will be retried emits one `health_check_retry` warn
 * line. The probe itself never logs an outcome: the caller folds the returned
 * attempt summary into its single `health_check` line, so a check that
 * recovers after retries produces exactly one success signal.
 *
 * Retry reasons are classified codes (`timeout`, `http_503`,
 * `network_error:ECONNREFUSED`), never raw error messages, because those can
 * echo the RPC URL (which may embed provider API keys) or request details.
 */

export type RpcProbeResult = {
  healthy: boolean;
  /** Attempts made; 0 when no RPC URL is configured. */
  attempts: number;
  /** Retries performed (attempts - 1 once at least one attempt ran). */
  retryCount: number;
  /** Reason for each failed attempt that triggered a retry, in order. */
  retryReasons: string[];
  /** Reason the final attempt failed, or null when the probe succeeded. */
  failureReason: string | null;
};

export type RpcProbeOptions = {
  rpcUrl?: string;
  maxAttempts?: number;
  initialDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Map a thrown fetch error to a secret-free reason code. */
export function classifyProbeError(error: unknown): string {
  const err = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const name = typeof err?.name === 'string' ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return 'timeout';
  }

  const code = err?.cause?.code ?? err?.code;
  if (typeof code === 'string' && ERROR_CODE_RE.test(code)) {
    return `network_error:${code}`;
  }
  return 'network_error';
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function probeSorobanRpc(options: RpcProbeOptions = {}): Promise<RpcProbeResult> {
  const rpcUrl = options.rpcUrl ?? config.sorobanRpcUrl;
  const maxAttempts = Math.max(1, options.maxAttempts ?? config.healthCheckRpcMaxAttempts);
  const initialDelayMs = options.initialDelayMs ?? config.healthCheckRpcRetryDelayMs;
  const timeoutMs = options.timeoutMs ?? 5000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  const retryReasons: string[] = [];

  if (!rpcUrl) {
    return { healthy: false, attempts: 0, retryCount: 0, retryReasons, failureReason: null };
  }

  let attempt = 0;
  let failureReason: string | null = null;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const response = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'getHealth', id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 4xx means the RPC answered; only 5xx is treated as unhealthy.
      if (response.ok || response.status < 500) {
        return { healthy: true, attempts: attempt, retryCount: attempt - 1, retryReasons, failureReason: null };
      }
      failureReason = `http_${response.status}`;
    } catch (error) {
      failureReason = classifyProbeError(error);
    }

    if (attempt < maxAttempts) {
      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      retryReasons.push(failureReason);
      logLine(
        'warn',
        'health_check_retry',
        {
          operation: 'health_check_deep',
          component: 'soroban_rpc',
          attempt,
          max_attempts: maxAttempts,
          reason: failureReason,
          next_retry_ms: delayMs,
        },
        config.logLevel,
      );
      await sleep(delayMs);
    }
  }

  return { healthy: false, attempts: attempt, retryCount: attempt - 1, retryReasons, failureReason };
}
