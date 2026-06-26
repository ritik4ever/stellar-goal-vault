import { CheckCircle2, ExternalLink, Info, X, XCircle } from 'lucide-react';
import type { Toast, ToastVariant } from '../hooks/useToast';

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const VARIANT_ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="log" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => {
        const Icon = VARIANT_ICONS[toast.variant];
        return (
          <div key={toast.id} className={`toast toast-${toast.variant}`} role="status">
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
              className="toast-close"
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
