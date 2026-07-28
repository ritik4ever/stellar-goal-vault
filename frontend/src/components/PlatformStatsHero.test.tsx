import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlatformStatsHero } from './PlatformStatsHero';

vi.mock('../services/api', () => ({
  getPlatformStats: vi.fn(),
}));

import { getPlatformStats } from '../services/api';

const mockGetPlatformStats = vi.mocked(getPlatformStats);

const sampleStats = {
  totalCampaigns: 10,
  openCampaigns: 4,
  fundedCampaigns: 3,
  claimedCampaigns: 2,
  failedCampaigns: 1,
  totalPledgeVolume: 1250.5,
  uniqueContributors: 42,
};

describe('PlatformStatsHero', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetPlatformStats.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading placeholders then platform metrics from the stats API', async () => {
    mockGetPlatformStats.mockResolvedValue(sampleStats);

    render(<PlatformStatsHero />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText('Total Raised')).toBeInTheDocument();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });

    expect(mockGetPlatformStats).toHaveBeenCalled();
    expect(screen.getByText('Active Campaigns')).toBeInTheDocument();
    expect(screen.getByText('Backers')).toBeInTheDocument();
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
  });

  it('handles zero-state stats gracefully', async () => {
    mockGetPlatformStats.mockResolvedValue({
      totalCampaigns: 0,
      openCampaigns: 0,
      fundedCampaigns: 0,
      claimedCampaigns: 0,
      failedCampaigns: 0,
      totalPledgeVolume: 0,
      uniqueContributors: 0,
    });

    render(<PlatformStatsHero />);

    await waitFor(() => {
      expect(
        screen.getByText('Stats will populate as the first campaigns and pledges go live.'),
      ).toBeInTheDocument();
    });
  });

  it('refreshes stats on the five-minute interval', async () => {
    mockGetPlatformStats.mockResolvedValue(sampleStats);

    render(<PlatformStatsHero />);

    await waitFor(() => {
      expect(mockGetPlatformStats).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(mockGetPlatformStats).toHaveBeenCalledTimes(2);
  });
});
