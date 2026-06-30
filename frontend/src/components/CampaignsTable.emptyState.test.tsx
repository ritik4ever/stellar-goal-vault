/**
 * CampaignsTable.emptyState.test.tsx
 *
 * Tests for Issue #246 – Wire EmptyState into Search Results
 *
 * Acceptance criteria covered:
 *   ✓ EmptyState renders when search returns zero campaigns
 *   ✓ EmptyState renders when asset filter returns zero campaigns
 *   ✓ EmptyState renders when status filter returns zero campaigns
 *   ✓ EmptyState renders with multiple filters producing zero results
 *   ✓ Clear Filters button resets all filters
 *   ✓ Campaign table reappears after clearing filters
 *   ✓ Existing search behaviour remains unchanged
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignsTable } from './CampaignsTable';
import type { Campaign } from '../types/campaign';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const makeCampaign = (overrides: Partial<Campaign> & Pick<Campaign, 'id' | 'title'>): Campaign => ({
  creator: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  description: 'Test description',
  acceptedTokens: ['USDC'],
  assetCode: 'USDC',
  targetAmount: 10000,
  pledgedAmount: 5000,
  deadline: Math.floor(Date.now() / 1000) + 86400,
  createdAt: Math.floor(Date.now() / 1000),
  progress: {
    status: 'open',
    percentFunded: 50,
    remainingAmount: 5000,
    pledgeCount: 2,
    hoursLeft: 24,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
  ...overrides,
});

/** Three campaigns spanning two assets and two statuses. */
const mockCampaigns: Campaign[] = [
  makeCampaign({ id: 'c1', title: 'Rocket Ship', assetCode: 'USDC', progress: { status: 'open', percentFunded: 50, remainingAmount: 5000, pledgeCount: 2, hoursLeft: 24, canPledge: true, canClaim: false, canRefund: false } }),
  makeCampaign({ id: 'c2', title: 'Solar Farm',  assetCode: 'XLM',  progress: { status: 'funded', percentFunded: 100, remainingAmount: 0, pledgeCount: 10, hoursLeft: 0, canPledge: false, canClaim: true, canRefund: false } }),
  makeCampaign({ id: 'c3', title: 'Book Club',   assetCode: 'USDC', progress: { status: 'open', percentFunded: 30, remainingAmount: 7000, pledgeCount: 1, hoursLeft: 48, canPledge: true, canClaim: false, canRefund: false } }),
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderTable(campaigns: Campaign[] = mockCampaigns) {
  return render(
    <CampaignsTable
      campaigns={campaigns}
      selectedCampaignId={null}
      onSelect={vi.fn()}
      isLoading={false}
    />,
  );
}

// ---------------------------------------------------------------------------
// 1. EmptyState renders when search returns zero campaigns
// ---------------------------------------------------------------------------

describe('EmptyState – search produces zero results', () => {
  it('shows "No campaigns match your search." title', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'zzznomatch');
    vi.advanceTimersByTime(350);

    expect(
      screen.getByText('No campaigns match your search.'),
    ).toBeInTheDocument();
  });

  it('shows "Clear Search" CTA button', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'zzznomatch');
    vi.advanceTimersByTime(350);

    expect(
      screen.getByRole('button', { name: 'Clear Search' }),
    ).toBeInTheDocument();
  });

  it('does NOT show EmptyState while loading', () => {
    render(
      <CampaignsTable
        campaigns={mockCampaigns}
        selectedCampaignId={null}
        onSelect={vi.fn()}
        isLoading={true}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does NOT show filtered EmptyState when no filter is active', () => {
    renderTable();

    expect(screen.queryByText('No campaigns match your search.')).not.toBeInTheDocument();
    expect(screen.queryByText('No campaigns match the selected filters.')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. EmptyState renders when asset filter returns zero campaigns
// ---------------------------------------------------------------------------

describe('EmptyState – asset filter produces zero results', () => {
  it('shows "No campaigns match the selected filters." when asset + status yields zero', () => {
    renderTable(mockCampaigns);

    // XLM option exists because c2 is XLM
    const assetSelect = screen.getByDisplayValue('All Assets');
    fireEvent.change(assetSelect, { target: { value: 'XLM' } });

    // XLM only has one 'funded' campaign; filter to 'open' → 0 results
    const openTab = screen.getByRole('button', { name: /Open/ });
    fireEvent.click(openTab);

    expect(
      screen.getByText('No campaigns match the selected filters.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. EmptyState renders when status filter returns zero campaigns
// ---------------------------------------------------------------------------

describe('EmptyState – status filter produces zero results', () => {
  it('shows "No campaigns match the selected filters." for a status with no campaigns', () => {
    renderTable(mockCampaigns);

    const claimedTab = screen.getByRole('button', { name: /Claimed/ });
    fireEvent.click(claimedTab);

    expect(
      screen.getByText('No campaigns match the selected filters.'),
    ).toBeInTheDocument();
  });

  it('shows "Clear Filters" CTA button when status has zero campaigns', () => {
    renderTable(mockCampaigns);

    const failedTab = screen.getByRole('button', { name: /Failed/ });
    fireEvent.click(failedTab);

    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument();
  });

  it('renders EmptyState with role="status" for screen-reader accessibility', () => {
    renderTable(mockCampaigns);

    const claimedTab = screen.getByRole('button', { name: /Claimed/ });
    fireEvent.click(claimedTab);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4. EmptyState renders with multiple filters producing zero results
// ---------------------------------------------------------------------------

describe('EmptyState – multiple filters produce zero results', () => {
  it('search + asset filter → shows "No campaigns match the selected filters."', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(mockCampaigns);

    const assetSelect = screen.getByDisplayValue('All Assets');
    fireEvent.change(assetSelect, { target: { value: 'XLM' } });

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'rocket');
    vi.advanceTimersByTime(350);

    expect(
      screen.getByText('No campaigns match the selected filters.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument();
  });

  it('search + status filter → shows "No campaigns match the selected filters."', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(mockCampaigns);

    const fundedTab = screen.getByRole('button', { name: /Funded/ });
    fireEvent.click(fundedTab);

    // 'Book Club' is not funded → search won't match Solar Farm
    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'book');
    vi.advanceTimersByTime(350);

    expect(
      screen.getByText('No campaigns match the selected filters.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument();
  });

  it('asset + status filter → shows "No campaigns match the selected filters."', () => {
    renderTable(mockCampaigns);

    const assetSelect = screen.getByDisplayValue('All Assets');
    fireEvent.change(assetSelect, { target: { value: 'XLM' } });

    const openTab = screen.getByRole('button', { name: /Open/ });
    fireEvent.click(openTab);

    expect(
      screen.getByText('No campaigns match the selected filters.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument();
  });

  it('search + asset + status filter → shows "No campaigns match the selected filters."', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(mockCampaigns);

    const assetSelect = screen.getByDisplayValue('All Assets');
    fireEvent.change(assetSelect, { target: { value: 'XLM' } });

    const openTab = screen.getByRole('button', { name: /Open/ });
    fireEvent.click(openTab);

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'anything');
    vi.advanceTimersByTime(350);

    expect(
      screen.getByText('No campaigns match the selected filters.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear Filters' }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5 + 6. Clear Filters resets all filters & table reappears
// ---------------------------------------------------------------------------

describe('Clear Filters / Clear Search button', () => {
  it('clicking "Clear Search" resets search and shows all campaigns', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(mockCampaigns);

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'zzznomatch');
    vi.advanceTimersByTime(350);

    expect(screen.getByRole('button', { name: 'Clear Search' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));
    vi.advanceTimersByTime(350);

    expect(screen.getByText('Rocket Ship')).toBeInTheDocument();
    expect(screen.getByText('Solar Farm')).toBeInTheDocument();
    expect(screen.getByText('Book Club')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clicking "Clear Filters" resets status filter and shows all campaigns', () => {
    renderTable(mockCampaigns);

    const claimedTab = screen.getByRole('button', { name: /Claimed/ });
    fireEvent.click(claimedTab);

    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    vi.advanceTimersByTime(350);

    expect(screen.getByText('Rocket Ship')).toBeInTheDocument();
    expect(screen.getByText('Solar Farm')).toBeInTheDocument();
    expect(screen.getByText('Book Club')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clicking "Clear Filters" with multiple active filters resets all axes', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(mockCampaigns);

    const assetSelect = screen.getByDisplayValue('All Assets');
    fireEvent.change(assetSelect, { target: { value: 'XLM' } });

    const openTab = screen.getByRole('button', { name: /Open/ });
    fireEvent.click(openTab);

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'xyz');
    vi.advanceTimersByTime(350);

    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    vi.advanceTimersByTime(350);

    expect(screen.getByText('Rocket Ship')).toBeInTheDocument();
    expect(screen.getByText('Solar Farm')).toBeInTheDocument();
    expect(screen.getByText('Book Club')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. Existing search behaviour remains unchanged
// ---------------------------------------------------------------------------

describe('Existing search behaviour – unchanged', () => {
  it('filters campaigns by title after debounce', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(mockCampaigns);

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'rocket');
    vi.advanceTimersByTime(350);

    expect(screen.getByText('Rocket Ship')).toBeInTheDocument();
    expect(screen.queryByText('Solar Farm')).not.toBeInTheDocument();
    expect(screen.queryByText('Book Club')).not.toBeInTheDocument();
  });

  it('does not filter before debounce delay elapses', async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(mockCampaigns);

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'rocket');
    // Do NOT advance timers – all campaigns still visible

    expect(screen.getByText('Rocket Ship')).toBeInTheDocument();
    expect(screen.getByText('Solar Farm')).toBeInTheDocument();
    expect(screen.getByText('Book Club')).toBeInTheDocument();
  });

  it('calls onSearchChange with the debounced query', async () => {
    const user = userEvent.setup({ delay: null });
    const onSearchChange = vi.fn();

    render(
      <CampaignsTable
        campaigns={mockCampaigns}
        selectedCampaignId={null}
        onSelect={vi.fn()}
        onSearchChange={onSearchChange}
        isLoading={false}
      />,
    );

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'solar');
    vi.advanceTimersByTime(350);

    expect(onSearchChange).toHaveBeenCalledWith('solar');
  });

  it('calls onSearchChange with "" when search is cleared', async () => {
    const user = userEvent.setup({ delay: null });
    const onSearchChange = vi.fn();

    render(
      <CampaignsTable
        campaigns={mockCampaigns}
        selectedCampaignId={null}
        onSelect={vi.fn()}
        onSearchChange={onSearchChange}
        isLoading={false}
      />,
    );

    await user.type(screen.getByPlaceholderText('Search campaigns...'), 'solar');
    vi.advanceTimersByTime(350);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    vi.advanceTimersByTime(350);

    const calls = onSearchChange.mock.calls;
    expect(calls[calls.length - 1][0]).toBe('');
  });
});
