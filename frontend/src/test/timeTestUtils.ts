import { vi } from 'vitest';
import type { Campaign, CampaignProgress, CampaignStatus, Pledge } from '../types/campaign';

/**
 * Baseline deterministic test timestamp: 2026-01-01T00:00:00.000Z.
 * Using a fixed epoch guarantees identical results regardless of timezone,
 * leap seconds, or when/where CI executes.
 */
export const BASE_TEST_DATE_ISO = '2026-01-01T00:00:00.000Z';
export const BASE_TEST_TIME = new Date(BASE_TEST_DATE_ISO).getTime(); // 1767225600000 ms
export const BASE_TEST_TIME_SEC = Math.floor(BASE_TEST_TIME / 1000); // 1767225600 sec

/**
 * Configure fake timers with system time pinned to a deterministic baseline.
 */
export function setupDeterministicTime(
  baseline: Date | number | string = BASE_TEST_TIME,
): void {
  vi.useFakeTimers();
  const time = typeof baseline === 'string' || typeof baseline === 'number'
    ? new Date(baseline)
    : baseline;
  vi.setSystemTime(time);
}

/**
 * Restore real timers and tear down fake timer mocking.
 */
export function resetDeterministicTime(): void {
  vi.useRealTimers();
}

/**
 * Advance mocked system time and fake timers by milliseconds.
 */
export function advanceTime(ms: number): void {
  vi.advanceTimersByTime(ms);
}

/**
 * Advance mocked system time and fake timers by seconds.
 */
export function advanceTimeBySeconds(seconds: number): void {
  advanceTime(seconds * 1000);
}

/**
 * Advance mocked system time and fake timers by hours.
 */
export function advanceTimeByHours(hours: number): void {
  advanceTime(hours * 3600 * 1000);
}

/**
 * Advance mocked system time and fake timers by days.
 */
export function advanceTimeByDays(days: number): void {
  advanceTime(days * 86400 * 1000);
}

/**
 * Set the system time to a specific target without advancing past intermediate timers.
 */
export function setTestSystemTime(target: Date | number | string): void {
  const time = typeof target === 'string' || typeof target === 'number'
    ? new Date(target)
    : target;
  vi.setSystemTime(time);
}

/**
 * Execute a callback within an isolated deterministic time environment.
 * Timers are guaranteed to be restored to their previous state after execution.
 */
export async function withDeterministicTime<T>(
  baseline: Date | number | string,
  fn: () => T | Promise<T>,
): Promise<T> {
  setupDeterministicTime(baseline);
  try {
    return await fn();
  } finally {
    resetDeterministicTime();
  }
}

/**
 * Create a deterministic Date relative to the fixed baseline date.
 */
export function createDeterministicDate(offsetDays: number = 0, offsetHours: number = 0): Date {
  const d = new Date(BASE_TEST_TIME);
  if (offsetDays !== 0) d.setUTCDate(d.getUTCDate() + offsetDays);
  if (offsetHours !== 0) d.setUTCHours(d.getUTCHours() + offsetHours);
  return d;
}

/**
 * Create a deterministic second-level timestamp relative to the baseline.
 */
export function createDeterministicTimestampSec(offsetSeconds: number = 0): number {
  return BASE_TEST_TIME_SEC + offsetSeconds;
}

/**
 * Default progress object for deterministic campaigns.
 */
export const defaultDeterministicProgress: CampaignProgress = {
  status: 'open',
  percentFunded: 50,
  remainingAmount: 5000,
  pledgeCount: 2,
  hoursLeft: 24,
  canPledge: true,
  canClaim: false,
  canRefund: false,
};

/**
 * Factory for creating deterministic Campaign entities for unit tests.
 * Default values use fixed timestamps rather than wall-clock Date.now().
 */
export function createDeterministicCampaign(
  overrides: Partial<Campaign> = {},
): Campaign {
  const createdAt = overrides.createdAt ?? createDeterministicTimestampSec(-86400); // 1 day ago
  const deadline = overrides.deadline ?? createDeterministicTimestampSec(86400); // 1 day in the future

  return {
    id: 'campaign-deterministic-1',
    creator: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    title: 'Deterministic Test Campaign',
    description: 'A test campaign with deterministic deadlines and timestamps.',
    acceptedTokens: ['USDC'],
    assetCode: 'USDC',
    targetAmount: 10000,
    pledgedAmount: 5000,
    deadline,
    createdAt,
    progress: {
      ...defaultDeterministicProgress,
      ...overrides.progress,
    },
    pledges: [],
    metadata: {
      imageUrl: 'https://example.com/banner.jpg',
      externalLink: 'https://example.com',
    },
    ...overrides,
  };
}

/**
 * Factory for creating deterministic Pledge entities.
 */
export function createDeterministicPledge(
  overrides: Partial<Pledge> = {},
): Pledge {
  return {
    id: 1,
    campaignId: 'campaign-deterministic-1',
    contributor: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    amount: 100,
    assetCode: 'USDC',
    createdAt: createDeterministicTimestampSec(-3600),
    ...overrides,
  };
}

/**
 * Computes deterministic remaining time and expiration flag.
 */
export function getDeterministicLifecycleState(
  deadlineSec: number,
  currentSec: number = Math.floor(Date.now() / 1000),
): {
  isExpired: boolean;
  secondsRemaining: number;
  hoursRemaining: number;
  daysRemaining: number;
} {
  const diffSec = deadlineSec - currentSec;
  const isExpired = diffSec <= 0;
  const remaining = isExpired ? 0 : diffSec;

  return {
    isExpired,
    secondsRemaining: remaining,
    hoursRemaining: Math.floor(remaining / 3600),
    daysRemaining: Math.floor(remaining / 86400),
  };
}
