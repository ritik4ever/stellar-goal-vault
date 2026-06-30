import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay';
import { APP_SHORTCUTS } from '../lib/shortcuts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderOverlay(isOpen: boolean, onClose = vi.fn()) {
  return render(<KeyboardShortcutsOverlay isOpen={isOpen} onClose={onClose} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeyboardShortcutsOverlay', () => {
  describe('Visibility', () => {
    it('renders nothing when isOpen is false', () => {
      renderOverlay(false);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders the dialog when isOpen is true', () => {
      renderOverlay(true);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has aria-modal="true" when open', () => {
      renderOverlay(true);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });
  });

  describe('Shortcut listing', () => {
    it('displays all shortcuts from APP_SHORTCUTS', () => {
      renderOverlay(true);
      for (const shortcut of APP_SHORTCUTS) {
        expect(screen.getByText(shortcut.label)).toBeInTheDocument();
        expect(screen.getByText(shortcut.description)).toBeInTheDocument();
      }
    });

    it('renders a <kbd> element for each shortcut key', () => {
      renderOverlay(true);
      // APP_SHORTCUTS keys + the Esc hint in the footer
      const kbdElements = document.querySelectorAll('kbd');
      // At least one per shortcut
      expect(kbdElements.length).toBeGreaterThanOrEqual(APP_SHORTCUTS.length);
    });
  });

  describe('Closing behaviour', () => {
    it('calls onClose when the close button is clicked', async () => {
      const onClose = vi.fn();
      renderOverlay(true, onClose);
      await userEvent.click(screen.getByRole('button', { name: /close shortcuts overlay/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the backdrop is clicked', async () => {
      const onClose = vi.fn();
      const { container } = renderOverlay(true, onClose);
      const backdrop = container.querySelector('.shortcuts-overlay-backdrop') as HTMLElement;
      await userEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onClose when clicking inside the dialog content', async () => {
      const onClose = vi.fn();
      renderOverlay(true, onClose);
      await userEvent.click(screen.getByRole('dialog'));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard: ? key triggers overlay (integration via window listener)', () => {
    /**
     * The ? → open / Escape → close logic lives in App.tsx's window keydown
     * listener.  Here we test the overlay component's own Escape handler so
     * it closes even without the App wrapper.
     */
    it('calls onClose when Escape is pressed inside the dialog', () => {
      const onClose = vi.fn();
      renderOverlay(true, onClose);
      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('simulates ? keydown on window and verifies overlay becomes visible', () => {
      // Render a controlled wrapper that wires the window listener the same
      // way App.tsx does.
      const { rerender } = render(
        <ControlledOverlay />,
      );

      // Overlay should be hidden initially
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Fire the ? key on the window
      fireEvent.keyDown(window, { key: '?' });

      rerender(<ControlledOverlay />);

      // The dialog must now be visible
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('simulates Escape keydown on window and closes overlay', () => {
      render(<ControlledOverlay initialOpen />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('Focus trap', () => {
    it('focuses the dialog container on open', () => {
      renderOverlay(true);
      const dialog = screen.getByRole('dialog');
      expect(document.activeElement).toBe(dialog);
    });

    it('wraps focus from last to first focusable element on Tab', async () => {
      const user = userEvent.setup();
      renderOverlay(true);

      const dialog = screen.getByRole('dialog');
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const lastFocusable = focusable[focusable.length - 1];
      const firstFocusable = focusable[0];

      // Move focus to the last focusable element
      lastFocusable.focus();
      expect(document.activeElement).toBe(lastFocusable);

      // Tab should wrap back to the first
      await user.tab();
      expect(document.activeElement).toBe(firstFocusable);
    });

    it('wraps focus from first to last focusable element on Shift+Tab', async () => {
      const user = userEvent.setup();
      renderOverlay(true);

      const dialog = screen.getByRole('dialog');
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];

      // Move focus to the first focusable element
      firstFocusable.focus();
      expect(document.activeElement).toBe(firstFocusable);

      // Shift+Tab should wrap to the last
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(lastFocusable);
    });
  });

  describe('Scroll lock', () => {
    beforeEach(() => {
      document.body.style.overflow = '';
    });

    it('locks body scroll when overlay opens', () => {
      renderOverlay(true);
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body scroll when overlay closes', () => {
      const { rerender } = renderOverlay(true);
      expect(document.body.style.overflow).toBe('hidden');
      rerender(<KeyboardShortcutsOverlay isOpen={false} onClose={vi.fn()} />);
      expect(document.body.style.overflow).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// Minimal controlled wrapper that mirrors App.tsx's window listener logic
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';

function ControlledOverlay({ initialOpen = false }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setIsOpen((current) => !current);
      }
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  return <KeyboardShortcutsOverlay isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}
