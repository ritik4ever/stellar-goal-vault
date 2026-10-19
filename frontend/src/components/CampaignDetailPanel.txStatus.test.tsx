import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import type { AppConfig, Campaign } from '../types/campaign';

vi.mock('./ContributorSummary', () => ({ ContributorSummary: () => null }));

const TESTNET = 'Test SDF Network ; September 2015';

const appConfig: AppConfig = {
  allowedAssets: ['USDC'],
  soroban: { enabled: true, contractId: 'C1', networkPassphrase: TESTNET, rpcUrl: 'https://rpc' },
  sorobanRpcUrl: 'https://rpc',
  contractId: 'C1',
  networkPassphrase: TESTNET,
  contractAmountDecimals: 2,
  walletIntegrationReady: true,
  assetAddresses: { USDC: 'C2' },
};

const campaign: Campaign = {
  id: '7',
  title: 'Community garden',
  description: 'Fund a community garden',
  creator: `G${'A'.repeat(55)}`,
  assetCode: 'USDC',
  acceptedTokens: ['USDC'],
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

function codedError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Props = ComponentProps<typeof CampaignDetailPanel>;

function renderPanel(onPledge: Props['onPledge']) {
  render(
    <CampaignDetailPanel
      campaign={campaign}
      appConfig={appConfig}
      connectedWallet={`G${'B'.repeat(55)}`}
      onPledge={onPledge}
    />,
    { wrapper: MemoryRouter },
  );
  return userEvent.setup();
}

const amount = () => screen.getByLabelText('Amount');
const asset = () => screen.getByLabelText('Asset');
const pledgeButton = () => screen.getByRole('button', { name: /pledge|submitting/i });
const status = () => screen.queryByTestId('pledge-status');
const form = () => screen.getByRole('form', { name: 'Pledge form' });

describe('Pledge transaction status (#939)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      })),
    );
  });

  it('moves pending → confirmed and locks asset and amount while pending', async () => {
    const pending = deferred();
    const onPledge = vi.fn().mockReturnValue(pending.promise);
    const user = renderPanel(onPledge);

    await user.click(pledgeButton());

    expect(status()).toHaveAttribute('data-status', 'pending');
    expect(status()).toHaveTextContent(/Submitting your USDC pledge/);
    expect(asset()).toBeDisabled();
    expect(amount()).toBeDisabled();
    expect(pledgeButton()).toBeDisabled();

    await act(async () => pending.resolve());

    expect(status()).not.toBeInTheDocument();
    expect(screen.getByText('Your pledge was submitted successfully.')).toBeInTheDocument();
    expect(asset()).toBeEnabled();
    expect(amount()).toBeEnabled();
  });

  it('moves pending → failed and unlocks the form for new details', async () => {
    const onPledge = vi
      .fn()
      .mockRejectedValue(codedError('TRANSACTION_FAILED', 'The network rejected the pledge.'));
    const user = renderPanel(onPledge);

    await user.click(pledgeButton());

    expect(status()).toHaveAttribute('data-status', 'failed');
    expect(status()).toHaveTextContent(/failed and was not recorded/);
    expect(screen.getByRole('alert')).toHaveTextContent('The network rejected the pledge.');
    expect(asset()).toBeEnabled();
    expect(amount()).toBeEnabled();
    expect(pledgeButton()).toHaveTextContent('Pledge');
  });

  it('moves pending → retryable → confirmed, retrying with the same asset and amount', async () => {
    const onPledge = vi
      .fn()
      .mockRejectedValueOnce(codedError('TRANSACTION_TIMEOUT', 'Not confirmed yet.'))
      .mockResolvedValueOnce(undefined);
    const user = renderPanel(onPledge);

    await user.clear(amount());
    await user.type(amount(), '40');
    await user.click(pledgeButton());

    expect(status()).toHaveAttribute('data-status', 'retryable');
    expect(status()).toHaveTextContent(/will not be charged twice/);
    expect(asset()).toBeDisabled();
    expect(amount()).toBeDisabled();
    expect(pledgeButton()).toHaveTextContent('Retry pledge');

    await user.click(pledgeButton());

    expect(onPledge).toHaveBeenCalledTimes(2);
    expect(onPledge).toHaveBeenNthCalledWith(1, '7', 40, 'USDC');
    expect(onPledge).toHaveBeenNthCalledWith(2, '7', 40, 'USDC');
    expect(screen.getByText('Your pledge was submitted successfully.')).toBeInTheDocument();
    expect(asset()).toBeEnabled();
  });

  it('ignores repeated submits while a pledge is pending', async () => {
    const pending = deferred();
    const onPledge = vi.fn().mockReturnValue(pending.promise);
    renderPanel(onPledge);

    // Fire several submits synchronously, before React can re-render the
    // disabled button, to exercise the in-flight guard itself.
    act(() => {
      fireEvent.submit(form());
      fireEvent.submit(form());
      fireEvent.submit(form());
    });

    expect(onPledge).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('does not let the selected asset change while a pledge is pending', async () => {
    const pending = deferred();
    const onPledge = vi.fn().mockReturnValue(pending.promise);
    const user = renderPanel(onPledge);

    await user.selectOptions(asset(), 'USDC');
    await user.click(pledgeButton());

    expect(asset()).toBeDisabled();
    fireEvent.change(asset(), { target: { value: '' } });
    expect(asset()).toHaveValue('USDC');

    await act(async () => pending.resolve());
  });

  it('returns to idle without an error when the user cancels', async () => {
    const onPledge = vi.fn().mockRejectedValue(codedError('USER_CANCELLED'));
    const user = renderPanel(onPledge);

    await user.click(pledgeButton());

    expect(status()).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(asset()).toBeEnabled();
  });
});
