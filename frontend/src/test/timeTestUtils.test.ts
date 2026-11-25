import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BASE_TEST_TIME,
  BASE_TEST_TIME_SEC,
  setupDeterministicTime,
  resetDeterministicTime,
  advanceTime,
  advanceTimeBySeconds,
  advanceTimeByHours,
  advanceTimeByDays,
  setTestSystemTime,
  withDeterministicTime,
  createDeterministicDate,
  createDeterministicTimestampSec,
  createDeterministicCampaign,
  createDeterministicPledge,
  getDeterministicLifecycleState,
} from './timeTestUtils';

describe('timeTestUtils', () => {
  afterEach(() => {
    resetDeterministicTime();
  });

  describe('setupDeterministicTime & resetDeterministicTime', () => {
    it('pins system time to the base test timestamp by default', () => {
      setupDeterministicTime();
      expect(Date.now()).toBe(BASE_TEST_TIME);
      expect(Math.floor(Date.now() / 1000)).toBe(BASE_TEST_TIME_SEC);
      expect(new Date().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('allows pinning system time to custom date', () => {
      const customDate = new Date('2027-06-15T12:30:00.000Z');
      setupDeterministicTime(customDate);
      expect(Date.now()).toBe(customDate.getTime());
      expect(new Date().toISOString()).toBe('2027-06-15T12:30:00.000Z');
    });

    it('restores real timers when resetDeterministicTime is called', () => {
      setupDeterministicTime();
      expect(Date.now()).toBe(BASE_TEST_TIME);

      resetDeterministicTime();
      expect(Date.now()).not.toBe(BASE_TEST_TIME);
    });
  });

  describe('advanceTime helpers', () => {
    beforeEach(() => {
      setupDeterministicTime();
    });

    it('advances time by milliseconds', () => {
      advanceTime(500);
      expect(Date.now()).toBe(BASE_TEST_TIME + 500);
    });

    it('advances time by seconds', () => {
      advanceTimeBySeconds(30);
      expect(Date.now()).toBe(BASE_TEST_TIME + 30000);
    });

    it('advances time by hours', () => {
      advanceTimeByHours(2);
      expect(Date.now()).toBe(BASE_TEST_TIME + 2 * 3600 * 1000);
    });

    it('advances time by days', () => {
      advanceTimeByDays(7);
      expect(Date.now()).toBe(BASE_TEST_TIME + 7 * 86400 * 1000);
    });

    it('triggers setTimeout intervals when advancing time', () => {
      const callback = vi.fn();
      setTimeout(callback, 2000);

      advanceTime(1000);
      expect(callback).not.toHaveBeenCalled();

      advanceTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('setTestSystemTime', () => {
    it('updates system time to new target', () => {
      setupDeterministicTime();
      const newTarget = '2026-01-02T00:00:00.000Z';
      setTestSystemTime(newTarget);
      expect(new Date().toISOString()).toBe(newTarget);
    });
  });

  describe('withDeterministicTime', () => {
    it('executes callback with pinned time and automatically restores timers', async () => {
      const customIso = '2028-02-14T10:00:00.000Z';
      let insideTime = 0;

      await withDeterministicTime(customIso, () => {
        insideTime = Date.now();
        expect(new Date().toISOString()).toBe(customIso);
      });

      expect(insideTime).toBe(new Date(customIso).getTime());
      expect(Date.now()).not.toBe(new Date(customIso).getTime());
    });

    it('restores real timers even if the callback throws an error', async () => {
      const customIso = '2028-02-14T10:00:00.000Z';

      await expect(
        withDeterministicTime(customIso, () => {
          throw new Error('Simulation failed');
        }),
      ).rejects.toThrow('Simulation failed');

      expect(Date.now()).not.toBe(new Date(customIso).getTime());
    });
  });

  describe('date and timestamp generation', () => {
    it('creates deterministic Date with offset days and hours', () => {
      const datePlusTwoDays = createDeterministicDate(2, 4);
      expect(datePlusTwoDays.toISOString()).toBe('2026-01-03T04:00:00.000Z');
    });

    it('creates deterministic timestamp in seconds', () => {
      const ts = createDeterministicTimestampSec(120);
      expect(ts).toBe(BASE_TEST_TIME_SEC + 120);
    });
  });

  describe('factories', () => {
    it('creates a deterministic campaign with valid baseline dates', () => {
      const campaign = createDeterministicCampaign({ title: 'Special Campaign' });
      expect(campaign.title).toBe('Special Campaign');
      expect(campaign.createdAt).toBe(BASE_TEST_TIME_SEC - 86400);
      expect(campaign.deadline).toBe(BASE_TEST_TIME_SEC + 86400);
      expect(campaign.progress.status).toBe('open');
    });

    it('creates a deterministic pledge', () => {
      const pledge = createDeterministicPledge({ amount: 250 });
      expect(pledge.amount).toBe(250);
      expect(pledge.createdAt).toBe(BASE_TEST_TIME_SEC - 3600);
    });
  });

  describe('getDeterministicLifecycleState', () => {
    it('calculates remaining time for active deadline', () => {
      const deadline = BASE_TEST_TIME_SEC + 7200; // 2 hours
      const state = getDeterministicLifecycleState(deadline, BASE_TEST_TIME_SEC);

      expect(state.isExpired).toBe(false);
      expect(state.secondsRemaining).toBe(7200);
      expect(state.hoursRemaining).toBe(2);
      expect(state.daysRemaining).toBe(0);
    });

    it('marks deadline as expired when current time passes deadline', () => {
      const deadline = BASE_TEST_TIME_SEC - 10;
      const state = getDeterministicLifecycleState(deadline, BASE_TEST_TIME_SEC);

      expect(state.isExpired).toBe(true);
      expect(state.secondsRemaining).toBe(0);
      expect(state.hoursRemaining).toBe(0);
      expect(state.daysRemaining).toBe(0);
    });
  });
});
