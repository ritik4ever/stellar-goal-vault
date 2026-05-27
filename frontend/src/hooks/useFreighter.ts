import { useCallback, useEffect, useRef, useState } from "react";
import { isConnected, getNetworkDetails } from "@stellar/freighter-api";
import { connectFreighterWallet } from "../services/freighter";

export type FreighterStatus = "checking" | "unavailable" | "available" | "connected";

export interface UseFreighterResult {
  status: FreighterStatus;
  publicKey: string | null;
  connect: (networkPassphrase: string) => Promise<string | null>;
  disconnect: () => void;
  error: string | null;
  networkMismatch: { expected: string; actual: string; message: string } | null;
}

export function useFreighter(): UseFreighterResult {
  const [status, setStatus] = useState<FreighterStatus>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkMismatch, setNetworkMismatch] = useState<
    { expected: string; actual: string; message: string } | null
  >(null);

  useEffect(() => {
    isConnected()
      .then((connected) => {
        setStatus(connected ? "available" : "unavailable");
      })
      .catch(() => {
        setStatus("unavailable");
      });
  }, []);

  function networkLabel(passphrase: string | undefined): string {
    if (!passphrase) {
      return "the app network";
    }
    if (passphrase.includes("Testnet") || passphrase === "Test SDF Network ; September 2015") {
      return "Testnet";
    }
    if (passphrase.includes("Mainnet") || passphrase === "Public Global Stellar Network ; September 2015") {
      return "Mainnet";
    }
    return "the configured network";
  }

  function buildMismatchMessage(expected: string, actual: string): string {
    return `Your wallet is on ${networkLabel(actual)} but this app uses ${networkLabel(expected)}`;
  }

  const connect = useCallback(async (networkPassphrase: string): Promise<string | null> => {
    setError(null);
    setNetworkMismatch(null);
    try {
      const wallet = await connectFreighterWallet(networkPassphrase);
      setPublicKey(wallet.publicKey);
      setStatus("connected");
      // If wallet returned a networkPassphrase, verify match (defensive)
      if (wallet.networkPassphrase && wallet.networkPassphrase !== networkPassphrase) {
        setNetworkMismatch({
          expected: networkPassphrase,
          actual: wallet.networkPassphrase,
          message: buildMismatchMessage(networkPassphrase, wallet.networkPassphrase),
        });
      }
      // start polling network while connected to detect switches
      startNetworkPoll(networkPassphrase);
      return wallet.publicKey;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet.";
      if (err && typeof err === "object" && "code" in err && (err as any).code === "FREIGHTER_NETWORK_MISMATCH") {
        const mismatchMatch = /connected to (.+),? but this app expects (.+)\.?/i.exec(message);
        const actualPassphrase = mismatchMatch?.[1] ?? "unknown";
        setNetworkMismatch({
          expected: networkPassphrase,
          actual: actualPassphrase,
          message: buildMismatchMessage(networkPassphrase, actualPassphrase),
        });
        startNetworkPoll(networkPassphrase);
        return null;
      }
      setError(message);
      return null;
    }
  }, []);

  // Poll Freighter network details while connected to detect network switches
  const pollIdRef = useRef<number | null>(null);
  function startNetworkPoll(expectedNetwork: string) {
    stopNetworkPoll();
    pollIdRef.current = window.setInterval(async () => {
      try {
        const details = await getNetworkDetails();
        if (details?.networkPassphrase && details.networkPassphrase !== expectedNetwork) {
          setNetworkMismatch({
            expected: expectedNetwork,
            actual: details.networkPassphrase,
            message: buildMismatchMessage(expectedNetwork, details.networkPassphrase),
          });
        } else {
          setNetworkMismatch(null);
        }
      } catch {
        // ignore
      }
    }, 2000);
  }

  function stopNetworkPoll() {
    if (pollIdRef.current !== null) {
      window.clearInterval(pollIdRef.current);
      pollIdRef.current = null;
    }
  }

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setStatus("available");
    setNetworkMismatch(null);
    stopNetworkPoll();
  }, []);

  return { status, publicKey, connect, disconnect, error, networkMismatch };
}
