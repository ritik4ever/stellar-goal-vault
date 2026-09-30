import { Wallet, ChevronDown } from 'lucide-react';
import { WalletStatus, WalletType } from '../hooks/useWallet';
import { CopyButton } from './CopyButton';

interface WalletWidgetProps {
  status: WalletStatus;
  publicKey: string | null;
  walletName: string | null;
  error: string | null;
  network: string | null;
  onConnect: (walletType?: WalletType) => void;
  onDisconnect: () => void;
  onSwitchWallet: () => void;
}

function truncateAddress(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function WalletWidget({
  status,
  publicKey,
  walletName,
  error,
  network,
  onConnect,
  onDisconnect,
  onSwitchWallet,
}: WalletWidgetProps) {
  if (status === 'checking') {
    return (
      <div
        className="wallet-widget wallet-widget--checking"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Detecting wallet…
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div
        className="wallet-widget wallet-widget--checking"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Connecting wallet…
      </div>
    );
  }

  if (status === 'connected' && publicKey) {
    const isMainnet = network?.toLowerCase() === 'mainnet';
    const displayWalletName = walletName || 'Wallet';
    return (
      <div
        className="wallet-widget wallet-widget--connected wallet-widget--pill"
        role="group"
        aria-label={`Wallet status: connected to ${displayWalletName}${network ? ` on ${network}` : ''}`}
      >
        <div className="wallet-widget__info">
          <span className="wallet-widget__dot" aria-hidden="true" />
          <span className="wallet-widget__wallet-name">{displayWalletName}</span>
          <span className="mono wallet-widget__address" title={publicKey}>
            <span className="sr-only">Wallet address: </span>
            {truncateAddress(publicKey)}
          </span>
          {network && (
            <span
              className={`wallet-widget__network-badge${isMainnet ? ' wallet-widget__network-badge--mainnet' : ''}`}
            >
              <span className="sr-only">Network: </span>
              {network}
            </span>
          )}
          <CopyButton value={publicKey} ariaLabel="Copy wallet address" />
        </div>
        <div className="wallet-widget__actions">
          <button
            className="wallet-widget__switch btn-ghost"
            type="button"
            onClick={onSwitchWallet}
            aria-label="Switch wallet"
            title="Switch wallet"
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <button
            className="wallet-widget__disconnect btn-ghost"
            type="button"
            onClick={onDisconnect}
            aria-label="Disconnect wallet"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-widget">
      {error ? (
        <span className="wallet-widget__error" role="alert">
          {error}
        </span>
      ) : null}
      <button
        className="btn-ghost wallet-widget__btn"
        type="button"
        onClick={() => onConnect()}
        aria-label="Connect Freighter wallet"
      >
        <Wallet size={16} aria-hidden="true" />
        Connect Wallet
      </button>
    </div>
  );
}
