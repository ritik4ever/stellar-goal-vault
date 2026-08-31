import { useEffect, useState } from 'react';

/**
 * Returns `true` when the browser is offline (no network connectivity).
 * Listens to both `online` and `offline` window events for reactive updates.
 */
export function useOffline(): boolean {
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOffline(false);
    }
    function handleOffline() {
      setIsOffline(true);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOffline;
}
