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

test("answers on IPv6 too, since that is what the iPad picks for the .local name", () => {
  // «0.0.0.0» er bare IPv4. iPad-en slår opp .local-navnet, får en IPv6-adresse
  // og møter en port ingen lytter på — og en Hjem-skjerm-app blir da helt hvit.
  assert.equal(viteConfig.server.host, "::");
});
