import React, { useState } from "react";
import { normalizePanelHost } from "./dashboard.js";

function hostLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Skjermen Netlify-siden viser i stedet for ingenting. «connecting» står i det
// halve sekundet den sjekker om panelet kjører på maskinen den åpnes fra;
// «choose» kommer når forrige adresse ikke svarte, og er hele grunnen til at en
// Mac som ikke er tilgjengelig ikke lenger er en blank skjerm.
export function PanelEntry({ state = "connecting", target = null, failedUrl = null, candidates = [], onOpen }) {
  const [custom, setCustom] = useState("");
  const [error, setError] = useState(null);
  const choosing = state === "choose";

  function submitCustom(event) {
    event.preventDefault();
    const url = normalizePanelHost(custom);
    if (!url) {
      setError("Adressen må kunne være Mac-en: et .local- eller .ts.net-navn, eller en privat IP-adresse.");
      return;
    }
    setError(null);
    onOpen(url, { remember: true });
  }

  return (
    <main className="panel-entry">
      <div className="panel-entry-card">
        <h1>{choosing ? "Fant ikke Mac-en" : "Kobler til Mac-en …"}</h1>
        {choosing ? (
          <p className="panel-entry-lead">
            {failedUrl ? `${hostLabel(failedUrl)} svarte ikke.` : "Adressen svarte ikke."}{" "}
            Kalender, kvoter og Nøkkelring finnes bare på Mac-en, så panelet må nå den. Velg en adresse som
            passer nettet du er på nå — den huskes til neste gang.
          </p>
        ) : (
          <p className="panel-entry-lead">
            Åpner {target ? hostLabel(target) : "panelet"}. Svarer den ikke, får du velge en annen adresse.
          </p>
        )}

        {choosing ? (
          <>
            <ul className="panel-entry-list">
              {candidates.map((candidate) => (
                <li key={candidate.url}>
                  <button type="button" onClick={() => onOpen(candidate.url, { remember: true })}>
                    <span className="panel-entry-label">{candidate.label}</span>
                    <span className="panel-entry-host">{hostLabel(candidate.url)}</span>
                    <span className="panel-entry-note">{candidate.note}</span>
                  </button>
                </li>
              ))}
            </ul>

            <form className="panel-entry-form" onSubmit={submitCustom}>
              <label htmlFor="panel-entry-host">Annen adresse</label>
              <div className="panel-entry-row">
                <input
                  id="panel-entry-host"
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="100.117.183.123"
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                />
                <button type="submit">Åpne</button>
              </div>
              {error ? <p className="panel-entry-error">{error}</p> : null}
            </form>

            <p className="panel-entry-foot">
              Svarer ingen av dem: slå på Tailscale på begge enhetene, eller sjekk at Mac-en er våken.{" "}
              <a href="?public=1">Åpne det offentlige skallet</a> for å feilsøke uten Mac-en.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
