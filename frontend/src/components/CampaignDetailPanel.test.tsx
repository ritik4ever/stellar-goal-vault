import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import { AppConfig, Campaign } from '../types/campaign';

// Mock the ContributorSummary since it makes API calls
vi.mock('./ContributorSummary', () => ({
  ContributorSummary: () => <div data-testid="contributor-summary-mock" />,
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
  it('renders empty state when no campaign is selected', () => {
    render(<CampaignDetailPanel campaign={null} appConfig={mockConfig} />);

    expect(screen.getByText(/pick a campaign/i)).toBeInTheDocument();
  });

  it('renders campaign details when a campaign is provided', () => {
    render(
      <CampaignDetailPanel campaign={mockCampaign} appConfig={mockConfig} />,
    );

    expect(screen.getByText('Test Campaign')).toBeInTheDocument();
    expect(screen.getByText('A test campaign description')).toBeInTheDocument();
  });

  it('renders loading skeleton when isLoading is true', () => {
    render(
      <CampaignDetailPanel
        campaign={null}
        appConfig={mockConfig}
        isLoading={true}
      />,
    );

    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });
});
