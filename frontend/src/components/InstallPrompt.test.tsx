import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstallPrompt } from './InstallPrompt';

// Helpers to control matchMedia
function mockMatchMedia(standalone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: standalone && query === '(display-mode: standalone)',
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

describe('InstallPrompt', () => {
  beforeEach(() => {
    mockMatchMedia(false);
    // Clear localStorage to reset dismissed state between tests
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when not installable and not iOS', () => {
    const { container } = render(<InstallPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the install prompt when beforeinstallprompt fires', () => {
    render(<InstallPrompt />);

    const fakePrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      platforms: ['web'],
    };

    fireEvent(window, Object.assign(new Event('beforeinstallprompt'), fakePrompt));

    expect(screen.getByRole('region', { name: /install stellar goal vault/i })).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /install app/i })).toBeInTheDocument();
  });

  it('dismisses and hides when the × button is clicked', () => {
    render(<InstallPrompt />);

    const fakePrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      platforms: ['web'],
    };

    fireEvent(window, Object.assign(new Event('beforeinstallprompt'), fakePrompt));

    const dismissBtn = screen.getByRole('button', { name: /dismiss install prompt/i });
    fireEvent.click(dismissBtn);

    expect(screen.queryByRole('region', { name: /install stellar goal vault/i })).toBeNull();
  });

  it('does not show when already installed (standalone mode)', () => {
    mockMatchMedia(true); // standalone = true
    const { container } = render(<InstallPrompt />);
    // App is in standalone mode — no prompt
    expect(container.firstChild).toBeNull();
  });

  it('does not re-show prompt if previously dismissed', () => {
    localStorage.setItem('sgv-install-prompt-dismissed', 'true');

    const { container } = render(<InstallPrompt />);

    const fakePrompt = {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      platforms: ['web'],
    };

    fireEvent(window, Object.assign(new Event('beforeinstallprompt'), fakePrompt));

    // Still null because dismissed is persisted
    expect(container.firstChild).toBeNull();
  });
});
