/**
 * Integration tests verifying that CampaignsTable debounces the onSearchChange
 * callback and fires immediately on clear (#254).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CampaignsTable } from './CampaignsTable';
import type { Campaign } from '../types/campaign';

// jsdom does not implement matchMedia. A plain function (not `vi.fn()`) is used
// on purpose: vitest restores mock implementations between tests, which would
// strip the body of a `vi.fn()` installed at module scope.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

const STUB_CAMPAIGN: Campaign = {
  id: 'c1',
  creator: 'G' + 'A'.repeat(55),
  title: 'Test Campaign',
  description: 'desc',
  acceptedTokens: ['XLM'],
  assetCode: 'XLM',
  targetAmount: 1000,
  pledgedAmount: 0,
  deadline: Date.now() / 1000 + 86400,
  createdAt: Date.now() / 1000,
  progress: {
    status: 'open',
    percentFunded: 0,
    remainingAmount: 1000,
    pledgeCount: 0,
    hoursLeft: 24,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
};

function renderTable(onSearchChange: (q: string) => void) {
  return render(
    <MemoryRouter>
      <CampaignsTable
        campaigns={[STUB_CAMPAIGN]}
        selectedCampaignId={null}
        onSelect={vi.fn()}
        isLoading={false}
        hasMore={false}
        onSearchChange={onSearchChange}
        error={null}
      />
    </MemoryRouter>,
  );
}

describe('CampaignsTable debounced search (#254)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('does not call onSearchChange before 300 ms elapses', () => {
    const onSearchChange = vi.fn();
    renderTable(onSearchChange);

    const input = screen.getByRole('textbox', { name: /search campaigns/i });
    fireEvent.change(input, { target: { value: 'ro' } });

    // Timer not advanced — debounce window not expired
    const nonEmptyCalls = onSearchChange.mock.calls.filter(([v]) => v !== '');
    expect(nonEmptyCalls).toHaveLength(0);
  });

  it('calls onSearchChange exactly once after 300 ms pause', async () => {
    const onSearchChange = vi.fn();
    renderTable(onSearchChange);

    const input = screen.getByRole('textbox', { name: /search campaigns/i });
    fireEvent.change(input, { target: { value: 'r' } });
    fireEvent.change(input, { target: { value: 'ro' } });
    fireEvent.change(input, { target: { value: 'roc' } });
    fireEvent.change(input, { target: { value: 'rock' } });

    // No callback yet
    expect(onSearchChange).not.toHaveBeenCalledWith('rock');

    // Advance past the debounce delay
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const rocketCalls = onSearchChange.mock.calls.filter(([v]) => v === 'rock');
    expect(rocketCalls).toHaveLength(1);
    // Not called for each intermediate keystroke
    const allNonEmpty = onSearchChange.mock.calls.filter(([v]) => v !== '');
    expect(allNonEmpty.length).toBeLessThanOrEqual(1);
  });

  it('fires onSearchChange immediately when input is cleared', async () => {
    const onSearchChange = vi.fn();
    renderTable(onSearchChange);

    const input = screen.getByRole('textbox', { name: /search campaigns/i });
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    onSearchChange.mockClear();

    // Simulate clear button click by changing value to empty string
    fireEvent.change(input, { target: { value: '' } });

    // Should have fired immediately (handleSearchChange calls onSearchChange('') directly)
    expect(onSearchChange).toHaveBeenCalledWith('');
    expect(onSearchChange).toHaveBeenCalledTimes(1);
  });
});
