import { LucideIcon } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  title?: string;
  message: string;
  icon?: LucideIcon;
  variant?: 'card' | 'inline';
  className?: string;
  /** Optional primary CTA rendered below the message (e.g. "Clear Filters"). */
  action?: EmptyStateAction;
}

/**
 * A reusable component for displaying empty states across the application.
 * Standardizes the visual structure and styling for consistent UX.
 *
 * Pass an `action` prop to render a contextual CTA button (e.g. "Clear Filters"
 * or "Clear Search") that lets users recover from filtered empty states.
 */
export function EmptyState({
  title,
  message,
  icon: Icon,
  variant = 'inline',
  className = '',
  action,
}: EmptyStateProps) {
  const containerClass =
    variant === 'card' ? 'card empty-state-container' : 'empty-state-container';

  return (
    <div
      className={`${containerClass} animate-fade-in ${className}`}
      role="status"
      aria-live="polite"
    >
      {Icon && (
        <div className="empty-state-icon">
          <Icon size={48} strokeWidth={1.2} />
        </div>
      )}
      <div className="empty-state-content">
        {title && <h3 className="empty-state-title">{title}</h3>}
        <p className="empty-state-message muted">{message}</p>
        {action && (
          <button
            type="button"
            className="btn-secondary empty-state-action"
            onClick={action.onClick}
            aria-label={action.label}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

