import '@testing-library/jest-dom';
import { expect, vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
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

const optionalAxeMatchersModule = 'vitest-axe/matchers';

void import(/* @vite-ignore */ optionalAxeMatchersModule)
  .then((module) => {
    expect.extend(module);
  })
  .catch(() => {
    // Accessibility helpers are optional in this workspace.
  });
