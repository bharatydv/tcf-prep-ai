import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

// Suppress the benign ResizeObserver loop error triggered by recharts
const roError = /ResizeObserver loop/;
window.addEventListener("error", (e) => {
  if (roError.test(e.message)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
