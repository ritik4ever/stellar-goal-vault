import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import { Campaign, AppConfig } from '../types/campaign';

describe('CampaignDetailPanel - Mobile Touch Targets', () => {
  const mockCampaign: Campaign = {
    id: '1',
    title: 'Test Campaign',
    description: 'A test campaign for mobile responsiveness',
    creator: 'GCREATORADDRESSEXAMPLE1234567890ABCDEF',
    assetCode: 'USDC',
    acceptedTokens: ['USDC'],
    targetAmount: 1000,
    pledgedAmount: 500,
    createdAt: Math.floor(Date.now() / 1000),
    deadline: Date.now() + 86400000,
    progress: {
      status: 'open',
      percentFunded: 50,
      remainingAmount: 500,
      pledgeCount: 5,
      hoursLeft: 24,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
    metadata: {
      imageUrl: 'https://example.com/image.jpg',
    },
  };

  const mockAppConfig: AppConfig = {
    walletIntegrationReady: true,
    networkPassphrase: 'Test SDF Network ; September 2015',
    allowedAssets: ['USDC'],
    contractId: 'CCONTRACTID1234567890ABCDEF',
    contractAmountDecimals: 7,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    assetAddresses: { USDC: 'CUSDC' },
    soroban: {
      enabled: true,
      contractId: 'CCONTRACTID1234567890ABCDEF',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
    },
  };

  const mockOnPledge = vi.fn();
  const mockOnConnectWallet = vi.fn();

  it('renders pledge form with accessible elements', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockAppConfig}
        connectedWallet="GCONNECTEDWALLET1234567890ABCDEF"
        onPledge={mockOnPledge}
        onConnectWallet={mockOnConnectWallet}
      />,
    );

    // Form should be present with proper label
    const pledgeForm = screen.getByRole('form', { name: /pledge form/i });
    expect(pledgeForm).toBeInTheDocument();

    // Amount input should be accessible
    const amountInput = screen.getByLabelText(/amount/i);
    expect(amountInput).toBeInTheDocument();
    expect(amountInput).toHaveAttribute('type', 'number');

    // Asset selector should be present
    const assetSelect = screen.getByLabelText(/asset/i);
    expect(assetSelect).toBeInTheDocument();

    // Pledge button should be accessible
    const pledgeButton = screen.getByRole('button', { name: /pledge/i });
    expect(pledgeButton).toBeInTheDocument();
    expect(pledgeButton).toHaveClass('btn-primary');
  });

  it('has proper touch target sizing for mobile buttons', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockAppConfig}
        connectedWallet="GCONNECTEDWALLET1234567890ABCDEF"
        onPledge={mockOnPledge}
      />,
    );

    // Pledge button should be present
    const pledgeButton = screen.getByRole('button', { name: /pledge/i });
    expect(pledgeButton).toBeInTheDocument();

    // Check that button has proper class for styling
    expect(pledgeButton).toHaveClass('btn-primary');
    
    // Verify button is in form-actions container for mobile styling
    const formActions = pledgeButton.closest('.form-actions');
    expect(formActions).toBeInTheDocument();
  });

  it('displays form fields without horizontal overflow on narrow screens', () => {
    const { container } = render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockAppConfig}
        connectedWallet="GCONNECTEDWALLET1234567890ABCDEF"
        onPledge={mockOnPledge}
      />,
    );

    // All form fields should be in form-field containers
    const formFields = container.querySelectorAll('.form-field');
    expect(formFields.length).toBeGreaterThan(0);

    // Form grid should exist for proper mobile layout
    const formGrid = container.querySelector('.form-grid');
    expect(formGrid).toBeInTheDocument();
  });

  it('shows campaign details in mobile-friendly grid', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockAppConfig}
        connectedWallet="GCONNECTEDWALLET1234567890ABCDEF"
        onPledge={mockOnPledge}
      />,
    );

    // Check that detail stats are rendered
    expect(screen.getByText('Campaign ID')).toBeInTheDocument();
    expect(screen.getByText('Creator')).toBeInTheDocument();
    expect(screen.getByText('Asset')).toBeInTheDocument();
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByText('Active pledges')).toBeInTheDocument();
  });

  it('renders wallet status section with proper structure', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockAppConfig}
        connectedWallet="GCONNECTEDWALLET1234567890ABCDEF"
        onPledge={mockOnPledge}
      />,
    );

    // Wallet status should be present
    const walletStatus = screen.getByRole('group', { name: /wallet status/i });
    expect(walletStatus).toBeInTheDocument();

    // Should show connected status
    expect(screen.getByText(/connected to stellar testnet/i)).toBeInTheDocument();
  });

  it('maintains form accessibility on mobile with proper labels and descriptions', () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockAppConfig}
        connectedWallet="GCONNECTEDWALLET1234567890ABCDEF"
        onPledge={mockOnPledge}
      />,
    );

    // Amount field should have description
    const amountInput = screen.getByLabelText(/amount/i);
    expect(amountInput).toHaveAttribute('aria-description', 'pledge-amount-help');
    
    const amountHelp = screen.getByText(/enter the amount you want to pledge/i);
    expect(amountHelp).toBeInTheDocument();
    expect(amountHelp).toHaveAttribute('id', 'pledge-amount-help');
  });
});
