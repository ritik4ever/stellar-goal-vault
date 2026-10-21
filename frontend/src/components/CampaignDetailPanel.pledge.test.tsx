import type { ComponentProps } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import type { AppConfig, Campaign } from '../types/campaign';

vi.mock('./ContributorSummary', () => ({ ContributorSummary: () => null }));

const wallet = `G${'B'.repeat(55)}`;
const appConfig: AppConfig = {
  allowedAssets: ['USDC', 'XLM'],
  soroban: {
    enabled: true,
    contractId: `C${'C'.repeat(55)}`,
    networkPassphrase: 'Test DF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  contractId: `C${'C'.repeat(55)}`,
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractAmountDecimals: 2,
  walletIntegrationReady: true,
  assetAddresses: { USDC: 'CUSDC', XLM: 'CXL' },
};
const campaign: Campaign = {
  id: 'pledge-campaign',
  title: 'Community garden',
  description: 'Fund a community garden',
  creator: `G${'A'.repeat(55)}`,
  assetCode: 'USDC',
  acceptedTokens: ['USDC', 'XLM'],
  targetAmount: 1000,
  pledgedAmount: 0,
  deadline: 4102444800,
  createdAt: 1700000000,
  pledges: [],
  progress: {
    status: 'open',
    percentFunded: 0,
    remainingAmount: 1000,
    hoursLeft: 24,
    pledgeCount: 0,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
};

type Props = ComponentProps<typeof CampaignDetailPanel>;
function renderPledge(overrides: Partial<Props> = {}) {
  const onPledge = vi.fn().mockResolvedValue(undefined);
  render(
    <CampaignDetailPanel
      campaign={campaign}
      appConfig={appConfig}
      connectedWallet={wallet}
      onPledge={onPledge}
      {...overrides}
    />,
    { wrapper: MemoryRouter },
  );
  return { onPledge, user: userEvent.setup() };
}

const form = () => screen.getByRole('form', { name: 'Pledge form' });
const amount = () => within(form()).getByRole('spinbutton', { name: 'Amount' });
const asset = () => within(form()).getByRole('combobox', { name: 'Asset' });
const submit = () => within(form()).getByRole('button', { name: 'Pledge' });

describe('Pledge asset selection', () => {
  it('submits the selected accepted asset and resets after success', async () => {
    let resolvePledge!: () => void;
    const pendingPledge = new Promise<void>((resolve) => {
      resolvePledge = resolve;
    });
    const onPledge = vi.fn().mockReturnValue(pendingPledge);
    const { user } = renderPledge({ onPledge });

    expect(
      within(asset())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Default (USDC)', 'USDC', 'XLM']);
    await user.clear(amount());
    await user.type(amount(), '12.34');
    await user.selectOptions(asset(), 'XLM');
    await user.click(submit());

    expect(onPledge).toHaveBeenCalledWith(campaign.id, 12.34, 'XLM');
    expect(amount()).toHaveValue(12.34);
    expect(asset()).toHaveValue('XLM');
    await act(async () => resolvePledge());
    expect(screen.getByRole('status')).toHaveTextContent('Your pledge was submitted successfully.');
    expect(amount()).toHaveValue(25);
    expect(asset()).toHaveValue('');
  });

  it('uses the campaign asset and hides the selector when only one asset is accepted', async () => {
    const { onPledge, user } = renderPledge({
      campaign: { ...campaign, acceptedTokens: ['USDC'] },
    });

    expect(within(form()).queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(submit());
    expect(onPledge).toHaveBeenCalledWith(campaign.id, 25, 'USDC');
  });

  it('preserves the selected asset and amount when the wallet rejects the pledge', async () => {
    const onPledge = vi.fn().mockRejectedValue(new Error('Freighter rejected signing'));
    const { user } = renderPledge({ onPledge });

    await user.clear(amount());
    await user.type(amount(), '42');
    await user.selectOptions(asset(), 'XLM');
    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('Freighter rejected signing');
    expect(amount()).toHaveValue(42);
    expect(asset()).toHaveValue('XLM');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('blocks submission and shows an actionable message when the wallet network mismatches', async () => {
    const onPledge = vi.fn().mockResolvedValue(undefined);
    const { user } = renderPledge({
      onPledge,
      walletNetworkPassphrase: 'Public Global Stellar Network ; September 2015',
    });

    await user.clear(amount());
    await user.type(amount(), '10');
    await user.click(submit());

    expect(onPledge).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/network/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/switch/i);
    expect(amount()).toHaveValue(10);
  });
});
