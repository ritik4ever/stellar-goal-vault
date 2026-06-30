import { Wallet } from 'lucide-react';
import { FreighterStatus } from '../hooks/useFreighter';
import { CopyButton } from './CopyButton';

interface WalletWidgetProps {
  status: FreighterStatus;
  publicKey: string | null;
  error: string | null;
  network: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

function truncateAddress(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function WalletWidget({ status, publicKey, error, network, onConnect, onDisconnect }: WalletWidgetProps) {
  if (status === 'checking') {
    return <div className="wallet-widget wallet-widget--checking">Detecting wallet…</div>;
  }

  if (status === 'unavailable') {
    return (
      <div className="wallet-widget wallet-widget--unavailable">
        <Wallet size={16} />
        <span>Freighter not found.</span>
        <a
          href="https://www.freighter.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="wallet-widget__link"
        >
          Install Freighter ↗
        </a>
      </div>
    );
  }

  if (status === 'connected' && publicKey) {
    const isMainnet = network?.toLowerCase() === 'mainnet';
    return (
      <div className="wallet-widget wallet-widget--connected wallet-widget--pill">
        <span className="wallet-widget__dot" aria-hidden="true" />
        <span className="mono wallet-widget__address" title={publicKey}>
          {truncateAddress(publicKey)}
        </span>
        {network && (
          <span
            className={`wallet-widget__network-badge${isMainnet ? ' wallet-widget__network-badge--mainnet' : ''}`}
          >
            {network}
          </span>
        )}
        <CopyButton value={publicKey} ariaLabel="Copy wallet address" />
        <button
          className="wallet-widget__disconnect btn-ghost"
          type="button"
          onClick={onDisconnect}
          aria-label="Disconnect wallet"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-widget">
      {error ? <span className="wallet-widget__error">{error}</span> : null}
      <button className="btn-ghost wallet-widget__btn" type="button" onClick={onConnect}>
        <Wallet size={16} />
        Connect Freighter
      </button>
    </div>
  );
}
