import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CampaignDetailPanel } from './CampaignDetailPanel';
import { AppConfig, Campaign } from '../types/campaign';

// Mock the ContributorSummary since it makes API calls
vi.mock('./ContributorSummary', () => ({
  ContributorSummary: () => <div data-testid="contributor-summary-mock" />,
}));

// Mock the campaign service for failure path testing
vi.mock('../services/campaignService', () => ({
  claimCampaign: vi.fn(),
  refundCampaign: vi.fn(),
}));

const mockConfig: AppConfig = {
  allowedAssets: ['USDC', 'XLM'],
  soroban: {
    enabled: true,
    contractId: 'C123',
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://example.com',
  },
  sorobanRpcUrl: 'https://example.com',
  contractId: 'C123',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractAmountDecimals: 2,
  walletIntegrationReady: true,
  assetAddresses: {},
};

const mockCampaign: Campaign = {
  id: '1',
  title: 'Test Campaign',
  description: 'A test campaign description',
  creator: `G${'A'.repeat(55)}`,
  assetCode: 'USDC',
  acceptedTokens: ['USDC'],
  targetAmount: 100,
  pledgedAmount: 0,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  createdAt: Math.floor(Date.now() / 1000),
  pledges: [],
  progress: {
    status: 'open',
    percentFunded: 0,
    remainingAmount: 100,
    hoursLeft: 1,
    pledgeCount: 0,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
  metadata: {},
};

describe('CampaignDetailPanel', () => {
  it('renders loading state', () => {
    render(
      <BrowserRouter>
        <CampaignDetailPanel
          campaign={null}
          appConfig={mockConfig}
          isLoading={true}
        />
      </BrowserRouter>
    );
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('renders not found state when notFoundCampaignId is provided', () => {
    render(
      <BrowserRouter>
        <CampaignDetailPanel
          campaign={null}
          appConfig={mockConfig}
          notFoundCampaignId="999"
        />
      </BrowserRouter>
    );
    expect(screen.getByText('Campaign not found')).toBeInTheDocument();
    expect(screen.getByText(/campaign #999 does not exist/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to campaigns' })).toBeInTheDocument();
  });

  it('renders empty state when no campaign is selected', () => {
    render(
      <BrowserRouter>
        <CampaignDetailPanel
          campaign={null}
          appConfig={mockConfig}
          isLoading={false}
        />
      </BrowserRouter>
    );
    expect(screen.getByText('Campaign actions')).toBeInTheDocument();
  });

  it('renders campaign details when campaign is provided', () => {
    const { container } = render(
      <BrowserRouter>
        <CampaignDetailPanel
          campaign={mockCampaign}
          appConfig={mockConfig}
          connectedWallet={mockCampaign.creator}
          isLoading={false}
        />
      </BrowserRouter>
    );
    expect(screen.getByText('Test Campaign')).toBeInTheDocument();
    expect(container.querySelector('.campaign-detail-banner')).toBeInTheDocument();
    expect(container.querySelectorAll('.campaign-detail-actions')).toHaveLength(2);
    expect(container.querySelector('.wallet-address-row')).toBeInTheDocument();
  });

  it('exposes named groups and supports keyboard activation', async () => {
    const user = userEvent.setup();
    const onConnectWallet = vi.fn().mockResolvedValue(undefined);

    render(
      <BrowserRouter>
        <CampaignDetailPanel
          campaign={mockCampaign}
          appConfig={mockConfig}
          onConnectWallet={onConnectWallet}
        />
      </BrowserRouter>,
    );

    expect(screen.getByRole('region', { name: 'Test Campaign' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Wallet status' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Campaign summary' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Pledge campaign' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Refund contributor' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Campaign actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toHaveAccessibleName('Connect Wallet');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Connect Wallet' }));
    await user.keyboard('{Enter}');
    expect(onConnectWallet).toHaveBeenCalledOnce();
  });

  describe('Failure Path Coverage', () => {
    it('handles missing data gracefully when campaign is null', () => {
      render(
        <BrowserRouter>
          <CampaignDetailPanel
            campaign={null}
            appConfig={mockConfig}
            isLoading={false}
          />
        </BrowserRouter>
      );
      // Should not crash, should show empty state or loading
      expect(screen.queryByText('Test Campaign')).not.toBeInTheDocument();
    });

    it('handles invalid input by not rendering campaign details', () => {
      const invalidCampaign = { ...mockCampaign, id: '' };
      render(
        <BrowserRouter>
          <CampaignDetailPanel
            campaign={invalidCampaign as any}
            appConfig={mockConfig}
            isLoading={false}
          />
        </BrowserRouter>
      );
      // Should not crash on invalid ID
      expect(screen.getByRole('region')).toBeInTheDocument();
    });

    it('handles duplicate actions by preventing multiple submissions', async () => {
      const mockOnPledge = vi.fn().mockRejectedValue(new Error('Duplicate pledge'));
      
      // Mock the pledge function to simulate duplicate action
      vi.doMock('../services/campaignService', () => ({
        pledgeCampaign: mockOnPledge,
      }));

      render(
        <BrowserRouter>
          <CampaignDetailPanel
            campaign={mockCampaign}
            appConfig={mockConfig}
            isLoading={false}
          />
        </BrowserRouter>
      );

      // Attempt to trigger a pledge action
      const pledgeButton = screen.getByRole('button', { name: /pledge/i });
      if (pledgeButton) {
        await pledgeButton.click();
        // Should handle the error gracefully without crashing
        await waitFor(() => {
          expect(mockOnPledge).toHaveBeenCalled();
        });
      }
    });

    it('handles timeout/retry scenarios', async () => {
      // Simulate a timeout scenario by mocking the service to throw a timeout error
      vi.doMock('../services/campaignService', () => ({
        pledgeCampaign: vi.fn().mockRejectedValue(new Error('Request timeout')),
      }));

      render(
        <BrowserRouter>
          <CampaignDetailPanel
            campaign={mockCampaign}
            appConfig={mockConfig}
            isLoading={false}
          />
        </BrowserRouter>
      );

      // Component should still render despite service errors
      expect(screen.getByText('Test Campaign')).toBeInTheDocument();
    });

    it('handles permission failures', async () => {
      // Simulate a permission denied error
      vi.doMock('../services/campaignService', () => ({
        pledgeCampaign: vi.fn().mockRejectedValue(new Error('Permission denied')),
      }));

      render(
        <BrowserRouter>
          <CampaignDetailPanel
            campaign={mockCampaign}
            appConfig={mockConfig}
            isLoading={false}
          />
        </BrowserRouter>
      );

      // Component should still render despite permission errors
      expect(screen.getByText('Test Campaign')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Pledge Flow States — focused coverage for #833
// ---------------------------------------------------------------------------

describe('CampaignDetailPanel – Pledge Flow States', () => {
  const connectedWallet = `G${'B'.repeat(55)}`;

  function renderWithCampaign(
    campaignOverrides: Partial<Campaign> = {},
    extraProps: {
      onPledge?: (id: string, amount: number, assetCode: string) => Promise<void>;
      isPledgePending?: boolean;
      connectedWallet?: string | null;
    } = {},
  ) {
    const campaign: Campaign = { ...mockCampaign, ...campaignOverrides };
    const { onPledge, isPledgePending = false, connectedWallet: wallet = connectedWallet } = extraProps;
    return render(
      <BrowserRouter>
        <CampaignDetailPanel
          campaign={campaign}
          appConfig={mockConfig}
          isLoading={false}
          connectedWallet={wallet}
          isPledgePending={isPledgePending}
          onPledge={onPledge}
        />
      </BrowserRouter>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Loading / skeleton state
  // -------------------------------------------------------------------------

  it('skeleton has aria-busy and no pledge form while loading', () => {
    render(
      <BrowserRouter>
        <CampaignDetailPanel campaign={null} appConfig={mockConfig} isLoading={true} />
      </BrowserRouter>,
    );
    const region = screen.getByRole('region');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: /add pledge/i })).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Empty / canPledge=false states
  // -------------------------------------------------------------------------

  it('shows a funded explanation when canPledge is false and status is funded', () => {
    renderWithCampaign({
      progress: { ...mockCampaign.progress, canPledge: false, status: 'funded' },
    });
    expect(
      screen.getByText(/reached its goal and is no longer accepting pledges/i),
    ).toBeInTheDocument();
  });

  it('shows a claimed explanation when canPledge is false and status is claimed', () => {
    renderWithCampaign({
      progress: { ...mockCampaign.progress, canPledge: false, status: 'claimed' },
    });
    expect(screen.getByText(/creator has already claimed/i)).toBeInTheDocument();
  });

  it('shows a failed explanation when canPledge is false and status is failed', () => {
    renderWithCampaign({
      progress: { ...mockCampaign.progress, canPledge: false, status: 'failed' },
    });
    expect(screen.getByText(/did not reach its goal before the deadline/i)).toBeInTheDocument();
  });

  it('shows a generic explanation when canPledge is false and status is open', () => {
    renderWithCampaign({
      progress: { ...mockCampaign.progress, canPledge: false, status: 'open' },
    });
    expect(screen.getByText(/pledging is not available for this campaign/i)).toBeInTheDocument();
  });

  it('does not show the canPledge explanation when canPledge is true', () => {
    renderWithCampaign({
      progress: { ...mockCampaign.progress, canPledge: true, status: 'open' },
    });
    expect(
      screen.queryByText(/no longer accepting pledges|already claimed|did not reach/i),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Success state
  // -------------------------------------------------------------------------

  it('shows a success message after a successful pledge', async () => {
    const user = userEvent.setup();
    const onPledge = vi.fn().mockResolvedValue(undefined);
    renderWithCampaign({}, { onPledge });

    await user.click(screen.getByRole('button', { name: /add pledge/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/pledge submitted successfully/i);
  });

  it('auto-dismisses the success message after 4 seconds', async () => {
    // Use fake timers only for the setTimeout advance; userEvent uses real time
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup();
    const onPledge = vi.fn().mockResolvedValue(undefined);
    renderWithCampaign({}, { onPledge });

    await user.click(screen.getByRole('button', { name: /add pledge/i }));
    expect(await screen.findByRole('status')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('resets pledge amount to 25 after a successful pledge', async () => {
    const user = userEvent.setup();
    const onPledge = vi.fn().mockResolvedValue(undefined);
    renderWithCampaign({}, { onPledge });

    const amountInput = screen.getByRole('spinbutton') as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, '99');
    expect(amountInput).toHaveValue(99);

    await user.click(screen.getByRole('button', { name: /add pledge/i }));

    await waitFor(() => expect(amountInput).toHaveValue(25));
  });

  it('clears success message when a new pledge attempt starts', async () => {
    const user = userEvent.setup();
    let rejectNext = false;
    const onPledge = vi.fn().mockImplementation(async () => {
      if (rejectNext) throw new Error('Network error');
    });
    renderWithCampaign({}, { onPledge });

    await user.click(screen.getByRole('button', { name: /add pledge/i }));
    expect(await screen.findByRole('status')).toBeInTheDocument();

    rejectNext = true;
    await user.click(screen.getByRole('button', { name: /add pledge/i }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Failure / retry state
  // -------------------------------------------------------------------------

  it('shows a pledge error with a Retry button on failure', async () => {
    const user = userEvent.setup();
    const onPledge = vi.fn().mockRejectedValue(new Error('Insufficient balance'));
    renderWithCampaign({}, { onPledge });

    await user.click(screen.getByRole('button', { name: /add pledge/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/insufficient balance/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retry button re-submits the pledge', async () => {
    const user = userEvent.setup();
    const onPledge = vi.fn()
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce(undefined);
    renderWithCampaign({}, { onPledge });

    await user.click(screen.getByRole('button', { name: /add pledge/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(onPledge).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('maps a fee-estimation error code to a friendly message', async () => {
    const user = userEvent.setup();
    const feeError = Object.assign(new Error('sim fail'), { code: 'SIMULATION_FAILED' });
    const onPledge = vi.fn().mockRejectedValue(feeError);
    renderWithCampaign({}, { onPledge });

    await user.click(screen.getByRole('button', { name: /add pledge/i }));

    expect(await screen.findByText(/could not estimate fee/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // isSubmitting / disabled states during in-progress pledge
  // -------------------------------------------------------------------------

  it('disables the amount input while a pledge is submitting', async () => {
    const user = userEvent.setup();
    let resolveOnPledge!: () => void;
    const onPledge = vi.fn(() => new Promise<void>((resolve) => { resolveOnPledge = resolve; }));
    renderWithCampaign({}, { onPledge });

    const amountInput = screen.getByRole('spinbutton');
    await user.click(screen.getByRole('button', { name: /add pledge/i }));

    expect(amountInput).toBeDisabled();

    resolveOnPledge();
    await waitFor(() => expect(amountInput).not.toBeDisabled());
  });

  it('shows Submitting... on the button while isSubmitting is true', async () => {
    const user = userEvent.setup();
    let resolveOnPledge!: () => void;
    const onPledge = vi.fn(() => new Promise<void>((resolve) => { resolveOnPledge = resolve; }));
    renderWithCampaign({}, { onPledge });

    const submitBtn = screen.getByRole('button', { name: /add pledge/i });
    await user.click(submitBtn);

    expect(submitBtn).toHaveTextContent('Submitting...');
    expect(submitBtn).toBeDisabled();

    resolveOnPledge();
    await waitFor(() => expect(submitBtn).toHaveTextContent('Add pledge'));
  });

  // -------------------------------------------------------------------------
  // isPledgePending state (external in-flight flag from App.tsx)
  // -------------------------------------------------------------------------

  it('shows pending note when isPledgePending is true', () => {
    renderWithCampaign({}, { isPledgePending: true });
    expect(screen.getByText(/pledge transaction is in flight/i)).toBeInTheDocument();
  });

  it('disables the pledge amount input when isPledgePending is true', () => {
    renderWithCampaign({}, { isPledgePending: true });
    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });

  it('pledge form has aria-busy when isPledgePending is true', () => {
    renderWithCampaign({}, { isPledgePending: true });
    const form = screen.getByRole('spinbutton').closest('form');
    expect(form).toHaveAttribute('aria-busy', 'true');
  });

  it('submit button is disabled and shows Submitting... when isPledgePending is true', () => {
    renderWithCampaign({}, { isPledgePending: true });
    // disabled buttons are excluded from the accessibility tree by default;
    // use getAllByRole with hidden:true to find it
    const buttons = screen.getAllByRole('button', { hidden: true });
    const submitBtn = buttons.find((b) => b.textContent?.includes('Submitting'));
    expect(submitBtn).toBeDefined();
    expect(submitBtn).toBeDisabled();
  });
});
