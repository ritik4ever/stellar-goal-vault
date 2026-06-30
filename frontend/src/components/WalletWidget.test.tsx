import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WalletWidget } from './WalletWidget';

const PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA';

function noop() {}

describe('WalletWidget', () => {
  it('shows detecting state while checking', () => {
    render(
      <WalletWidget status="checking" publicKey={null} error={null} network={null} onConnect={noop} onDisconnect={noop} />,
    );
    expect(screen.getByText(/Detecting wallet/i)).toBeTruthy();
  });

  it('shows install link when freighter is unavailable', () => {
    render(
      <WalletWidget status="unavailable" publicKey={null} error={null} network={null} onConnect={noop} onDisconnect={noop} />,
    );
    expect(screen.getByText(/Install Freighter/i)).toBeTruthy();
  });

  it('shows connect button when available and not connected', () => {
    render(
      <WalletWidget status="available" publicKey={null} error={null} network={null} onConnect={noop} onDisconnect={noop} />,
    );
    expect(screen.getByRole('button', { name: /Connect Freighter/i })).toBeTruthy();
  });

  it('calls onConnect when connect button is clicked', () => {
    const onConnect = vi.fn();
    render(
      <WalletWidget status="available" publicKey={null} error={null} network={null} onConnect={onConnect} onDisconnect={noop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Connect Freighter/i }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('renders connected pill with truncated address and network badge', () => {
    render(
      <WalletWidget status="connected" publicKey={PUBLIC_KEY} error={null} network="Testnet" onConnect={noop} onDisconnect={noop} />,
    );
    expect(screen.getByText('GBBD…LFLA')).toBeTruthy();
    expect(screen.getByText('Testnet')).toBeTruthy();
  });

  it('renders mainnet badge with mainnet passphrase', () => {
    render(
      <WalletWidget status="connected" publicKey={PUBLIC_KEY} error={null} network="Mainnet" onConnect={noop} onDisconnect={noop} />,
    );
    const badge = screen.getByText('Mainnet');
    expect(badge.className).toContain('wallet-widget__network-badge--mainnet');
  });

  it('renders disconnect button that is keyboard accessible', () => {
    render(
      <WalletWidget status="connected" publicKey={PUBLIC_KEY} error={null} network="Testnet" onConnect={noop} onDisconnect={noop} />,
    );
    const btn = screen.getByRole('button', { name: /Disconnect wallet/i });
    expect(btn).toBeTruthy();
  });

  it('calls onDisconnect when disconnect button is clicked', () => {
    const onDisconnect = vi.fn();
    render(
      <WalletWidget status="connected" publicKey={PUBLIC_KEY} error={null} network="Testnet" onConnect={noop} onDisconnect={onDisconnect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Disconnect wallet/i }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('shows error message alongside connect button', () => {
    render(
      <WalletWidget status="available" publicKey={null} error="Wallet error occurred" network={null} onConnect={noop} onDisconnect={noop} />,
    );
    expect(screen.getByText(/Wallet error occurred/i)).toBeTruthy();
  });
});
