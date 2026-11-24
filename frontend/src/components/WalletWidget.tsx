import { AlertCircle, RefreshCw, Wallet, ChevronDown } from 'lucide-react';
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
  // Loading states: explicit, distinguishable feedback while we detect or
  // establish the wallet connection. Never fall back to a blank screen.
  if (status === 'checking' || status === 'connecting') {
    return (
      <div
        className="wallet-widget wallet-widget--checking"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span
          className="wallet-widget__spinner"
          aria-hidden="true"
          data-testid="wallet-widget-spinner"
        />
        <span>{status === 'checking' ? 'Detecting wallet…' : 'Connecting wallet…'}</span>
      </div>
    );
  }

  // Success state: connected with an address.
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

  // Recoverable failure: surface the error and offer an explicit retry action.
  if (error) {
    return (
      <div className="wallet-widget wallet-widget--error">
        <div className="wallet-widget__error-banner" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span className="wallet-widget__error">{error}</span>
        </div>
        <button
          className="btn-ghost wallet-widget__btn wallet-widget__retry"
          type="button"
          onClick={() => onConnect()}
          aria-label="Retry wallet connection"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  // Unavailable: no wallet extension detected. Explain why and how to recover.
  if (status === 'unavailable') {
    return (
      <div
        className="wallet-widget wallet-widget--unavailable"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="wallet-widget__empty-text">No Stellar wallet extension detected.</span>
        <a
          className="wallet-widget__link"
          href="https://www.freighter.app/"
          target="_blank"
          rel="noreferrer"
        >
          Install Freighter
        </a>
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

  // Empty state: wallet available but not connected yet.
  if (status === 'available') {
    return (
      <div
        className="wallet-widget wallet-widget--empty"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="wallet-widget__empty-text">No wallet connected</span>
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

  // Fallback for any other combination (e.g. connected without a public key):
  // keep a usable action on screen so the panel never renders blank.
  return (
    <div className="wallet-widget">
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
