import { useState, useEffect, useRef } from 'react';
import { X, Wallet as WalletIcon, ExternalLink } from 'lucide-react';
import { WalletInfo, WalletType, detectWallets, WALLET_INFO } from '../lib/wallet';

interface WalletPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWallet: (walletType: WalletType) => void;
  isConnecting?: boolean;
  connectingWallet?: WalletType | null;
}

export function WalletPickerModal({
  isOpen,
  onClose,
  onSelectWallet,
  isConnecting = false,
  connectingWallet = null,
}: WalletPickerModalProps) {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      detectWallets()
        .then((detectedWallets) => {
          setWallets(detectedWallets);
          setIsLoading(false);
        })
        .catch(() => {
          setWallets(Object.values(WALLET_INFO).map((w) => ({ ...w, detected: false })));
          setIsLoading(false);
        });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal wallet-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="wallet-picker-title">Connect Wallet</h2>
          <button
            ref={closeButtonRef}
            className="btn-ghost modal-close"
            onClick={onClose}
            aria-label="Close wallet picker"
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="wallet-picker-loading" role="status" aria-live="polite">
              <p className="muted">Detecting wallets...</p>
            </div>
          ) : (
            <div className="wallet-list" role="list" aria-label="Available wallets">
              {wallets.map((wallet) => {
                const isConnectingThis = connectingWallet === wallet.id;

                return (
                  <button
                    key={wallet.id}
                    className={`wallet-option ${wallet.detected ? 'wallet-option--available' : 'wallet-option--unavailable'}`}
                    onClick={() => wallet.detected && !isConnecting && onSelectWallet(wallet.id)}
                    disabled={!wallet.detected || isConnecting}
                    role="listitem"
                    aria-label={
                      wallet.detected
                        ? isConnectingThis
                          ? `${wallet.name}, connecting`
                          : `Connect ${wallet.name}`
                        : `${wallet.name}, not installed`
                    }
                    aria-busy={isConnectingThis || undefined}
                  >
                    <div className="wallet-option-icon">
                      <span className="wallet-emoji">{wallet.icon}</span>
                    </div>
                    <div className="wallet-option-info">
                      <span className="wallet-option-name">{wallet.name}</span>
                      {!wallet.detected && (
                        <span className="wallet-option-status">Not installed</span>
                      )}
                    </div>
                    {wallet.detected ? (
                      isConnectingThis ? (
                        <span className="wallet-option-connecting">Connecting...</span>
                      ) : (
                        <span className="wallet-option-action">Connect</span>
                      )
                    ) : (
                      <a
                        href={wallet.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="wallet-option-install"
                        aria-label={`Install ${wallet.name} (opens in new tab)`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={16} />
                        Install
                      </a>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <p className="muted text-sm" id="wallet-picker-terms">
            By connecting a wallet, you agree to the terms of service.
          </p>
        </div>
      </div>
    </div>
  );
}

export default WalletPickerModal;
