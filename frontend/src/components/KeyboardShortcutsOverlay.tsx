import React, { useEffect, useRef } from "react";
import { APP_SHORTCUTS } from "../lib/shortcuts";

interface KeyboardShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsOverlay: React.FC<KeyboardShortcutsOverlayProps> = ({
  isOpen,
  onClose,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      overlayRef.current?.focus();
      // Lock scroll when open
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="shortcuts-overlay-backdrop"
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        className="shortcuts-overlay-content card animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        ref={overlayRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-header">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button
            className="btn-close"
            onClick={onClose}
            aria-label="Close shortcuts overlay"
          >
            &times;
          </button>
        </div>

        <div className="shortcuts-grid">
          {APP_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.key} className="shortcut-item">
              <kbd className="shortcut-key">{shortcut.key}</kbd>
              <div className="shortcut-info">
                <span className="shortcut-label">{shortcut.label}</span>
                <span className="shortcut-description">
                  {shortcut.description}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-footer">
          <p>Press <kbd className="shortcut-key">Esc</kbd> to close</p>
        </div>
      </div>
    </div>
  );
};
