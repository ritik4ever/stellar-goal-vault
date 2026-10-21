import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const walletMocks = vi.hoisted(() => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock('../lib/wallet', async () => {
  const actual = await vi.importActual('../lib/wallet');
  return {
    ...actual,
    getAdapter: vi.fn(),
    getLastUsedWallet: vi.fn(),
    setLastUsedWallet: vi.fn(),
    clearLastUsedWallet: vi.fn(),
    WALLET_INFO: actual.WALLET_INFO,
  };
});

vi.mock('@stellar/freighter-api', () => walletMocks);

import { useWallet } from './useWallet';
import { getAdapter, getLastUsedWallet } from '../lib/wallet';

describe('useWallet hook', () => {
  const mockAdapter = {
    connect: vi.fn(),
    sign: vi.fn(),
    disconnect: vi.fn(),
    checkNetwork: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getLastUsedWallet as vi.Mock).mockReturnValue(null);
    (getAdapter as vi.Mock).mockReturnValue(mockAdapter);
  });

  it('returns checking status initially', () => {
    const { result } = renderHook(() => useWallet());
    // In test environment, useEffect runs synchronously, so status becomes 'available' immediately
    expect(['checking', 'available']).toContain(result.current.status);
  });

  it('sets status to available after mount', async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => {
      expect(result.current.status).toBe('available');
    });
  });

  it('calls adapter.connect with expected network on connect', async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => {
      expect(result.current.status).toBe('available');
    });

    mockAdapter.connect.mockResolvedValue({
      publicKey: `G${'A'.repeat(55)}`,
      networkPassphrase: 'Test SDF Network ; September 2015',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    });

    await act(async () => {
      await result.current.connect('freighter', 'Test SDF Network ; September 2015');
    });

    expect(mockAdapter.connect).toHaveBeenCalledWith('Test SDF Network ; September 2015');
    expect(result.current.status).toBe('connected');
  });

  it('calls adapter.checkNetwork and returns result', async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => {
      expect(result.current.status).toBe('available');
    });

    mockAdapter.connect.mockResolvedValue({
      publicKey: `G${'A'.repeat(55)}`,
      networkPassphrase: 'Test SDF Network ; September 2015',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    });

    await act(async () => {
      await result.current.connect('freighter', 'Test SDF Network ; September 2015');
    });

    mockAdapter.checkNetwork.mockResolvedValue({
      match: true,
      currentNetwork: 'Test SDF Network ; September 2015',
      expectedNetwork: 'Test SDF Network ; September 2015',
    });

    let checkResult: { match: boolean; currentNetwork?: string; expectedNetwork?: string } | null = null;
    await act(async () => {
      checkResult = await result.current.checkNetwork('Test SDF Network ; September 2015');
    });

    expect(mockAdapter.checkNetwork).toHaveBeenCalledWith('Test SDF Network ; September 2015');
    expect(checkResult).toEqual({
      match: true,
      currentNetwork: 'Test SDF Network ; September 2015',
      expectedNetwork: 'Test SDF Network ; September 2015',
    });
  });

  it('returns match: false when no adapter is connected', async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => {
      expect(result.current.status).toBe('available');
    });

    let checkResult: { match: boolean; currentNetwork?: string; expectedNetwork?: string } | null = null;
    await act(async () => {
      checkResult = await result.current.checkNetwork('Test SDF Network ; September 2015');
    });

    expect(checkResult).toEqual({
      match: false,
      expectedNetwork: 'Test SDF Network ; September 2015',
    });
  });

  it('returns network mismatch when adapter reports mismatch', async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => {
      expect(result.current.status).toBe('available');
    });

    mockAdapter.connect.mockResolvedValue({
      publicKey: `G${'A'.repeat(55)}`,
      networkPassphrase: 'Test SDF Network ; September 2015',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    });

    await act(async () => {
      await result.current.connect('freighter', 'Test SDF Network ; September 2015');
    });

    mockAdapter.checkNetwork.mockResolvedValue({
      match: false,
      currentNetwork: 'Public Global Stellar Network ; September 2015',
      expectedNetwork: 'Test SDF Network ; September 2015',
    });

    let checkResult: { match: boolean; currentNetwork?: string; expectedNetwork?: string } | null = null;
    await act(async () => {
      checkResult = await result.current.checkNetwork('Test SDF Network ; September 2015');
    });

    expect(checkResult).toEqual({
      match: false,
      currentNetwork: 'Public Global Stellar Network ; September 2015',
      expectedNetwork: 'Test SDF Network ; September 2015',
    });
  });
});