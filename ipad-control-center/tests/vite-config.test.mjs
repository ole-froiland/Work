import test from "node:test";
import assert from "node:assert/strict";

import viteConfig from "../vite.config.mjs";

test("keeps the local panel on its documented stable port", () => {
  assert.equal(viteConfig.server.port, 4173);
  assert.equal(viteConfig.server.strictPort, true);
});
