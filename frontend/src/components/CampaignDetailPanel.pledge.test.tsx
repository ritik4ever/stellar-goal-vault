import type { ComponentProps } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CampaignDetailPanel } from './CampaignDetailPanel';
import type { Campaign } from '../types/campaign';

// Contributor polling is outside the pledge form's callback boundary.
vi.mock('./ContributorSummary', () => ({ ContributorSummary: () => null }));

const wallet = `G${'B'.repeat(55)}`;
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
  const props: Props = { campaign, connectedWallet: wallet, onPledge, ...overrides };
  const view = render(<CampaignDetailPanel {...props} />, { wrapper: MemoryRouter });
  return {
    ...view,
    onPledge,
    user: userEvent.setup(),
    update: (next: Partial<Props>) => view.rerender(<CampaignDetailPanel {...props} {...next} />),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const form = () => screen.getByRole('form', { name: 'Pledge campaign' });
const amount = () => within(form()).getByRole('spinbutton', { name: 'Pledge amount' });
const token = () => within(form()).getByRole('combobox', { name: 'Token' });
const submit = () => within(form()).getByRole('button', { name: 'Add pledge' });

describe('Pledge form behavior', () => {
  it('submits the campaign ID, numeric amount and selected token, then resets only after success', async () => {
    const pending = deferred();
    const onPledge = vi.fn().mockReturnValue(pending.promise);
    const { user } = renderPledge({ onPledge });
    await user.clear(amount());
    await user.type(amount(), '12.34');
    await user.selectOptions(token(), 'XLM');
    await user.click(submit());

    expect(onPledge).toHaveBeenCalledTimes(1);
    expect(onPledge).toHaveBeenCalledWith(campaign.id, 12.34, 'XLM');
    expect(amount()).toHaveValue(12.34);
    expect(token()).toHaveValue('XLM');
    expect(screen.queryByText('Pledge submitted successfully.')).not.toBeInTheDocument();
    await act(async () => pending.resolve());
    expect(screen.getByText('Pledge submitted successfully.')).toHaveAttribute('role', 'status');
    expect(amount()).toHaveValue(25);
    expect(token()).toHaveValue('USDC');
    expect(form()).toHaveAttribute('aria-busy', 'false');
  });

  it('uses the campaign asset when there is no token selector', async () => {
    const { user, onPledge } = renderPledge({
      campaign: { ...campaign, acceptedTokens: ['USDC'] },
    });
    expect(within(form()).queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(submit());
    expect(onPledge).toHaveBeenCalledTimes(1);
    expect(onPledge).toHaveBeenCalledWith(campaign.id, 25, 'USDC');
  });

  it('locks all pledge inputs and prevents a second request while the callback is unresolved', async () => {
    const pending = deferred();
    const onPledge = vi.fn().mockReturnValue(pending.promise);
    const { user } = renderPledge({ onPledge });
    await user.click(submit());
    const busyButton = within(form()).getByRole('button', { name: 'Submitting...' });
    expect(form()).toHaveAttribute('aria-busy', 'true');
    expect(amount()).toBeDisabled();
    expect(token()).toBeDisabled();
    expect(busyButton).toBeDisabled();
    await user.click(busyButton);
    expect(onPledge).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(submit()).toBeEnabled();
    expect(amount()).toBeEnabled();
    expect(token()).toBeEnabled();
  });

  it('blocks submissions while backend reconciliation is pending, then re-enables the form', async () => {
    const { user, onPledge, update } = renderPledge({ isPledgePending: true });
    expect(form()).toHaveAttribute('aria-busy', 'true');
    expect(amount()).toBeDisabled();
    expect(token()).toBeDisabled();
    const busyButton = within(form()).getByRole('button', { name: 'Submitting...' });
    expect(busyButton).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('The pledge transaction is in flight');
    await user.click(busyButton);
    expect(onPledge).not.toHaveBeenCalled();
    update({ isPledgePending: false });
    expect(form()).toHaveAttribute('aria-busy', 'false');
    expect(submit()).toBeEnabled();
    expect(amount()).toBeEnabled();
    expect(token()).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['empty', ''],
    ['zero', '0'],
    ['negative', '-1'],
    ['below minimum', '0.001'],
    ['fractional cent', '1.001'],
  ])('rejects an %s amount through native form validation', async (_label, value) => {
    const { user, onPledge } = renderPledge();
    await user.clear(amount());
    if (value) await user.type(amount(), value);
    expect(amount()).toBeInvalid();
    await user.click(submit());
    expect(onPledge).not.toHaveBeenCalled();
    expect(screen.queryByText('Pledge submitted successfully.')).not.toBeInTheDocument();
    expect(form()).toHaveAttribute('aria-busy', 'false');
  });

  it('accepts the minimum amount after an invalid attempt', async () => {
    const { user, onPledge } = renderPledge();
    await user.clear(amount());
    await user.click(submit());
    expect(onPledge).not.toHaveBeenCalled();
    await user.type(amount(), '0.01');
    expect(amount()).toBeValid();
    await user.click(submit());
    expect(onPledge).toHaveBeenCalledTimes(1);
    expect(onPledge).toHaveBeenCalledWith(campaign.id, 0.01, 'USDC');
  });

  it('preserves failed values and retries them, clearing the error only when retry starts', async () => {
    const retry = deferred();
    const onPledge = vi
      .fn()
      .mockRejectedValueOnce(new Error('Wallet rejected the request'))
      .mockReturnValueOnce(retry.promise);
    const { user } = renderPledge({ onPledge });
    await user.clear(amount());
    await user.type(amount(), '42.50');
    await user.selectOptions(token(), 'XLM');
    await user.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Wallet rejected the request');
    expect(form()).toHaveAccessibleDescription(/Wallet rejected the request/);
    expect(amount()).toHaveValue(42.5);
    expect(token()).toHaveValue('XLM');
    expect(submit()).toBeEnabled();
    expect(screen.queryByText('Pledge submitted successfully.')).not.toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onPledge).toHaveBeenNthCalledWith(1, campaign.id, 42.5, 'XLM');
    expect(onPledge).toHaveBeenNthCalledWith(2, campaign.id, 42.5, 'XLM');
    expect(onPledge).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(form()).not.toHaveAttribute('aria-describedby');
    expect(form()).toHaveAttribute('aria-busy', 'true');
    await act(async () => retry.resolve());
    expect(screen.getByText('Pledge submitted successfully.')).toBeInTheDocument();
    expect(amount()).toHaveValue(25);
    expect(token()).toHaveValue('USDC');
  });

  it.each([
    'SIMULATION_FAILED',
    'SIMULATION_PREPARE_FAILED',
    'SOURCE_ACCOUNT_LOAD_FAILED',
    'STATE_RESTORE_REQUIRED',
  ])('explains fee-estimation failure %s and allows retry', async (code) => {
    const onPledge = vi.fn().mockRejectedValue(Object.assign(new Error('RPC details'), { code }));
    const { user } = renderPledge({ onPledge });
    await user.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not estimate fee. Check your connection and retry.');
    expect(alert).not.toHaveTextContent('RPC details');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it.each([undefined, new Error('   ')])(
    'shows a useful fallback for an unhelpful rejection (%s)',
    async (error) => {
      const { user } = renderPledge({ onPledge: vi.fn().mockRejectedValue(error) });
      await user.click(submit());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The pledge could not be completed. Please try again.',
      );
      expect(submit()).toBeEnabled();
    },
  );

  it('disables pledging without a wallet and enables it after connecting', async () => {
    const { user, onPledge, update } = renderPledge({ connectedWallet: null });
    expect(submit()).toBeDisabled();
    await user.click(submit());
    expect(onPledge).not.toHaveBeenCalled();
    update({ connectedWallet: wallet });
    expect(screen.getByRole('textbox', { name: 'Connected contributor' })).toHaveValue(wallet);
    await user.click(submit());
    expect(onPledge).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['funded', 'has reached its goal'],
    ['claimed', 'already claimed this campaign'],
    ['failed', 'did not reach its goal'],
  ] as const)('prevents pledging to a %s campaign', async (status, explanation) => {
    const { user, onPledge } = renderPledge({
      campaign: { ...campaign, progress: { ...campaign.progress, status, canPledge: false } },
    });
    expect(submit()).toBeDisabled();
    expect(form()).toHaveTextContent(explanation);
    await user.click(submit());
    expect(onPledge).not.toHaveBeenCalled();
  });

  it('renders an empty selection without a pledge form', () => {
    const { onPledge } = renderPledge({ campaign: null });
    expect(screen.getByText('Pick a campaign from the board to manage it.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Pledge campaign' })).not.toBeInTheDocument();
    expect(onPledge).not.toHaveBeenCalled();
  });

  it('hides pledge actions behind the loading skeleton', () => {
    const { onPledge } = renderPledge({ isLoading: true });
    expect(screen.getByRole('region', { name: 'Loading campaign details' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByRole('form', { name: 'Pledge campaign' })).not.toBeInTheDocument();
    expect(onPledge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Recoverable error handling (#836)
// ---------------------------------------------------------------------------

function codedError(code: string, message = 'raw details', extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

async function enterPledge(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(amount());
  await user.type(amount(), '42.50');
  await user.selectOptions(token(), 'XLM');
}

describe('Pledge flow recoverable errors', () => {
  it('keeps the input after a cancelled preview and retries the same pledge', async () => {
    const onPledge = vi
      .fn()
      .mockRejectedValueOnce(codedError('USER_CANCELLED'))
      .mockResolvedValueOnce(undefined);
    const { user } = renderPledge({ onPledge });
    await enterPledge(user);
    await user.click(submit());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cancelled.*kept/i);
    expect(screen.queryByText('Pledge submitted successfully.')).not.toBeInTheDocument();
    expect(amount()).toHaveValue(42.5);
    expect(token()).toHaveValue('XLM');

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onPledge).toHaveBeenNthCalledWith(2, campaign.id, 42.5, 'XLM');
    expect(await screen.findByText('Pledge submitted successfully.')).toBeInTheDocument();
  });

  it('offers only "Retry sync" for a pledge confirmed on-chain but not synced', async () => {
    const hash = 'a'.repeat(64);
    const onPledge = vi
      .fn()
      .mockRejectedValue(codedError('PLEDGE_SYNC_FAILED', 'Network Error', { transactionHash: hash }));
    const onRetryPledgeSync = vi.fn().mockResolvedValue(undefined);
    const { user } = renderPledge({ onPledge, onRetryPledgeSync });
    await enterPledge(user);
    await user.click(submit());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`${hash.slice(0, 12)}…`);
    expect(alert).toHaveTextContent(/will not be charged again/i);
    expect(within(alert).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Retry sync' }));
    expect(onRetryPledgeSync).toHaveBeenCalledWith(campaign.id);
    // The pledge itself is never re-submitted by the sync recovery.
    expect(onPledge).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Pledge submitted successfully.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the sync recovery available when the sync fails again', async () => {
    const onPledge = vi.fn().mockRejectedValue(codedError('PLEDGE_SYNC_FAILED'));
    const onRetryPledgeSync = vi.fn().mockRejectedValue(codedError('PLEDGE_SYNC_FAILED'));
    const { user } = renderPledge({ onPledge, onRetryPledgeSync });
    await user.click(submit());
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Retry sync' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Retry sync' })).toBeEnabled();
    expect(onRetryPledgeSync).toHaveBeenCalledTimes(1);
    expect(onPledge).toHaveBeenCalledTimes(1);
  });

  it('asks to connect the wallet and clears the error once connected', async () => {
    const onPledge = vi.fn().mockRejectedValue(codedError('WALLET_NOT_CONNECTED', 'Connect Freighter'));
    const onConnectWallet = vi.fn().mockResolvedValue(undefined);
    const { user } = renderPledge({ onPledge, onConnectWallet });
    await enterPledge(user);
    await user.click(submit());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/connect your wallet/i);
    await user.click(within(alert).getByRole('button', { name: 'Connect wallet' }));

    expect(onConnectWallet).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(amount()).toHaveValue(42.5);
  });

  it('moves focus to the amount for an invalid-amount error', async () => {
    const onPledge = vi
      .fn()
      .mockRejectedValue(codedError('INVALID_AMOUNT_PRECISION', 'Amount must use no more than 2 decimal places.'));
    const { user } = renderPledge({ onPledge });
    await user.click(submit());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Amount must use no more than 2 decimal places.');
    await user.click(within(alert).getByRole('button', { name: 'Edit amount' }));
    expect(amount()).toHaveFocus();
  });

  it('shows no retry for a misconfiguration', async () => {
    const onPledge = vi.fn().mockRejectedValue(codedError('CONFIG_MISSING'));
    const { user } = renderPledge({ onPledge });
    await user.click(submit());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not configured correctly/i);
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
  });

  it('warns against double pledging after a confirmation timeout', async () => {
    const onPledge = vi.fn().mockRejectedValue(codedError('TRANSACTION_TIMEOUT'));
    const { user } = renderPledge({ onPledge });
    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(/check your wallet activity before retrying/i);
  });

  it('scopes an error to its campaign when another campaign is selected', async () => {
    const onPledge = vi.fn().mockRejectedValue(codedError('PLEDGE_SYNC_FAILED'));
    const onRetryPledgeSync = vi.fn().mockResolvedValue(undefined);
    const { user, update } = renderPledge({ onPledge, onRetryPledgeSync });
    await user.click(submit());
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    update({ campaign: { ...campaign, id: 'other-campaign' }, onPledge, onRetryPledgeSync });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(form()).not.toHaveAttribute('aria-describedby');

    update({ campaign, onPledge, onRetryPledgeSync });
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry sync' }));
    expect(onRetryPledgeSync).toHaveBeenCalledWith(campaign.id);
  });
});
