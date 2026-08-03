import {
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';
import { xBullWalletConnect } from '@creit.tech/xbull-wallet-connect';
import { getPublicKey as lobstrGetPublicKey, signTransaction as lobstrSignTransaction } from '@lobstrco/signer-extension-api';
import { WalletConnection } from '../types/campaign';

export type WalletType = 'freighter' | 'rabet' | 'xbull' | 'lobstr';

export interface WalletInfo {
  id: WalletType;
  name: string;
  icon: string;
  installUrl: string;
  detected: boolean;
}

export interface WalletAdapter {
  connect: (expectedNetworkPassphrase: string) => Promise<WalletConnection>;
  sign: (xdr: string, networkPassphrase: string, publicKey: string) => Promise<string>;
  disconnect: () => Promise<void> | void;
}

const WALLET_INFO: Record<WalletType, Omit<WalletInfo, 'detected'>> = {
  freighter: {
    id: 'freighter',
    name: 'Freighter',
    icon: '🚢',
    installUrl: 'https://www.freighter.app/',
  },
  rabet: {
    id: 'rabet',
    name: 'Rabet',
    icon: '🦊',
    installUrl: 'https://rabet.io/',
  },
  xbull: {
    id: 'xbull',
    name: 'xBull',
    icon: '🐂',
    installUrl: 'https://xbull.io/',
  },
  lobstr: {
    id: 'lobstr',
    name: 'LOBSTR',
    icon: '🦞',
    installUrl: 'https://lobstr.co/',
  },
};

const LAST_WALLET_KEY = 'stellar-goal-vault:last-wallet';

function getLastUsedWallet(): WalletType | null {
  try {
    const stored = localStorage.getItem(LAST_WALLET_KEY);
    if (stored && stored in WALLET_INFO) {
      return stored as WalletType;
    }
  } catch {
    // Ignore localStorage errors
  }
  return null;
}

function setLastUsedWallet(walletType: WalletType): void {
  try {
    localStorage.setItem(LAST_WALLET_KEY, walletType);
  } catch {
    // Ignore localStorage errors
  }
}

function clearLastUsedWallet(): void {
  try {
    localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    // Ignore localStorage errors
  }
}

// Freighter Adapter
class FreighterAdapter implements WalletAdapter {
  async connect(expectedNetworkPassphrase: string): Promise<WalletConnection> {
    const connected = await isConnected();
    if (!connected) {
      throw new Error('Freighter was not detected. Install or unlock the extension and try again.');
    }

    let publicKey: string;
    try {
      publicKey = await requestAccess();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Freighter access was rejected.');
    }

    let details:
      | {
          networkPassphrase: string;
          sorobanRpcUrl?: string;
        }
      | undefined;

    try {
      const networkDetails = await getNetworkDetails();
      details = {
        networkPassphrase: networkDetails.networkPassphrase,
        sorobanRpcUrl: networkDetails.sorobanRpcUrl,
      };
    } catch {
      details = undefined;
    }

    if (details?.networkPassphrase && details.networkPassphrase !== expectedNetworkPassphrase) {
      const networkLabel = details.networkPassphrase === 'Test SDF Network ; September 2015'
        ? 'Stellar Testnet'
        : details.networkPassphrase === 'Public Global Stellar Network ; September 2015'
        ? 'Stellar Mainnet'
        : 'the configured network';
      
      const expectedLabel = expectedNetworkPassphrase === 'Test SDF Network ; September 2015'
        ? 'Stellar Testnet'
        : expectedNetworkPassphrase === 'Public Global Stellar Network ; September 2015'
        ? 'Stellar Mainnet'
        : 'the configured network';

      throw new Error(`Freighter is connected to ${networkLabel}, but this app expects ${expectedLabel}.`);
    }

    return {
      publicKey,
      networkPassphrase: details?.networkPassphrase,
      sorobanRpcUrl: details?.sorobanRpcUrl,
    };
  }

  async sign(xdr: string, networkPassphrase: string, publicKey: string): Promise<string> {
    return await signTransaction(xdr, {
      accountToSign: publicKey,
      networkPassphrase,
    });
  }

  async disconnect(): Promise<void> {
    // Freighter doesn't have a disconnect method, just clear local state
  }
}

// Rabet Adapter
class RabetAdapter implements WalletAdapter {
  async connect(expectedNetworkPassphrase: string): Promise<WalletConnection> {
    const rabet = (window as any).rabet;
    if (!rabet) {
      throw new Error('Rabet was not detected. Install the extension and try again.');
    }

    try {
      const result = await rabet.connect();
      if (result.error) {
        throw new Error(result.error);
      }

      // Rabet doesn't provide network details, we'll need to trust the user
      return {
        publicKey: result.publicKey,
        networkPassphrase: expectedNetworkPassphrase,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Rabet access was rejected.');
    }
  }

  async sign(xdr: string, networkPassphrase: string, publicKey: string): Promise<string> {
    const rabet = (window as any).rabet;
    if (!rabet) {
      throw new Error('Rabet was not detected.');
    }

    try {
      const result = await rabet.sign(xdr, networkPassphrase);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.xdr;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Rabet signing failed.');
    }
  }

  async disconnect(): Promise<void> {
    const rabet = (window as any).rabet;
    if (rabet && typeof rabet.disconnect === 'function') {
      await rabet.disconnect();
    }
  }
}

// xBull Adapter
class XbullAdapter implements WalletAdapter {
  private bridge: xBullWalletConnect | null = null;

  private getBridge(): xBullWalletConnect {
    if (!this.bridge) {
      this.bridge = new xBullWalletConnect();
    }
    return this.bridge;
  }

  async connect(expectedNetworkPassphrase: string): Promise<WalletConnection> {
    try {
      const bridge = this.getBridge();
      const publicKey = await bridge.connect();
      
      return {
        publicKey,
        networkPassphrase: expectedNetworkPassphrase,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'xBull access was rejected.');
    }
  }

  async sign(xdr: string, networkPassphrase: string, publicKey: string): Promise<string> {
    try {
      const bridge = this.getBridge();
      return await bridge.sign({ xdr, publicKey, network: networkPassphrase });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'xBull signing failed.');
    }
  }

  async disconnect(): Promise<void> {
    // xBull doesn't have a disconnect method, just clear local state
    this.bridge = null;
  }
}

// LOBSTR Adapter
class LobstrAdapter implements WalletAdapter {
  async connect(expectedNetworkPassphrase: string): Promise<WalletConnection> {
    try {
      const publicKey = await lobstrGetPublicKey();
      if (!publicKey) {
        throw new Error('LOBSTR wallet is not connected or installed.');
      }

      return {
        publicKey,
        networkPassphrase: expectedNetworkPassphrase,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'LOBSTR access was rejected.');
    }
  }

  async sign(xdr: string, networkPassphrase: string, publicKey: string): Promise<string> {
    try {
      return await lobstrSignTransaction(xdr);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'LOBSTR signing failed.');
    }
  }

  async disconnect(): Promise<void> {
    // LOBSTR doesn't have a disconnect method, just clear local state
  }
}

