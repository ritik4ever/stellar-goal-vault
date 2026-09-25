import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

const App = lazy(() => import('./App'));
const ContributorProfile = lazy(() =>
  import('./components/ContributorProfile').then((m) => ({ default: m.ContributorProfile })),
);
const NotFoundPage = lazy(() =>
  import('./components/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

// Register the service worker for PWA offline support.
// `virtual:pwa-register` is injected by vite-plugin-pwa at build time.
// We import lazily with a dynamic import so the SW registration never blocks
// the initial render and only runs in production builds (devOptions enabled
// in vite.config.mts gives us the SW in dev too for testing).
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      // Trigger a reload when a new SW version is waiting
      onNeedRefresh() {
        // A new version is available. We silently skip waiting so the
        // update applies on next navigation rather than forcing a hard reload.
        // For a richer experience, replace this with a toast + user-confirm.
        if (window.confirm('A new version of Stellar Goal Vault is available. Reload to update?')) {
          window.location.reload();
        }
      },
      onOfflineReady() {
        // SW installed and offline caching is active. Could show a toast here.
        console.info('[PWA] App is ready for offline use.');
      },
    });
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="app-shell" aria-busy="true">
            Loading…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/campaigns/:id" element={<App />} />
          <Route path="/contributors/:address" element={<ContributorProfile />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>,
);
