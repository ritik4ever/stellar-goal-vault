import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { axe, type AxeResults } from 'vitest-axe';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';

export type ThemeMode = 'light' | 'dark';

export const THEMES: ThemeMode[] = ['light', 'dark'];

export function setTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', mode);
}

export function setupDesktopViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
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
}

export async function runAxeAudit(container: HTMLElement, theme: ThemeMode): Promise<AxeResults> {
  setTheme(theme);
  return axe(container);
}

export function renderWithTheme(
  ui: ReactElement,
  theme: ThemeMode = 'dark',
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  setTheme(theme);
  return render(ui, options);
}

interface ThemeWrapperProps {
  children: ReactNode;
  theme: ThemeMode;
}

export function ThemeWrapper({ children, theme }: ThemeWrapperProps) {
  setTheme(theme);
  return <>{children}</>;
}
