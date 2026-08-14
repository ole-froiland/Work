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
