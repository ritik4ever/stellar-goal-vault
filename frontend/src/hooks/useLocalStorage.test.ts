import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from './useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('get', () => {
    it('returns defaultValue when key is not set', () => {
      const { result } = renderHook(() => useLocalStorage('missing-key', 42));
      expect(result.current[0]).toBe(42);
    });

    it('returns stored value when key exists', () => {
      localStorage.setItem('sort-order', JSON.stringify('asc'));
      const { result } = renderHook(() => useLocalStorage('sort-order', 'desc'));
      expect(result.current[0]).toBe('asc');
    });

    it('handles stored objects', () => {
      const obj = { filters: ['open'], page: 1 };
      localStorage.setItem('filters', JSON.stringify(obj));
      const { result } = renderHook(() => useLocalStorage('filters', {}));
      expect(result.current[0]).toEqual(obj);
    });
  });

  describe('set', () => {
    it('updates state and persists to localStorage', () => {
      const { result } = renderHook(() => useLocalStorage('my-key', 'initial'));

      act(() => {
        result.current[1]('updated');
      });

      expect(result.current[0]).toBe('updated');
      expect(JSON.parse(localStorage.getItem('my-key')!)).toBe('updated');
    });

    it('supports functional updater form', () => {
      const { result } = renderHook(() => useLocalStorage('count', 0));

      act(() => {
        result.current[1]((prev) => prev + 1);
      });

      expect(result.current[0]).toBe(1);
    });

    it('persists boolean values', () => {
      const { result } = renderHook(() => useLocalStorage('dark-mode', false));

      act(() => {
        result.current[1](true);
      });

      expect(result.current[0]).toBe(true);
      expect(JSON.parse(localStorage.getItem('dark-mode')!)).toBe(true);
    });
  });

  describe('error recovery', () => {
    it('falls back to defaultValue when stored JSON is invalid', () => {
      localStorage.setItem('broken', 'not-valid-json{{{');
      const { result } = renderHook(() => useLocalStorage('broken', 'fallback'));
      expect(result.current[0]).toBe('fallback');
    });

    it('silently ignores localStorage write errors and keeps state', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      const { result } = renderHook(() => useLocalStorage('quota-key', 'default'));

      act(() => {
        result.current[1]('new-value');
      });

      // In-memory state still updates even when write fails
      expect(result.current[0]).toBe('new-value');
    });
  });

  describe('theme persistence with system preference fallback', () => {
    const THEME_KEY = 'stellar-goal-vault-theme';

    it('reads stored theme from localStorage', () => {
      localStorage.setItem(THEME_KEY, JSON.stringify('dark'));
      const { result } = renderHook(() => useLocalStorage<string>(THEME_KEY, 'light'));
      expect(result.current[0]).toBe('dark');
    });

    it('falls back to system preference when localStorage is empty', () => {
      // Simulate system preferring dark mode
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      });

      const systemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      const { result } = renderHook(() => useLocalStorage<string>(THEME_KEY, systemPreference));
      expect(result.current[0]).toBe('dark');
    });

    it('persists theme changes to localStorage', () => {
      const { result } = renderHook(() => useLocalStorage<string>(THEME_KEY, 'light'));

      act(() => {
        result.current[1]('dark');
      });

      expect(result.current[0]).toBe('dark');
      expect(JSON.parse(localStorage.getItem(THEME_KEY)!)).toBe('dark');
    });

    it('handles theme toggle between light and dark', () => {
      const { result } = renderHook(() => useLocalStorage<string>(THEME_KEY, 'light'));

      act(() => {
        result.current[1]('dark');
      });
      expect(result.current[0]).toBe('dark');

      act(() => {
        result.current[1]('light');
      });
      expect(result.current[0]).toBe('light');
    });
  });
});
