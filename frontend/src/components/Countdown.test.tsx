import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Countdown } from './Countdown';
import {
  BASE_TEST_TIME_SEC,
  setupDeterministicTime,
  resetDeterministicTime,
  advanceTimeBySeconds,
  advanceTimeByHours,
  advanceTimeByDays,
} from '../test/timeTestUtils';

describe('Countdown with deterministic time control', () => {
  beforeEach(() => {
    // Pin time to 2026-01-01T00:00:00.000Z
    setupDeterministicTime();
  });

  afterEach(() => {
    resetDeterministicTime();
  });

  it('renders normal countdown when deadline is more than 24 hours away', () => {
    // 3 days, 2 hours, 15 minutes, 30 seconds
    const deadline = BASE_TEST_TIME_SEC + 3 * 86400 + 2 * 3600 + 15 * 60 + 30;

    const { container } = render(<Countdown deadline={deadline} />);
    const countdownEl = container.querySelector('.countdown');

    expect(countdownEl).toBeInTheDocument();
    expect(countdownEl).not.toHaveClass('countdown-urgent');
    expect(countdownEl).not.toHaveClass('countdown-expired');
    expect(countdownEl).toHaveTextContent('3d 02h 15m 30s');
  });

  it('renders urgent countdown when deadline is less than 24 hours away', () => {
    // 12 hours, 30 minutes, 15 seconds
    const deadline = BASE_TEST_TIME_SEC + 12 * 3600 + 30 * 60 + 15;

    const { container } = render(<Countdown deadline={deadline} />);
    const countdownEl = container.querySelector('.countdown-urgent');

    expect(countdownEl).toBeInTheDocument();
    expect(countdownEl).toHaveTextContent('12h 30m 15s');
    // Days should not be rendered when 0
    expect(countdownEl).not.toHaveTextContent('0d');
  });

  it('renders expired state when deadline is already in the past', () => {
    const pastDeadline = BASE_TEST_TIME_SEC - 100;

    render(<Countdown deadline={pastDeadline} />);
    const expiredEl = screen.getByText('Deadline Passed');

    expect(expiredEl).toBeInTheDocument();
    expect(expiredEl).toHaveClass('countdown-expired');
  });

  it('decrements countdown deterministically each second', () => {
    // 2 hours, 0 minutes, 5 seconds
    const deadline = BASE_TEST_TIME_SEC + 7205;

    render(<Countdown deadline={deadline} />);
    expect(screen.getByText('02h 00m 05s')).toBeInTheDocument();

    // Advance 1 second
    act(() => {
      advanceTimeBySeconds(1);
    });
    expect(screen.getByText('02h 00m 04s')).toBeInTheDocument();

    // Advance 4 more seconds
    act(() => {
      advanceTimeBySeconds(4);
    });
    expect(screen.getByText('02h 00m 00s')).toBeInTheDocument();

    // Advance 1 second across minute boundary
    act(() => {
      advanceTimeBySeconds(1);
    });
    expect(screen.getByText('01h 59m 59s')).toBeInTheDocument();
  });

  it('transitions from normal to urgent when advancing past the 24-hour mark', () => {
    // 24 hours + 10 seconds
    const deadline = BASE_TEST_TIME_SEC + 86410;

    const { container } = render(<Countdown deadline={deadline} />);
    expect(container.querySelector('.countdown')).toBeInTheDocument();
    expect(container.querySelector('.countdown-urgent')).not.toBeInTheDocument();

    // Advance 20 seconds to cross the 24 hour threshold
    act(() => {
      advanceTimeBySeconds(20);
    });

    expect(container.querySelector('.countdown')).not.toBeInTheDocument();
    expect(container.querySelector('.countdown-urgent')).toBeInTheDocument();
  });

  it('transitions to Deadline Passed when time reaches and passes deadline', () => {
    const deadline = BASE_TEST_TIME_SEC + 5;

    render(<Countdown deadline={deadline} />);
    expect(screen.getByText('00h 00m 05s')).toBeInTheDocument();

    // Advance 5 seconds to expire
    act(() => {
      advanceTimeBySeconds(5);
    });

    expect(screen.getByText('Deadline Passed')).toBeInTheDocument();
  });

  it('cleans up interval on unmount without throwing errors', () => {
    const deadline = BASE_TEST_TIME_SEC + 100;
    const { unmount } = render(<Countdown deadline={deadline} />);

    unmount();

    // Advancing time should not fail or trigger state updates on unmounted component
    act(() => {
      advanceTimeBySeconds(10);
    });
  });
});
