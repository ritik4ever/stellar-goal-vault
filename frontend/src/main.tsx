import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import { ContributorProfile } from "./components/ContributorProfile";
import { NotFoundPage } from "./components/NotFoundPage";
import "./index.css";

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/campaigns/:id" element={<App />} />
        <Route path="/contributors/:address" element={<ContributorProfile />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
