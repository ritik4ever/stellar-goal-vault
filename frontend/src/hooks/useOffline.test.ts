import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOffline } from './useOffline';

describe('useOffline', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');

  function setOnLine(value: boolean) {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => value,
    });
  }

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    }
  });

  it('returns false when navigator.onLine is true', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOffline());
    expect(result.current).toBe(false);
  });

  it('returns true when navigator.onLine is false', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOffline());
    expect(result.current).toBe(true);
  });

  it('updates to true when the offline event fires', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOffline());
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current).toBe(true);
  });

  it('updates to false when the online event fires', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOffline());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toBe(false);
  });

  it('removes event listeners on unmount', () => {
    setOnLine(true);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useOffline());
    unmount();

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
