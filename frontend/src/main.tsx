import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import { EmbedWidget } from "./components/EmbedWidget";
import { NotFoundPage } from "./components/NotFoundPage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/campaigns/:id" element={<App />} />
        <Route path="/embed/campaigns/:id" element={
          <div className="embed-widget-root">
            <EmbedWidget />
          </div>
        } />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
