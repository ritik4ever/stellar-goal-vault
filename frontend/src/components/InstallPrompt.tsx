import { useEffect, useState } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { useLocalStorage } from '../hooks/useLocalStorage';

const DISMISS_KEY = 'sgv-install-prompt-dismissed';

/**
 * Shows a bottom-sheet install banner when the browser fires
 * `beforeinstallprompt` (Android Chrome) or when running on iOS Safari
 * (where the event is not fired and users must install via Share sheet).
 *
 * Dismissed state is persisted in localStorage so the banner only shows once.
 */
export function InstallPrompt() {
  const { isInstallable, isInstalled, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useLocalStorage<boolean>(DISMISS_KEY, false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // Detect iOS Safari: no beforeinstallprompt, but install via Share sheet
    const ua = navigator.userAgent;
    const isiOS = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
    // Check not already in standalone mode
    const isStandalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    setIsIos(isiOS && isSafari && !isStandalone);
  }, []);

  // Don't render when installed, dismissed, or not installable on non-iOS
  if (dismissed || isInstalled) return null;
  if (!isInstallable && !isIos) return null;

  function handleInstall() {
    if (isInstallable) {
      void promptInstall();
    }
  }

  function handleDismiss() {
    setDismissed(true);
  }

  return (
    <div
      role="region"
      aria-label="Install Stellar Goal Vault"
      className="install-prompt"
    >
      <div className="install-prompt__icon" aria-hidden="true">
        <img src="/icon-192.svg" alt="" width="40" height="40" />
      </div>
      <div className="install-prompt__body">
        <strong className="install-prompt__title">Add to Home Screen</strong>
        <p className="install-prompt__description">
          {isIos
            ? 'Tap the Share button, then "Add to Home Screen" to install.'
            : 'Install Stellar Goal Vault for offline access and a faster experience.'}
        </p>
      </div>
      <div className="install-prompt__actions">
        {!isIos && (
          <button
            type="button"
            className="install-prompt__cta"
            onClick={handleInstall}
            aria-label="Install app"
          >
            Install
          </button>
        )}
        <button
          type="button"
          className="install-prompt__dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
