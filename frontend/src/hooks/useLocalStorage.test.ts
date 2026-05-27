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
});
