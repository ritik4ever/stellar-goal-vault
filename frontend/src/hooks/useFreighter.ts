import { useCallback, useEffect, useState } from "react";
import { isConnected } from "@stellar/freighter-api";
import { connectFreighterWallet } from "../services/freighter";

export type FreighterStatus = "checking" | "unavailable" | "available" | "connected";

export interface UseFreighterResult {
  status: FreighterStatus;
  publicKey: string | null;
  connect: (networkPassphrase: string) => Promise<string | null>;
  disconnect: () => void;
  error: string | null;
}

export function useFreighter(): UseFreighterResult {
  const [status, setStatus] = useState<FreighterStatus>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isConnected()
      .then((connected) => {
        setStatus(connected ? "available" : "unavailable");
      })
      .catch(() => {
        setStatus("unavailable");
      });
  }, []);

  const connect = useCallback(async (networkPassphrase: string): Promise<string | null> => {
    setError(null);
    try {
      const wallet = await connectFreighterWallet(networkPassphrase);
      setPublicKey(wallet.publicKey);
      setStatus("connected");
      return wallet.publicKey;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet.";
      setError(message);
      return null;
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setStatus("available");
  }, []);

  return { status, publicKey, connect, disconnect, error };
}
