import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { axe } from 'vitest-axe';
import { ContributorTable } from './ContributorTable';

vi.mock('../services/api', () => ({
  getCampaignPledges: vi.fn(),
}));

import { getCampaignPledges } from '../services/api';
const mockGetCampaignPledges = vi.mocked(getCampaignPledges);

const mockPledges = [
  {
    id: 1,
    campaignId: '1',
    contributor: 'GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LVY',
    amount: 150,
    assetCode: 'USDC',
    createdAt: 1700000000,
    transactionHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  },
  {
    id: 2,
    campaignId: '1',
    contributor: 'Anonymous',
    amount: 50,
    assetCode: 'XLM',
    createdAt: 1700000100,
    transactionHash: undefined,
  },
];

describe('ContributorTable accessibility', () => {
  beforeEach(() => {
    mockGetCampaignPledges.mockReset();
  });

  it('has no axe violations when data is loaded', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: mockPledges,
      pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
    });

    const { container } = render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('2 pledges')).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations in loading state', async () => {
    mockGetCampaignPledges.mockReturnValue(new Promise(() => {}));

    const { container } = render(<ContributorTable campaignId="1" />);

    expect(screen.getByLabelText('Loading pledges')).toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations in empty state', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: [],
      pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
    });

    const { container } = render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('No pledges yet')).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations in error state', async () => {
    mockGetCampaignPledges.mockRejectedValueOnce(new Error('Network error'));

    const { container } = render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('has no axe violations with pagination controls', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: mockPledges,
      pagination: { total: 50, page: 1, limit: 20, totalPages: 3 },
    });

    const { container } = render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
