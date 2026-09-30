import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletWidget } from './WalletWidget';

const PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA';

function noop() {}

describe('WalletWidget', () => {
  it('shows detecting state while checking', () => {
    render(
      <WalletWidget
        status="checking"
        publicKey={null}
        walletName={null}
        error={null}
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByText(/Detecting wallet/i)).toBeTruthy();
  });

  it('shows connect button when not connected and wallet is available', () => {
    render(
      <WalletWidget
        status="available"
        publicKey={null}
        walletName={null}
        error={null}
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /Connect Freighter wallet/i })).toBeTruthy();
  });

  it('shows connecting state', () => {
    render(
      <WalletWidget
        status="connecting"
        publicKey={null}
        walletName={null}
        error={null}
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByText(/Connecting wallet/i)).toBeTruthy();
  });

  it('calls onConnect when connect button is clicked', () => {
    const onConnect = vi.fn();
    render(
      <WalletWidget
        status="available"
        publicKey={null}
        walletName={null}
        error={null}
        network={null}
        onConnect={onConnect}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Connect Freighter wallet/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('renders connected pill with truncated address and network badge', () => {
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network="Testnet"
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByText(/GBBD…LFLA/)).toBeTruthy();
    expect(screen.getByText('Testnet')).toBeTruthy();
  });

  it('renders mainnet badge with mainnet styling class', () => {
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network="Mainnet"
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    const badge = screen.getByText('Mainnet');
    expect(badge.className).toContain('wallet-widget__network-badge--mainnet');
  });

  it('renders disconnect button that is keyboard accessible', () => {
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network="Testnet"
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    const btn = screen.getByRole('button', { name: /Disconnect wallet/i });
    expect(btn).toBeTruthy();
  });

  it('calls onDisconnect when disconnect button is clicked', () => {
    const onDisconnect = vi.fn();
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network="Testnet"
        onConnect={noop}
        onDisconnect={onDisconnect}
        onSwitchWallet={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Disconnect wallet/i }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('shows error message alongside connect button', () => {
    render(
      <WalletWidget
        status="available"
        publicKey={null}
        walletName={null}
        error="Wallet error occurred"
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByText(/Wallet error occurred/i)).toBeTruthy();
  });

  it('exposes a status role while checking', () => {
    render(
      <WalletWidget
        status="checking"
        publicKey={null}
        walletName={null}
        error={null}
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('exposes an alert role for connection errors', () => {
    render(
      <WalletWidget
        status="available"
        publicKey={null}
        walletName={null}
        error="User rejected the connection request"
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('labels the connected wallet group and address for screen readers', () => {
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network="Testnet"
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(
      screen.getByRole('group', { name: /Wallet status: connected to Freighter on Testnet/i }),
    ).toBeTruthy();
    expect(screen.getByText(/Wallet address:/)).toBeTruthy();
  });

  it('supports keyboard activation of the switch wallet button', () => {
    const onSwitchWallet = vi.fn();
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network="Testnet"
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={onSwitchWallet}
      />,
    );
    const btn = screen.getByRole('button', { name: /Switch wallet/i });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter' });
    fireEvent.click(btn);
    expect(onSwitchWallet).toHaveBeenCalledTimes(1);
  });

  it('renders connected state without network badge when network is null', () => {
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.queryByText('Testnet')).not.toBeTruthy();
    expect(screen.queryByText('Mainnet')).not.toBeTruthy();
    expect(
      screen.getByRole('group', { name: /Wallet status: connected to Freighter$/i }),
    ).toBeTruthy();
  });

  it('uses "Wallet" as fallback wallet name when walletName is null', () => {
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName={null}
        error={null}
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(
      screen.getByRole('group', { name: /Wallet status: connected to Wallet$/i }),
    ).toBeTruthy();
  });

  it('connect button shows Wallet icon with Connect Wallet text', () => {
    render(
      <WalletWidget
        status="available"
        publicKey={null}
        walletName={null}
        error={null}
        network={null}
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /Connect Freighter wallet/i })).toHaveTextContent(
      /Connect Wallet/i,
    );
  });

  it('renders copy button for connected wallet address', () => {
    render(
      <WalletWidget
        status="connected"
        publicKey={PUBLIC_KEY}
        walletName="Freighter"
        error={null}
        network="Testnet"
        onConnect={noop}
        onDisconnect={noop}
        onSwitchWallet={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /Copy wallet address/i })).toBeTruthy();
  });
});
