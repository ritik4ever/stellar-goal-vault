import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  title?: string;
  message: string;
  icon?: LucideIcon;
  variant?: "card" | "inline";
  className?: string;
}

/**
 * A reusable component for displaying empty states across the application.
 * Standardizes the visual structure and styling for consistent UX.
 */
export function EmptyState({
  title,
  message,
  icon: Icon,
  variant = "inline",
  className = "",
}: EmptyStateProps) {
  const containerClass = variant === "card" ? "card empty-state-container" : "empty-state-container";
  
  return (
    <div className={`${containerClass} animate-fade-in ${className}`}>
      {Icon && (
        <div className="empty-state-icon">
          <Icon size={48} strokeWidth={1.2} />
        </div>
      )}
      <div className="empty-state-content">
        {title && <h3 className="empty-state-title">{title}</h3>}
        <p className="empty-state-message muted">{message}</p>
      </div>
    </div>
  );
}
