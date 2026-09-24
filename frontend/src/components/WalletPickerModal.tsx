import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Wallet as WalletIcon, ExternalLink } from 'lucide-react';
import { WalletInfo, WalletType, detectWallets, WALLET_INFO } from '../lib/wallet';

interface WalletPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWallet: (walletType: WalletType) => void;
  isConnecting?: boolean;
  connectingWallet?: WalletType | null;
}

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function WalletPickerModal({
  isOpen,
  onClose,
  onSelectWallet,
  isConnecting = false,
  connectingWallet = null,
}: WalletPickerModalProps) {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';
      setIsLoading(true);
      detectWallets()
        .then((detectedWallets) => {
          setWallets(detectedWallets);
          setIsLoading(false);
        })
        .catch(() => {
          setWallets(Object.values(WALLET_INFO).map(w => ({ ...w, detected: false })));
          setIsLoading(false);
        });
    } else {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Focus trap and Escape handler
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal wallet-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h2 id="wallet-picker-title">Connect Wallet</h2>
          <button
            className="btn-ghost modal-close"
            onClick={onClose}
            aria-label="Close wallet picker"
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {isLoading ? (
            <div className="wallet-picker-loading">
              <p className="muted">Detecting wallets...</p>
            </div>
          ) : (
            <div className="wallet-list" role="listbox" aria-label="Available wallets">
              {wallets.map((wallet) => {
                const isConnectingThis = connectingWallet === wallet.id;
                
                return (
                  <button
                    key={wallet.id}
                    role="option"
                    aria-selected={isConnectingThis}
                    aria-disabled={!wallet.detected || isConnecting}
                    className={`wallet-option ${wallet.detected ? 'wallet-option--available' : 'wallet-option--unavailable'}`}
                    onClick={() => wallet.detected && !isConnecting && onSelectWallet(wallet.id)}
                    disabled={!wallet.detected || isConnecting}
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
                        <span className="wallet-option-connecting" aria-live="polite">Connecting...</span>
                      ) : (
                        <span className="wallet-option-action">Connect</span>
                      )
                    ) : (
                      <a
                        href={wallet.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="wallet-option-install"
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
          <p className="muted text-sm">
            By connecting a wallet, you agree to the terms of service.
          </p>
        </div>
      </div>
    </div>
  );
}

export default WalletPickerModal;
