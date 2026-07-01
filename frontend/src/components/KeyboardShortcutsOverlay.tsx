import React, { useCallback, useEffect, useRef } from 'react';
import { APP_SHORTCUTS } from '../lib/shortcuts';

interface KeyboardShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Selectors for all focusable elements inside a container. */
const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const KeyboardShortcutsOverlay: React.FC<KeyboardShortcutsOverlayProps> = ({
  isOpen,
  onClose,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus the dialog and lock scroll when opened.
  useEffect(() => {
    if (isOpen) {
      overlayRef.current?.focus();
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle Escape and focus-trap (Tab / Shift+Tab) inside the dialog.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab' && overlayRef.current) {
        const focusable = Array.from(
          overlayRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        );

        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey) {
          // Shift+Tab: wrap from first → last
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          // Tab: wrap from last → first
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="shortcuts-overlay-backdrop" onClick={onClose} aria-hidden="true">
      <div
        className="shortcuts-overlay-content card animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        ref={overlayRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="shortcuts-header">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close shortcuts overlay">
            &times;
          </button>
        </div>

        <div className="shortcuts-grid">
          {APP_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.key} className="shortcut-item">
              <kbd className="shortcut-key">{shortcut.key}</kbd>
              <div className="shortcut-info">
                <span className="shortcut-label">{shortcut.label}</span>
                <span className="shortcut-description">{shortcut.description}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-footer">
          <p>
            Press <kbd className="shortcut-key">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
};
