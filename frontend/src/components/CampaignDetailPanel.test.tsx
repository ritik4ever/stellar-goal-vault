import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import { AppConfig, Campaign } from '../types/campaign';

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
  assetAddresses: {

  },
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



    expect(screen.getByText(/pick a campaign/i)).toBeInTheDocument();
  });


    const user = userEvent.setup();
    const onClose = vi.fn();

    render(

  });
});
