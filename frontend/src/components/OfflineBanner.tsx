import { useOffline } from '../hooks/useOffline';

/**
 * Renders a persistent top banner when the user is offline.
 * The banner clearly labels that displayed data is from the local cache
 * and that new campaigns or pledge submissions are unavailable.
 */
export function OfflineBanner() {
  const isOffline = useOffline();

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="You are offline"
      className="offline-banner"
    >
      <span className="offline-banner__icon" aria-hidden="true">⚡</span>
      <span className="offline-banner__message">
        You&apos;re offline — showing cached data. Some features are unavailable until you reconnect.
      </span>
    </div>
  );
}
