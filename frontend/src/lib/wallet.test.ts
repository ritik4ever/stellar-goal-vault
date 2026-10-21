import { beforeEach, describe, expect, it, vi } from 'vitest';

const freighterMocks = vi.hoisted(() => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

const lobstrMocks = vi.hoisted(() => ({
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}));

const xbullMocks = vi.hoisted(() => {
  const connectFn = vi.fn();
  const signFn = vi.fn();
  class MockXbull {
    connect = connectFn;
    sign = signFn;
  }
  return {
    connectFn,
    signFn,
    xBullWalletConnect: MockXbull,
  };
});

vi.mock('@stellar/freighter-api', () => freighterMocks);
vi.mock('@lobstrco/signer-extension-api', () => lobstrMocks);
vi.mock('@creit.tech/xbull-wallet-connect', () => ({
  xBullWalletConnect: xbullMocks.xBullWalletConnect,
}));

import {
  detectWallets,
  getAdapter,
  getLastUsedWallet,
  setLastUsedWallet,
  clearLastUsedWallet,
} from './wallet';

describe('wallet adapter boundary tests', () => {
  const TESTNET = 'Test SDF Network ; September 2015';
  const MAINNET = 'Public Global Stellar Network ; September 2015';
  const MOCK_PUBKEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete (window as any).rabet;
    delete (window as any).xBullSDK;
    delete (window as any).lobstrSignerExtensionApi;
  });

  describe('connect path', () => {
    it('connects freighter successfully when detected and on matching network', async () => {
      freighterMocks.isConnected.mockResolvedValue(true);
      freighterMocks.requestAccess.mockResolvedValue(MOCK_PUBKEY);
      freighterMocks.getNetworkDetails.mockResolvedValue({
        networkPassphrase: TESTNET,
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      });

      const adapter = getAdapter('freighter');
      const conn = await adapter.connect(TESTNET);

      expect(conn.publicKey).toBe(MOCK_PUBKEY);
      expect(conn.networkPassphrase).toBe(TESTNET);
      expect(conn.sorobanRpcUrl).toBe('https://soroban-testnet.stellar.org');
    });

    it('connects rabet successfully when window.rabet is available', async () => {
      (window as any).rabet = {
        connect: vi.fn().mockResolvedValue({ publicKey: MOCK_PUBKEY }),
      };

      const adapter = getAdapter('rabet');
      const conn = await adapter.connect(TESTNET);

      expect(conn.publicKey).toBe(MOCK_PUBKEY);
      expect(conn.networkPassphrase).toBe(TESTNET);
    });

    it('connects xbull successfully via bridge', async () => {
      xbullMocks.connectFn.mockResolvedValue(MOCK_PUBKEY);

      const adapter = getAdapter('xbull');
      const conn = await adapter.connect(TESTNET);

      expect(conn.publicKey).toBe(MOCK_PUBKEY);
      expect(conn.networkPassphrase).toBe(TESTNET);
    });

    it('connects lobstr successfully via extension API', async () => {
      lobstrMocks.getPublicKey.mockResolvedValue(MOCK_PUBKEY);

      const adapter = getAdapter('lobstr');
      const conn = await adapter.connect(TESTNET);

      expect(conn.publicKey).toBe(MOCK_PUBKEY);
      expect(conn.networkPassphrase).toBe(TESTNET);
    });
  });

  describe('reject path', () => {
    it('fails when freighter is not installed/detected', async () => {
      freighterMocks.isConnected.mockResolvedValue(false);

      const adapter = getAdapter('freighter');
      await expect(adapter.connect(TESTNET)).rejects.toThrow(
        /freighter was not detected/i,
      );
    });

    it('handles freighter access rejection from user', async () => {
      freighterMocks.isConnected.mockResolvedValue(true);
      freighterMocks.requestAccess.mockRejectedValue(new Error('User declined'));

      const adapter = getAdapter('freighter');
      await expect(adapter.connect(TESTNET)).rejects.toThrow(/user declined/i);
    });

    it('handles rabet access rejection', async () => {
      (window as any).rabet = {
        connect: vi.fn().mockResolvedValue({ error: 'User rejected connection' }),
      };

      const adapter = getAdapter('rabet');
      await expect(adapter.connect(TESTNET)).rejects.toThrow(/user rejected connection/i);
    });

    it('handles xbull access rejection', async () => {
      xbullMocks.connectFn.mockRejectedValue(new Error('Popup closed by user'));

      const adapter = getAdapter('xbull');
      await expect(adapter.connect(TESTNET)).rejects.toThrow(/popup closed by user/i);
    });

    it('handles lobstr access rejection or missing key', async () => {
      lobstrMocks.getPublicKey.mockResolvedValue(null);

      const adapter = getAdapter('lobstr');
      await expect(adapter.connect(TESTNET)).rejects.toThrow(/not connected or installed/i);
    });
  });

  describe('sign path', () => {
    it('signs transaction with freighter adapter', async () => {
      freighterMocks.signTransaction.mockResolvedValue('signed-xdr-freighter');

      const adapter = getAdapter('freighter');
      const res = await adapter.sign('unsigned-xdr', TESTNET, MOCK_PUBKEY);

      expect(res).toBe('signed-xdr-freighter');
      expect(freighterMocks.signTransaction).toHaveBeenCalledWith('unsigned-xdr', {
        accountToSign: MOCK_PUBKEY,
        networkPassphrase: TESTNET,
      });
    });

    it('signs transaction with rabet adapter', async () => {
      (window as any).rabet = {
        sign: vi.fn().mockResolvedValue({ xdr: 'signed-xdr-rabet' }),
      };

      const adapter = getAdapter('rabet');
      const res = await adapter.sign('unsigned-xdr', TESTNET, MOCK_PUBKEY);

      expect(res).toBe('signed-xdr-rabet');
    });

    it('handles rabet signing rejection', async () => {
      (window as any).rabet = {
        sign: vi.fn().mockResolvedValue({ error: 'Signing rejected' }),
      };

      const adapter = getAdapter('rabet');
      await expect(adapter.sign('unsigned-xdr', TESTNET, MOCK_PUBKEY)).rejects.toThrow(
        /signing rejected/i,
      );
    });

    it('signs transaction with xbull adapter', async () => {
      xbullMocks.signFn.mockResolvedValue('signed-xdr-xbull');

      const adapter = getAdapter('xbull');
      const res = await adapter.sign('unsigned-xdr', TESTNET, MOCK_PUBKEY);

      expect(res).toBe('signed-xdr-xbull');
    });

    it('signs transaction with lobstr adapter', async () => {
      lobstrMocks.signTransaction.mockResolvedValue('signed-xdr-lobstr');

      const adapter = getAdapter('lobstr');
      const res = await adapter.sign('unsigned-xdr', TESTNET, MOCK_PUBKEY);

      expect(res).toBe('signed-xdr-lobstr');
    });
  });

  describe('network-mismatch path', () => {
    it('blocks connection when freighter network does not match expected network', async () => {
      freighterMocks.isConnected.mockResolvedValue(true);
      freighterMocks.requestAccess.mockResolvedValue(MOCK_PUBKEY);
      freighterMocks.getNetworkDetails.mockResolvedValue({
        networkPassphrase: MAINNET,
      });

      const adapter = getAdapter('freighter');
      await expect(adapter.connect(TESTNET)).rejects.toThrow(
        /Freighter is connected to Stellar Mainnet, but this app expects Stellar Testnet\./,
      );
    });
  });

  describe('wallet detection and persistence', () => {
    it('detects available wallets accurately', async () => {
      freighterMocks.isConnected.mockResolvedValue(true);
      (window as any).rabet = {};

      const detected = await detectWallets();
      const freighter = detected.find((w) => w.id === 'freighter');
      const rabet = detected.find((w) => w.id === 'rabet');
      const xbull = detected.find((w) => w.id === 'xbull');

      expect(freighter?.detected).toBe(true);
      expect(rabet?.detected).toBe(true);
      expect(xbull?.detected).toBe(false);
    });

    it('persists and retrieves last used wallet', () => {
      expect(getLastUsedWallet()).toBeNull();
      setLastUsedWallet('freighter');
      expect(getLastUsedWallet()).toBe('freighter');
      clearLastUsedWallet();
      expect(getLastUsedWallet()).toBeNull();
    });
  });
});
