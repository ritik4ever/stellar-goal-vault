import { config } from '../config';

/**
 * Freshness / lag tracking for background and derived-state work.
 *
 * Each tracked job records the outcome of every run. `snapshot()` turns those
 * records into a state that lets operators tell apart:
 *
 *   healthy  - last run succeeded recently and processed work
 *   idle     - last run succeeded recently and had nothing to process
 *   stale    - no successful run within the job's stale threshold
 *   failing  - the most recent runs are erroring (consecutive failures)
 *   starting - started, has not run yet, still inside the stale threshold
 *   disabled - not configured to run (e.g. no CONTRACT_ID)
 *
 * "Last success" only moves on a real success. A run with nothing to process is
 * a success (`processed: 0`), so an idle job never looks stale.
 *
 * See docs/JOB_HEALTH.md for how operators should read these fields.
 */

export type JobState = 'healthy' | 'idle' | 'stale' | 'failing' | 'starting' | 'disabled';

/** Hard ceiling for any reported ledger lag so the value stays bounded. */
export const MAX_LEDGER_LAG = 1_000_000;

/** Longest error message kept in `last_error`, so a noisy failure cannot bloat the payload. */
const MAX_ERROR_LENGTH = 200;

export interface JobHealthOptions {
  name: string;
  /**
   * Seconds without a successful run after which the job is `stale`.
   * `null` for event-driven jobs that have no expected cadence.
   */
  staleAfterSeconds: number | null;
  /** Consecutive failures at which the job is `failing`. Defaults to config. */
  failingAfterFailures?: number;
  /** Upper bound for `freshness_lag_seconds`. Defaults to config. */
  maxLagSeconds?: number;
  /** `false` reports the job as `disabled`. Defaults to true. */
  enabled?: boolean;
  /** Injected clock in milliseconds since epoch. Defaults to Date.now. */
  clock?: () => number;
}

export interface JobSuccessInfo {
  /** Units of work handled by this run. 0 means "ran fine, nothing to do". */
  processed?: number;
  /** Job-specific numeric signals (e.g. ledger lag). Replaced on every success. */
  details?: Record<string, number | null>;
}

export interface JobHealthSnapshot {
  name: string;
  state: JobState;
  last_success_timestamp_seconds: number | null;
  last_attempt_timestamp_seconds: number | null;
  last_failure_timestamp_seconds: number | null;
  /** Seconds since the last success (or since start if none yet), clamped to [0, max]. */
  freshness_lag_seconds: number | null;
  stale_after_seconds: number | null;
  consecutive_failures: number;
  total_failures: number;
  total_successes: number;
  last_error: string | null;
  /** `processed` of the last successful run; null before the first success. */
  last_run_processed: number | null;
  details: Record<string, number | null>;
}

/** Clamps a lag into `[0, max]`. Negative (clock skew) and NaN become 0; Infinity becomes max. */
export function clampLag(value: number, max: number): number {
  if (Number.isNaN(value) || value < 0) return 0;
  return Math.min(value, max);
}

function toSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, MAX_ERROR_LENGTH);
}

export class JobHealthTracker {
  readonly name: string;
  private readonly staleAfterSeconds: number | null;
  private readonly failingAfterFailures: number;
  private readonly maxLagSeconds: number;
  private readonly clock: () => number;
  private enabled: boolean;

  private startedAtMs: number;
  private lastSuccessMs: number | null = null;
  private lastAttemptMs: number | null = null;
  private lastFailureMs: number | null = null;
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastError: string | null = null;
  private lastRunProcessed: number | null = null;
  private details: Record<string, number | null> = {};

  constructor(options: JobHealthOptions) {
    this.name = options.name;
    this.staleAfterSeconds = options.staleAfterSeconds;
    this.failingAfterFailures = options.failingAfterFailures ?? config.jobFailingAfterFailures;
    this.maxLagSeconds = options.maxLagSeconds ?? config.jobMaxReportedLagSeconds;
    this.enabled = options.enabled ?? true;
    this.clock = options.clock ?? Date.now;
    this.startedAtMs = this.clock();
  }

  /** Re-bases the "never ran" clock; call when the job's scheduler actually starts. */
  markStarted(): void {
    this.startedAtMs = this.clock();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  recordSuccess(info: JobSuccessInfo = {}): void {
    const now = this.clock();
    this.lastAttemptMs = now;
    this.lastSuccessMs = now;
    this.consecutiveFailures = 0;
    this.totalSuccesses += 1;
    this.lastRunProcessed = info.processed ?? 0;
    this.details = { ...(info.details ?? {}) };
  }

  /** Records a failed run. Never touches the last-success timestamp. */
  recordFailure(err: unknown): void {
    const now = this.clock();
    this.lastAttemptMs = now;
    this.lastFailureMs = now;
    this.consecutiveFailures += 1;
    this.totalFailures += 1;
    this.lastError = describeError(err);
  }

  snapshot(): JobHealthSnapshot {
    const now = this.clock();
    const reference = this.lastSuccessMs ?? this.startedAtMs;
    const lagSeconds = this.enabled
      ? clampLag(Math.floor((now - reference) / 1000), this.maxLagSeconds)
      : null;

    return {
      name: this.name,
      state: this.resolveState(lagSeconds),
      last_success_timestamp_seconds:
        this.lastSuccessMs === null ? null : toSeconds(this.lastSuccessMs),
      last_attempt_timestamp_seconds:
        this.lastAttemptMs === null ? null : toSeconds(this.lastAttemptMs),
      last_failure_timestamp_seconds:
        this.lastFailureMs === null ? null : toSeconds(this.lastFailureMs),
      freshness_lag_seconds: lagSeconds,
      stale_after_seconds: this.staleAfterSeconds,
      consecutive_failures: this.consecutiveFailures,
      total_failures: this.totalFailures,
      total_successes: this.totalSuccesses,
      last_error: this.lastError,
      last_run_processed: this.lastRunProcessed,
      details: { ...this.details },
    };
  }

  private resolveState(lagSeconds: number | null): JobState {
    if (!this.enabled || lagSeconds === null) return 'disabled';
    // Failing outranks stale: it names the cause (attempts are erroring)
    // rather than only the symptom (no recent success).
    if (this.consecutiveFailures >= this.failingAfterFailures) return 'failing';
    if (this.staleAfterSeconds !== null && lagSeconds > this.staleAfterSeconds) return 'stale';
    if (this.lastSuccessMs === null) {
      return this.staleAfterSeconds === null ? 'idle' : 'starting';
    }
    return this.lastRunProcessed === 0 ? 'idle' : 'healthy';
  }
}

const registry = new Map<string, JobHealthTracker>();

/** Registers (or replaces) a tracker so it shows up in `getJobHealthSnapshots()`. */
export function registerJob(options: JobHealthOptions): JobHealthTracker {
  const tracker = new JobHealthTracker(options);
  registry.set(options.name, tracker);
  return tracker;
}

export function getJobHealthSnapshots(): Record<string, JobHealthSnapshot> {
  const result: Record<string, JobHealthSnapshot> = {};
  for (const [name, tracker] of registry) {
    result[name] = tracker.snapshot();
  }
  return result;
}

export function resetJobRegistryForTests(): void {
  registry.clear();
}
