import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { resolvePanelRedirect } from "./dashboard.js";
import "./styles.css";

const redirectUrl = resolvePanelRedirect(window.location);

if (redirectUrl) {
  window.location.replace(redirectUrl);
} else {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
