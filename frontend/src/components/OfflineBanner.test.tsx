import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

// We need to control the navigator.onLine value to drive the hook
function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('OfflineBanner', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    }
  });

  it('renders nothing when online', () => {
    setOnLine(true);
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the offline banner when offline', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/showing cached data/i)).toBeInTheDocument();
  });

  it('has aria-live="polite" for screen reader announcements', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('has aria-label describing the state', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByLabelText(/you are offline/i)).toBeInTheDocument();
  });
});
