import { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, X, XCircle } from 'lucide-react';
import type { ToastVariant } from '../hooks/useToast';

export interface ToastData {
  id: string;
  message: string;
  variant: ToastVariant;
  link?: { href: string; label: string };
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const VARIANT_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

export function Toast({ toast, onDismiss }: ToastProps) {
  const Icon = VARIANT_ICONS[toast.variant];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss(toast.id);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast toast-${toast.variant}`} role="status" aria-live="polite">
      <Icon size={18} className="toast-icon" aria-hidden="true" />
      <span className="toast-body">
        <p className="toast-message">{toast.message}</p>
        {toast.link ? (
          <a
            href={toast.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="toast-link"
          >
            {toast.link.label}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : null}
      </span>
      <button
        ref={closeRef}
        className="toast-close"
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}
