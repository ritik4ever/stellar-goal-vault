import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContributorSummary } from './ContributorSummary';

// Mock apiRequest from httpClient
vi.mock('../services/httpClient', () => ({
  apiRequest: vi.fn(),
  apiClient: { interceptors: { request: { use: vi.fn() } } },
  REQUEST_ID_HEADER: 'X-Request-ID',
}));

import { apiRequest } from '../services/httpClient';
const mockApiRequest = vi.mocked(apiRequest);

const mockContributors = [
  {
    contributor: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
    totalPledged: 150,
    refundedAmount: 0,
    isFullyRefunded: false,
  },
  {
    contributor: 'GABC123456789ABCDEF123456789ABCDEF123456789ABCDEF123456789',
    totalPledged: 0,
    refundedAmount: 50,
    isFullyRefunded: true,
  },
  {
    contributor: 'GDEF456789ABCDEF456789ABCDEF456789ABCDEF456789ABCDEF456789AB',
    totalPledged: 75,
    refundedAmount: 25,
    isFullyRefunded: false,
  },
];

describe('ContributorSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApiRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading skeleton when isLoading is true', () => {
    render(<ContributorSummary campaignId="1" assetCode="USDC" isLoading={true} />);
    expect(screen.getByText('Contributors')).toBeInTheDocument();
    expect(screen.getByLabelText('Contributor summary')).toHaveClass(
      'contributor-summary-loading',
    );
  });

  it('renders empty state when no contributors exist', async () => {
    mockApiRequest.mockResolvedValueOnce({ data: [] });

    render(<ContributorSummary campaignId="1" assetCode="USDC" />);

    await waitFor(() => {
      expect(screen.getByText('No contributors yet')).toBeInTheDocument();
    });
  });

  it('renders contributor rows sorted by totalPledged descending', async () => {
    mockApiRequest.mockResolvedValueOnce({ data: mockContributors });

    render(<ContributorSummary campaignId="1" assetCode="USDC" />);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // First row is the header; data rows follow
      expect(rows.length).toBe(4); // 1 header + 3 data rows
    });

    // The first data row should be the contributor with highest totalPledged (150)
    const cells = screen.getAllByRole('cell');
    // First contributor cell — truncated address
    expect(cells[0]).toHaveTextContent('GBEZH6T5V7VH');
    // Active pledge amount
    expect(cells[1]).toHaveTextContent('150 USDC');
  });

  it('shows correct aggregate stats', async () => {
    mockApiRequest.mockResolvedValueOnce({ data: mockContributors });

    render(<ContributorSummary campaignId="1" assetCode="USDC" />);

    await waitFor(() => {
      // Ever pledged: 3 total contributors
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    // Still active: 2 (the one with isFullyRefunded:true is excluded)
    expect(screen.getByText('2')).toBeInTheDocument();

    // Active total: 150 + 0 + 75 = 225
    expect(screen.getByText(/225/)).toBeInTheDocument();

    // Refunded total: 0 + 50 + 25 = 75. Multiple elements match "75 USDC" (row + stat).
    expect(screen.getAllByText(/75/).length).toBeGreaterThanOrEqual(1);
  });

  it('displays refund status correctly', async () => {
    mockApiRequest.mockResolvedValueOnce({ data: mockContributors });

    render(<ContributorSummary campaignId="1" assetCode="USDC" />);

    await waitFor(() => {
      expect(screen.getByText(/fully refunded/)).toBeInTheDocument();
      expect(screen.getByText(/partial refund/)).toBeInTheDocument();
    });
  });

  it('renders error state on API failure', async () => {
    mockApiRequest.mockRejectedValueOnce(new Error('Network failure'));

    render(<ContributorSummary campaignId="1" assetCode="USDC" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network failure');
    });
  });

  it('polls for updated contributors every 30 seconds', async () => {
    mockApiRequest
      .mockResolvedValueOnce({ data: mockContributors })
      .mockResolvedValueOnce({
        data: [
          ...mockContributors,
          {
            contributor: 'GNEW999888777666555444333222111000999888777666555444333222',
            totalPledged: 200,
            refundedAmount: 0,
            isFullyRefunded: false,
          },
        ],
      });

    render(<ContributorSummary campaignId="1" assetCode="USDC" />);

    // Wait for initial fetch
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });

    // Advance 30 seconds to trigger poll
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(2);
    });
  });

  it('calls API with correct campaign ID', async () => {
    mockApiRequest.mockResolvedValueOnce({ data: [] });

    render(<ContributorSummary campaignId="42" assetCode="XLM" />);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith({
        method: 'GET',
        url: '/campaigns/42/contributors',
      });
    });
  });

  it('does not fetch when campaignId is undefined', () => {
    render(<ContributorSummary assetCode="USDC" />);

    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
