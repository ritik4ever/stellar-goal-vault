import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppConfig, Campaign } from '../types/campaign';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a1yTestUtils';

const mockConfig: AppConfig = {
  allowedAssets: ['USDC', 'XLM'],
  soroban: {
    enabled: true,
    contractId: 'C123',
    networkPassphrase: 'Test DF Network ; September 2015',
    rpcUrl: 'https://example.com',
  },
  sorobanRpcUrl: 'https://example.com',
  contractId: 'C123',
  networkPassphrase: 'Test DF Network ; September 2015',
  contractAmountDecimals: 2,
  walletIntegrationReady: true,
  assetAddresses: {},
};

const mockCampaign: Campaign = {
  id: '1',
  title: 'Test Campaign',
  description: 'A test campaign description for accessibility auditing.',
  creator: `G${'A'.repeat(55)}`,
  assetCode: 'USDC',
  acceptedTokens: ['USDC'],
  targetAmount: 100,
  pledgedAmount: 25,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  createdAt: Math.floor(Date.now() / 1000),
  pledges: [
    {
      id: 1,
      campaignId: '1',
      contributor: `G${'B'.repeat(55)}`,
      amount: 25,
      assetCode: 'USDC',
      createdAt: Math.floor(Date.now() / 1000),
    },
  ],
  progress: {
    status: 'open',
    percentFunded: 25,
    remainingAmount: 75,
    hoursLeft: 1,
    pledgeCount: 1,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
  metadata: {},
};

describe.each(THEMES)('CampaignDetailPanel Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations in empty state', async () => {
    const { container } = render(<CampaignDetailPanel campaign={null} appConfig={mockConfig} />);

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations with a selected campaign', async () => {
    const { container } = render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockConfig}
        connectedWallet={mockCampaign.creator}
      />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('exposes an accessible name for the campaign detail region', async () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockConfig}
        connectedWallet={mockCampaign.creator}
      />,
    );

    const region = screen.getByRole('region', {
      name: /Test Campaign details?/i,
    });
    expect(region).toBeDefined();
  });

  it('exposes a control with an accessible name for the primary pledge action', async () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockConfig}
        connectedWallet={mockCampaign.creator}
      />,
    );

    const controls = screen.getAllByRole('button');
    expect(controls.length).greaterThan(0);
    const named = controls.some((control) => {
      const name = control.getAttribute('aria-label') ?? control.textContent ?? '';
      return name.trim().length > 0;
    });
    expect(named).toBe(true);
  });
});
