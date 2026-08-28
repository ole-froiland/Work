import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { PanelEntry } from "./PanelEntry.jsx";
import { createPanelOpener, isPanelReachable, LOOPBACK_PANEL_URL, planPanelEntry } from "./dashboard.js";
import "./styles.css";

const root = createRoot(document.getElementById("root"));
const plan = planPanelEntry({
  location: window.location,
  storage: window.localStorage,
  session: window.sessionStorage,
});

function showChooser(failedUrl) {
  root.render(<PanelEntry state="choose" failedUrl={failedUrl} candidates={plan.candidates} onOpen={openPanel} />);
}

const openPanel = createPanelOpener({
  location: window.location,
  storage: window.localStorage,
  session: window.sessionStorage,
  // Henger navigeringen, lever denne siden fortsatt. Da avbrytes forsøket i
  // stedet for å la fanen spinne over en tom side i det uendelige.
  onStalled: (url) => {
    window.stop();
    showChooser(url);
  },
});

if (plan.mode === "app") {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else if (plan.mode === "chooser") {
  showChooser(plan.failedUrl);
} else {
  // Skjermen tegnes først, så siden aldri står svart mens adressen sjekkes.
  root.render(<PanelEntry state="connecting" target={plan.url} candidates={plan.candidates} onOpen={openPanel} />);
  // Åpnes panelet på Mac-en selv, svarer tailnett-navnet aldri — tailscaled
  // kjører i userspace og ruter ikke Mac-ens egen trafikk. Loopback gjør det.
  isPanelReachable(LOOPBACK_PANEL_URL).then((reachable) => {
    openPanel(reachable ? LOOPBACK_PANEL_URL : plan.url);
  });
}
