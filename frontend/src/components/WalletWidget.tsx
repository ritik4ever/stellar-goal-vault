import { Wallet } from "lucide-react";
import { FreighterStatus } from "../hooks/useFreighter";
import { CopyButton } from "./CopyButton";

interface WalletWidgetProps {
  status: FreighterStatus;
  publicKey: string | null;
  error: string | null;
  onConnect: () => void;
}

export function WalletWidget({ status, publicKey, error, onConnect }: WalletWidgetProps) {
  if (status === "checking") {
    return <div className="wallet-widget wallet-widget--checking">Detecting wallet…</div>;
  }

  if (status === "unavailable") {
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

  if (status === "connected" && publicKey) {
    return (
      <div className="wallet-widget wallet-widget--connected">
        <span className="wallet-widget__dot" aria-hidden="true" />
        <span className="mono">{publicKey.slice(0, 8)}…{publicKey.slice(-4)}</span>
        <CopyButton value={publicKey} ariaLabel="Copy wallet address" />
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
