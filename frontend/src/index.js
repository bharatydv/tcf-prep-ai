import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import migrateStorageKeys from "./lib/storageMigration";

// Must run before App mounts: the language provider and the exam simulator both
// read their keys during their first render.
migrateStorageKeys();

// Suppress the benign ResizeObserver loop error triggered by recharts
const roError = /ResizeObserver loop/;
window.addEventListener("error", (e) => {
  if (roError.test(e.message)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

// `npm run build:prerender` writes real markup into #root so crawlers that do
// not run JavaScript still see the page. Hydrating that markup keeps it on
// screen; calling createRoot on it would throw the prerendered HTML away and
// repaint, which is the flash react-snap exists to avoid.
const container = document.getElementById("root");
if (container.hasChildNodes()) {
  ReactDOM.hydrateRoot(container, <App />);
} else {
  ReactDOM.createRoot(container).render(<App />);
}
