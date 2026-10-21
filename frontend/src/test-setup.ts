import '@testing-library/jest-dom';
import { expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import './index.css';

expect.extend(axeMatchers);

/**
 * React Testing Library's `asyncWrapper` drains its microtask queue with a
 * `setTimeout(..., 0)` and only advances it when it can detect fake timers.
 * Detection goes through a global `jest` object, which Vitest does not
 * provide, so any `await userEvent.*` call hung forever whenever a test file
 * enabled `vi.useFakeTimers()`.
 *
 * Vitest's fake timers are Sinon based and expose the installed clock as an
 * own `clock` property on `setTimeout`, which is exactly what
 * `jestFakeTimersAreEnabled()` looks for. All that is missing is the `jest`
 * global, so provide a minimal shim that forwards to Vitest's timer helpers.
 */
if (typeof (globalThis as { jest?: unknown }).jest === 'undefined') {
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
    advanceTimersToNextTimer: () => vi.advanceTimersToNextTimer(),
    runAllTimers: () => vi.runAllTimers(),
    runOnlyPendingTimers: () => vi.runOnlyPendingTimers(),
    getTimerCount: () => vi.getTimerCount(),
  };
}

/**
 * jsdom does not implement `IntersectionObserver`, but the campaign board,
 * timeline and contributor summary all use it for lazy loading. A no-op
 * observer keeps those components mountable in tests; files that need to
 * trigger an intersection stub their own implementation.
 */
if (typeof window.IntersectionObserver === 'undefined') {
  class NoopIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly scrollMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  window.IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof window.IntersectionObserver;
}

/**
 * jsdom does not implement `window.matchMedia`, but several hooks
 * (`useMediaQuery`, `useInstallPrompt`) and `App` call it while rendering.
 *
 * Individual test files used to install their own `vi.fn()` mock at module
 * scope. Vitest's `restoreMocks` option restores every registered mock before
 * each test, which stripped the implementation and left the hook reading
 * `undefined` from `window.matchMedia(...)`. A plain (non-mock) implementation
 * installed here survives mock restoration, so every test file starts with a
 * working `matchMedia`. Test files that need a specific `matches` value can
 * still override it.
 */
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
