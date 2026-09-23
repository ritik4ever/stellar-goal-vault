import { vi } from 'vitest';

import type { CampaignInput, PledgeInput } from '../src/services/campaignStore';

/**
 * Reusable, deterministic fixtures for the API integration suite.
 *
 * Goals (issue #978):
 * - Builders for campaigns, pledges, and wallets so tests don't copy large
 *   setup blocks.
 * - A frozen clock so time-dependent states (open/funded/failed) never depend
 *   on the wall clock and cannot flake at day boundaries.
 *
 * Nothing here performs I/O; import these into tests and pass the results to
 * the store or the HTTP API.
 */

/** Fixed reference instant (2023-11-14T22:13:20Z) used for all time-dependent fixtures. */
export const FIXTURE_EPOCH_SECONDS = 1_700_000_000;

export const ONE_HOUR_SECONDS = 3_600;
export const ONE_DAY_SECONDS = 86_400;

/** Deterministic Stellar-looking account address: `G` followed by 55 repeats. */
export function buildAddress(fill: string): string {
  const char =
    fill
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .charAt(0) || 'A';
  return `G${char.repeat(55)}`;
}

/** Named wallets shared across the suite (all valid 56-char account ids). */
export const WALLETS = {
  creator: buildAddress('A'),
  alice: buildAddress('B'),
  bob: buildAddress('C'),
  carol: buildAddress('D'),
} as const;

/**
 * Default future deadline relative to {@link FIXTURE_EPOCH_SECONDS}. Callers
 * that freeze the clock get a deterministic open campaign.
 */
export const DEFAULT_DEADLINE = FIXTURE_EPOCH_SECONDS + ONE_DAY_SECONDS;

/** Build a campaign input with sensible, deterministic defaults. */
export function buildCampaignInput(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return {
    creator: WALLETS.creator,
    title: 'Fixture campaign',
    description: 'Deterministic campaign fixture with a sufficiently long description',
    acceptedTokens: ['USDC'],
    targetAmount: 1_000,
    deadline: DEFAULT_DEADLINE,
    ...overrides,
  };
}

/** Build a pledge input with sensible, deterministic defaults. */
export function buildPledgeInput(overrides: Partial<PledgeInput> = {}): PledgeInput {
  return {
    contributor: WALLETS.alice,
    amount: 100,
    assetCode: 'USDC',
    ...overrides,
  };
}

export interface Clock {
  /** Move the frozen clock to a new instant (seconds since the epoch). */
  set(seconds: number): void;
  /** Advance the frozen clock by a number of seconds. */
  advance(seconds: number): void;
  /** Restore the real clock. */
  restore(): void;
}

/**
 * Freeze `Date.now()` to a fixed instant so campaign status is deterministic.
 * Always restore in `afterEach` (or use `try/finally`).
 */
export function freezeClock(seconds: number = FIXTURE_EPOCH_SECONDS): Clock {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(seconds * 1000);
  let current = seconds;
  return {
    set(next: number) {
      current = next;
      spy.mockReturnValue(current * 1000);
    },
    advance(delta: number) {
      current += delta;
      spy.mockReturnValue(current * 1000);
    },
    restore() {
      spy.mockRestore();
    },
  };
}
