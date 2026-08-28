import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { PanelEntry } from "./PanelEntry.jsx";
import { createPanelOpener, isPanelReachable, LOOPBACK_PANEL_URL, nextPanelCandidate, planPanelEntry } from "./dashboard.js";
import "./styles.css";

const root = createRoot(document.getElementById("root"));
const plan = planPanelEntry({
  location: window.location,
  storage: window.localStorage,
  session: window.sessionStorage,
});

const tried = [];

function showChooser(failedUrl) {
  root.render(<PanelEntry state="choose" failedUrl={failedUrl} candidates={plan.candidates} onOpen={openPanel} />);
}

const openPanel = createPanelOpener({
  location: window.location,
  storage: window.localStorage,
  session: window.sessionStorage,
  // Henger navigeringen, lever denne siden fortsatt. Da avbrytes forsøket, og
  // neste adresse prøves av seg selv — en iPad som har husket .local og drar på
  // mobildata skal finne veien via tailnettet uten at noen rører den. Først når
  // ingen adresser står igjen, er det noe å spørre om.
  onStalled: (url) => {
    window.stop();
    tried.push(url);
    const next = nextPanelCandidate(plan.candidates, tried);
    if (!next) {
      showChooser(url);
      return;
    }
    root.render(
      <PanelEntry state="connecting" target={next.url} previousUrl={url} candidates={plan.candidates} onOpen={openPanel} />,
    );
    openPanel(next.url);
  },
});

if (plan.mode === "app") {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else if (plan.mode === "redirect") {
  // Adressen er valgt før og huskes. Skjermen tegnes så siden ikke står svart
  // mens nettleseren jobber med hoppet.
  root.render(<PanelEntry state="connecting" target={plan.url} candidates={plan.candidates} onOpen={openPanel} />);
  openPanel(plan.url);
} else if (plan.failedUrl) {
  showChooser(plan.failedUrl);
} else {
  // Første gang, uten noe å gå på. Det ene stedet siden kan sjekke selv er
  // maskinen den åpnes fra: svarer panelet på loopback, er vi på Mac-en, og da
  // trengs ingen spørsmål. Ellers spørres det heller enn å gjettes — gjetter
  // siden feil, havner Ole på nettleserens feilside, der den ikke kan rette seg.
  root.render(<PanelEntry state="connecting" target={null} candidates={plan.candidates} onOpen={openPanel} />);
  isPanelReachable(LOOPBACK_PANEL_URL).then((reachable) => {
    if (reachable) openPanel(LOOPBACK_PANEL_URL, { remember: true });
    else showChooser(null);
  });
}
