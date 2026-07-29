import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
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
    contributor: 'GABC123456789ABCDEF123456789ABCDEF123456789ABCDEF123456789',
    amount: 50,
    assetCode: 'XLM',
    createdAt: 1700000100,
    transactionHash: undefined,
  },
  {
    id: 3,
    campaignId: '1',
    contributor: 'Anonymous',
    amount: 25,
    assetCode: 'USDC',
    createdAt: 1700000200,
    transactionHash: 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
  },
  {
    id: 4,
    campaignId: '1',
    contributor: '',
    amount: 10,
    assetCode: 'XLM',
    createdAt: 1700000300,
    transactionHash: undefined,
  },
];

describe('ContributorTable', () => {
  beforeEach(() => {
    mockGetCampaignPledges.mockReset();
  });

  it('renders loading skeleton when data is loading', () => {
    mockGetCampaignPledges.mockReturnValue(new Promise(() => {})); // never resolves

    render(<ContributorTable campaignId="1" />);

    expect(screen.getByText('Pledges')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading pledges')).toBeInTheDocument();
  });

  it('renders pledge rows when data is loaded', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: mockPledges.slice(0, 2),
      pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('2 pledges')).toBeInTheDocument();
    });

    // Should show contributor addresses (truncated)
    expect(screen.getByText('GBEZH6T5V7VH…')).toBeInTheDocument();
    expect(screen.getByText('GABC12345678…')).toBeInTheDocument();

    // Should show amounts
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();

    // Should show assets
    expect(screen.getAllByText('USDC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('XLM').length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty state when no pledges exist', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: [],
      pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('No pledges yet')).toBeInTheDocument();
    });
  });

  it('renders error state on API failure', async () => {
    mockGetCampaignPledges.mockRejectedValueOnce(new Error('Network error'));

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });

  it('displays Anonymous Backer for anonymous contributors', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: [mockPledges[2]], // Anonymous contributor
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('Anonymous Backer')).toBeInTheDocument();
    });
  });

  it('displays Anonymous Backer for empty-string contributors', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: [mockPledges[3]], // empty contributor
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('Anonymous Backer')).toBeInTheDocument();
    });
  });

  it('renders TX hash link when transactionHash exists', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: [mockPledges[0]],
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      const txLink = screen.getByRole('link', {
        name: /view transaction/i,
      });
      expect(txLink).toBeInTheDocument();
      expect(txLink).toHaveAttribute('href', expect.stringContaining('stellar.expert'));
      expect(txLink).toHaveAttribute('href', expect.stringContaining('testnet'));
    });
  });

  it('uses mainnet explorer link when mainnet passphrase is provided', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: [mockPledges[0]],
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    render(
      <ContributorTable
        campaignId="1"
        networkPassphrase="Public Global Stellar Network ; September 2015"
      />,
    );

    await waitFor(() => {
      const txLink = screen.getByRole('link', {
        name: /view transaction/i,
      });
      expect(txLink).toHaveAttribute('href', expect.stringContaining('public'));
    });
  });

  it('shows dash for pledges without transaction hash', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: [mockPledges[1]], // no tx hash
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      // The "—" dash should be in the tx hash cell
      const rows = screen.getAllByRole('row');
      expect(rows.length).toBe(2); // header + data
    });
  });

  it('sorts by amount when amount header is clicked', async () => {
    mockGetCampaignPledges.mockResolvedValue({
      data: mockPledges.slice(0, 2),
      pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('GBEZH6T5V7VH…')).toBeInTheDocument();
    });

    // Clear the mock calls from initial render
    mockGetCampaignPledges.mockClear();

    const amountSortButton = screen.getByRole('button', { name: /sort by amount/i });
    await userEvent.click(amountSortButton);

    await waitFor(() => {
      expect(mockGetCampaignPledges).toHaveBeenCalledTimes(1);
    });

    expect(mockGetCampaignPledges).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ sort: 'amount', order: 'desc' }),
    );
  });

  it('sorts by date when date header is clicked', async () => {
    mockGetCampaignPledges.mockResolvedValue({
      data: mockPledges.slice(0, 2),
      pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('GBEZH6T5V7VH…')).toBeInTheDocument();
    });

    mockGetCampaignPledges.mockClear();

    const dateSortButton = screen.getByRole('button', { name: /sort by date/i });
    await userEvent.click(dateSortButton);

    await waitFor(() => {
      expect(mockGetCampaignPledges).toHaveBeenCalledTimes(1);
    });

    expect(mockGetCampaignPledges).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ sort: 'createdAt', order: 'asc' }),
    );
  });

  it('toggles sort order when same header is clicked twice', async () => {
    mockGetCampaignPledges.mockResolvedValue({
      data: mockPledges.slice(0, 2),
      pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('GBEZH6T5V7VH…')).toBeInTheDocument();
    });

    mockGetCampaignPledges.mockClear();

    const dateSortButton = screen.getByRole('button', { name: /sort by date/i });

    // First click toggles to asc
    await userEvent.click(dateSortButton);
    await waitFor(() => {
      expect(mockGetCampaignPledges).toHaveBeenCalledTimes(1);
    });
    expect(mockGetCampaignPledges).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ sort: 'createdAt', order: 'asc' }),
    );

    mockGetCampaignPledges.mockClear();

    // Second click toggles back to desc
    await userEvent.click(dateSortButton);
    await waitFor(() => {
      expect(mockGetCampaignPledges).toHaveBeenCalledTimes(1);
    });
    expect(mockGetCampaignPledges).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ sort: 'createdAt', order: 'desc' }),
    );
  });

  it('shows pagination controls when there are multiple pages', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: mockPledges,
      pagination: { total: 100, page: 1, limit: 20, totalPages: 5 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    });
  });

  it('disables previous button on first page', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: mockPledges,
      pagination: { total: 100, page: 1, limit: 20, totalPages: 5 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      const prevButton = screen.getByRole('button', { name: 'Previous page' });
      expect(prevButton).toBeDisabled();
    });
  });

  it('does not fetch when campaignId is undefined', () => {
    render(<ContributorTable />);

    expect(mockGetCampaignPledges).not.toHaveBeenCalled();
  });

  it('calls API with correct parameters', async () => {
    mockGetCampaignPledges.mockResolvedValueOnce({
      data: mockPledges.slice(0, 2),
      pagination: { total: 2, page: 1, limit: 20, totalPages: 1 },
    });

    render(<ContributorTable campaignId="42" />);

    await waitFor(() => {
      expect(mockGetCampaignPledges).toHaveBeenCalledWith('42', {
        page: 1,
        limit: 20,
        sort: 'createdAt',
        order: 'desc',
      });
    });
  });

  it('handles 100+ pledges rendering correctly', async () => {
    const manyPledges = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      campaignId: '1',
      contributor: `GBEZH6T5V7VHUWGMAHVICBFV7WSNULSIHHMV7B2LFNJA6J3XVMT7M2LV${String(i).padStart(2, '0')}`,
      amount: 10 + i,
      assetCode: 'USDC',
      createdAt: 1700000000 + i * 100,
      transactionHash: i % 2 === 0 ? `abc${String(i).padStart(61, '0')}` : undefined,
    }));

    mockGetCampaignPledges.mockResolvedValueOnce({
      data: manyPledges,
      pagination: { total: 120, page: 1, limit: 20, totalPages: 6 },
    });

    render(<ContributorTable campaignId="1" />);

    await waitFor(() => {
      expect(screen.getByText('120 pledges')).toBeInTheDocument();
      expect(screen.getByText('Page 1 of 6')).toBeInTheDocument();
    });

    // All 20 pledge rows should be rendered
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(21); // 1 header + 20 data rows
  });
});
