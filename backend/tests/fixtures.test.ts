import { describe, expect, it } from 'vitest';

import {
  buildAddress,
  buildCampaignInput,
  buildFutureDeadline,
  buildPastDeadline,
  buildPledgeInput,
  FIXTURE_EPOCH_SECONDS,
  freezeClock,
  ONE_DAY_SECONDS,
  WALLETS,
} from './fixtures';

describe('shared backend fixtures', () => {
  it('builds deterministic wallet addresses and default inputs', () => {
    expect(buildAddress('a')).toBe(WALLETS.creator);
    expect(buildAddress('invalid-value')).toBe(`GI${'I'.repeat(54)}`);
    expect(buildCampaignInput()).toMatchObject({
      creator: WALLETS.creator,
      acceptedTokens: ['USDC'],
      deadline: FIXTURE_EPOCH_SECONDS + ONE_DAY_SECONDS,
    });
    expect(buildPledgeInput()).toMatchObject({
      contributor: WALLETS.alice,
      amount: 100,
      assetCode: 'USDC',
    });
  });

  it('builds future and past deadlines from an explicit fixture instant', () => {
    expect(buildFutureDeadline(60, 2_000)).toBe(2_060);
    expect(buildPastDeadline(60, 2_000)).toBe(1_940);
  });

  it('advances and restores the deterministic clock', () => {
    const clock = freezeClock();

    expect(Date.now()).toBe(FIXTURE_EPOCH_SECONDS * 1000);
    clock.advance(60);
    expect(Date.now()).toBe((FIXTURE_EPOCH_SECONDS + 60) * 1000);
    clock.set(2_000);
    expect(Date.now()).toBe(2_000_000);

    clock.restore();
  });

  it('synchronizes an optional store clock and resets it on restore', () => {
    const storeTimes: number[] = [];
    let resetCount = 0;
    const clock = freezeClock(FIXTURE_EPOCH_SECONDS, {
      setStoreTime: (milliseconds) => storeTimes.push(milliseconds),
      resetStoreTime: () => {
        resetCount += 1;
      },
    });

    clock.advance(ONE_DAY_SECONDS);
    clock.restore();

    expect(storeTimes).toEqual([
      FIXTURE_EPOCH_SECONDS * 1000,
      (FIXTURE_EPOCH_SECONDS + ONE_DAY_SECONDS) * 1000,
    ]);
    expect(resetCount).toBe(1);
  });
});
