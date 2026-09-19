import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import migrateStorageKeys from "./lib/storageMigration";
import { redirectLegacyLocale } from "./lib/locale";

// Must run before App mounts: the exam simulator reads its keys during its
// first render.
migrateStorageKeys();

// Suppress the benign ResizeObserver loop error triggered by recharts
const roError = /ResizeObserver loop/;
window.addEventListener("error", (e) => {
  if (roError.test(e.message)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

// The French interface is gone; its /fr URLs are not. Anyone still arriving on
// one is sent to the English page. Checked before mounting, and the app is not
// mounted at all when it fires — rendering a frame at an address the app no
// longer serves would flash a 404 on the way to a page that exists.
if (!redirectLegacyLocale()) {
  // `npm run build:prerender` writes real markup into #root so crawlers that do
  // not run JavaScript still see the page. Hydrating that markup keeps it on
  // screen; calling createRoot on it would throw the prerendered HTML away and
  // repaint, which is the flash react-snap exists to avoid.
  // A hydration mismatch needs NO handling here, and handling it is worse than
  // leaving it alone. React reports one through reportError(), which reaches
  // window.onerror and reads in the console as an uncaught "Minified React
  // error #418" — but React has already caught it and is re-rendering the root
  // on the client by itself. Code that listens for that error and starts a
  // second root on the same container fights that recovery: /speaking/tasks
  // and /practice/tasks, whose snapshots differ most from the signed-in app,
  // were left with an empty #root and nothing on screen.
  const container = document.getElementById("root");
  if (container.hasChildNodes()) {
    ReactDOM.hydrateRoot(container, <App />);
  } else {
    ReactDOM.createRoot(container).render(<App />);
  }
}
