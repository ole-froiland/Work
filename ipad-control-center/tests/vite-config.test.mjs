import test from "node:test";
import assert from "node:assert/strict";

import viteConfig from "../vite.config.mjs";

test("keeps the local panel on its documented stable port", () => {
  assert.equal(viteConfig.server.port, 4173);
  assert.equal(viteConfig.server.strictPort, true);
});

test("allows the lowercase local hostname sent by browsers", () => {
  assert.ok(viteConfig.server.allowedHosts.includes("ole-sin-macbook-air.local"));
});

test("allows the hostname spelled the way the rest of the project writes it", () => {
  // Vite sammenligner verten tegn for tegn. Nettlesere sender små bokstaver, men
  // LOCAL_PANEL_URL og README skriver Ole-sin-MacBook-Air.local.
  assert.ok(viteConfig.server.allowedHosts.includes("Ole-sin-MacBook-Air.local"));
});

test("lets the tailnet address through, since .local only answers on the same LAN", () => {
  // En iPhone-hotspot slipper ikke Bonjour mellom klientene sine. Tailscale-navnet
  // er det eneste som svarer likt uansett nett, og det er ikke kjent på forhånd.
  assert.ok(viteConfig.server.allowedHosts.includes(".ts.net"));
});

test("answers on IPv6 too, since that is what the iPad picks for the .local name", () => {
  // «0.0.0.0» er bare IPv4. iPad-en slår opp .local-navnet, får en IPv6-adresse
  // og møter en port ingen lytter på — og en Hjem-skjerm-app blir da helt hvit.
  assert.equal(viteConfig.server.host, "::");
});

test("svarer på om panelet kjører, så Netlify-siden slipper å gjette", () => {
  // Uten dette endepunktet kan ikke den offentlige siden vite at panelet kjører
  // på maskinen den åpnes fra, og en Mac som ikke svarer blir en blank skjerm.
  const names = viteConfig.plugins.flat(Infinity).map((plugin) => plugin?.name);
  assert.ok(names.includes("local-panel-hello-api"));
});

test("dagsplanen er montert som eget endepunkt", () => {
  const names = viteConfig.plugins.flat(Infinity).map((plugin) => plugin?.name);
  assert.ok(names.includes("local-day-plan-api"));
});
