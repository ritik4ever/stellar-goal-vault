import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wallet-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Wallet</h2>
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
            <div className="wallet-list">
              {wallets.map((wallet) => {
                const isConnectingThis = connectingWallet === wallet.id;
                
                return (
                  <button
                    key={wallet.id}
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
