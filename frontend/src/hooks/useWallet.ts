import { useState, useCallback, useEffect } from 'react';
import { WalletType, WalletAdapter, getAdapter, getLastUsedWallet, setLastUsedWallet, clearLastUsedWallet, WALLET_INFO } from '../lib/wallet';
import { WalletConnection } from '../types/campaign';

export type WalletStatus = 'checking' | 'unavailable' | 'available' | 'connected' | 'connecting';
export type { WalletType };

export interface UseWalletResult {
  status: WalletStatus;
  publicKey: string | null;
  walletType: WalletType | null;
  walletName: string | null;
  networkPassphrase: string | null;
  sorobanRpcUrl: string | null;
  error: string | null;
  connect: (walletType: WalletType, expectedNetworkPassphrase: string) => Promise<void>;
  disconnect: () => void;
  openPicker: () => void;
  isPickerOpen: boolean;
  closePicker: () => void;
}

export function useWallet(): UseWalletResult {
  const [status, setStatus] = useState<WalletStatus>('checking');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null);
  const [sorobanRpcUrl, setSorobanRpcUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [adapter, setAdapter] = useState<WalletAdapter | null>(null);

  // Load last used wallet on mount
  useEffect(() => {
    const lastWallet = getLastUsedWallet();
    if (lastWallet) {
      setWalletType(lastWallet);
    }
    setStatus('available');
  }, []);

  const connect = useCallback(async (selectedWalletType: WalletType, expectedNetworkPassphrase: string) => {
    setError(null);
    setStatus('connecting');
    
    try {
      // Disconnect current wallet if different
      if (adapter && walletType && walletType !== selectedWalletType) {
        await adapter.disconnect();
      }

      const newAdapter = getAdapter(selectedWalletType);
      const connection: WalletConnection = await newAdapter.connect(expectedNetworkPassphrase);
      
      setPublicKey(connection.publicKey);
      setNetworkPassphrase(connection.networkPassphrase || expectedNetworkPassphrase);
      setSorobanRpcUrl(connection.sorobanRpcUrl || null);
      setWalletType(selectedWalletType);
      setAdapter(newAdapter);
      setLastUsedWallet(selectedWalletType);
      setStatus('connected');
      setIsPickerOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet.';
      setError(message);
      setStatus('available');
    }
  }, [adapter, walletType]);

  const disconnect = useCallback(() => {
    if (adapter) {
      const result = adapter.disconnect();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          // Ignore disconnect errors
        });
      }
    }
    
    setPublicKey(null);
    setNetworkPassphrase(null);
    setSorobanRpcUrl(null);
    setWalletType(null);
    setAdapter(null);
    setError(null);
    setStatus('available');
    clearLastUsedWallet();
  }, [adapter]);

  const openPicker = useCallback(() => {
    setIsPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
  }, []);

  const walletName = walletType ? WALLET_INFO[walletType].name : null;

  return {
    status,
    publicKey,
    walletType,
    walletName,
    networkPassphrase,
    sorobanRpcUrl,
    error,
    connect,
    disconnect,
    openPicker,
    isPickerOpen,
    closePicker,
  };
}