// Wallet detection
async function detectWallets(): Promise<WalletInfo[]> {
  const results: WalletInfo[] = [];

  // Detect Freighter
  try {
    const freighterDetected = await isConnected();
    results.push({
      ...WALLET_INFO.freighter,
      detected: freighterDetected,
    });
  } catch {
    results.push({
      ...WALLET_INFO.freighter,
      detected: false,
    });
  }

  // Detect Rabet
  const rabetDetected = typeof (window as any).rabet !== 'undefined';
  results.push({
    ...WALLET_INFO.rabet,
    detected: rabetDetected,
  });

  // Detect xBull (check for window.xBullSDK or extension detection)
  const xbullDetected = typeof (window as any).xBullSDK !== 'undefined' || 
                       typeof (window as any).xBullWalletConnect !== 'undefined';
  results.push({
    ...WALLET_INFO.xbull,
    detected: xbullDetected,
  });

  // Detect LOBSTR
  try {
    const lobstrDetected = await (window as any).lobstrSignerExtensionApi?.isConnected?.() || false;
    results.push({
      ...WALLET_INFO.lobstr,
      detected: lobstrDetected,
    });
  } catch {
    results.push({
      ...WALLET_INFO.lobstr,
      detected: false,
    });
  }

  return results;
}

// Get adapter for wallet type
function getAdapter(walletType: WalletType): WalletAdapter {
  switch (walletType) {
    case 'freighter':
      return new FreighterAdapter();
    case 'rabet':
      return new RabetAdapter();
    case 'xbull':
      return new XbullAdapter();
    case 'lobstr':
      return new LobstrAdapter();
    default:
      throw new Error(`Unknown wallet type: ${walletType}`);
  }
}

export {
  WALLET_INFO,
  getLastUsedWallet,
  setLastUsedWallet,
  clearLastUsedWallet,
  detectWallets,
  getAdapter,
};
