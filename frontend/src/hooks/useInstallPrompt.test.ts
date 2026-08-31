import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useInstallPrompt } from './useInstallPrompt';

describe('useInstallPrompt', () => {
  beforeEach(() => {
    // Default: not standalone
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts as not installable and not installed', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstallable).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it('becomes installable when beforeinstallprompt fires', () => {
    const { result } = renderHook(() => useInstallPrompt());

    const fakePrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      platforms: ['web'],
    } as unknown as Event;

    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), fakePrompt));
    });

    expect(result.current.isInstallable).toBe(true);
  });

  it('marks as installed on appinstalled event', () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it('promptInstall does nothing when no deferred prompt', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    // Should not throw
    await act(async () => {
      await result.current.promptInstall();
    });
    expect(result.current.isInstalled).toBe(false);
  });

  it('marks as installed after accepting the install prompt', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    const fakePrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      platforms: ['web'],
    };

    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), fakePrompt));
    });

    expect(result.current.isInstallable).toBe(true);

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it('stays not installed when user dismisses the install prompt', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    const fakePrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      platforms: ['web'],
    };

    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), fakePrompt));
    });

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.isInstalled).toBe(false);
    // prompt is consumed regardless
    expect(result.current.isInstallable).toBe(false);
  });
});
