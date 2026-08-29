import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDayPlanTemplate, normalizeWake } from "../server/day-plan-service.mjs";

const naa = new Date(2026, 7, 28, 12, 0);

test("tar imot en mal og kaster det som ikke hører hjemme i den", () => {
  const template = normalizeDayPlanTemplate({
    wakeAnchor: "07:00",
    dayEnd: "23:00",
    blocks: [
      { id: "morgen", title: "Morgenrutine", minutes: 30, tone: "sky" },
      { id: "tull", title: "Uten varighet" },
      { id: "verre", minutes: 30 },
      { id: "negativ", title: "Negativ", minutes: -5 },
      { id: "farge", title: "Ukjent tone", minutes: 20, tone: "neon" },
    ],
  });
  assert.deepEqual(template, {
    wakeAnchor: "07:00",
    dayEnd: "23:00",
    blocks: [
      { id: "morgen", title: "Morgenrutine", minutes: 30, tone: "sky" },
      { id: "farge", title: "Ukjent tone", minutes: 20, tone: "violet" },
    ],
  });
});

test("en mal uten gyldige klokkeslett er ingen mal", () => {
  assert.equal(normalizeDayPlanTemplate({ wakeAnchor: "sju", dayEnd: "23:00", blocks: [] }), null);
  assert.equal(normalizeDayPlanTemplate({ wakeAnchor: "07:00", dayEnd: "23:00" }), null);
  assert.equal(normalizeDayPlanTemplate(null), null);
});

test("en mal som slutter før den begynner er ingen mal", () => {
  assert.equal(normalizeDayPlanTemplate({ wakeAnchor: "23:00", dayEnd: "07:00", blocks: [{ id: "a", title: "A", minutes: 30 }] }), null);
});

test("tar imot en oppvåkning fra i dag", () => {
  const wake = normalizeWake({ wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(), source: "shortcut" }, naa);
  assert.equal(wake.source, "shortcut");
  assert.equal(new Date(wake.wokeAt).getHours(), 9);
});

test("avviser en oppvåkning som ligger fram i tid", () => {
  assert.throws(
    () => normalizeWake({ wokeAt: new Date(2026, 7, 28, 14, 0).toISOString(), source: "usage" }, naa),
    /fram i tid/,
  );
});

test("avviser en oppvåkning som ikke er i dag", () => {
  assert.throws(
    () => normalizeWake({ wokeAt: new Date(2026, 7, 27, 9, 0).toISOString(), source: "usage" }, naa),
    /ikke i dag/,
  );
});

test("avviser en ukjent kilde", () => {
  assert.throws(
    () => normalizeWake({ wokeAt: new Date(2026, 7, 28, 9, 0).toISOString(), source: "gjett" }, naa),
    /Ukjent kilde/,
  );
});

test("avhukingen er en bryter, ikke en enveisdør", async () => {
  const { markBlockDone, readWake } = await import("../server/day-plan-service.mjs");
  const first = await markBlockDone({ id: "prøve-bolk", at: new Date().toISOString() });
  assert.ok(first.done.some((entry) => entry.id === "prøve-bolk"));
  const second = await markBlockDone({ id: "prøve-bolk", at: new Date().toISOString() });
  assert.ok(!second.done.some((entry) => entry.id === "prøve-bolk"));
  assert.deepEqual((await readWake()).done.filter((entry) => entry.id === "prøve-bolk"), []);
});

test("en oppvåkning kan ha med når telefonen ble lagt fra seg", () => {
  const wake = normalizeWake({
    wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(),
    sleepAt: new Date(2026, 7, 27, 23, 30).toISOString(),
    source: "usage",
  }, naa);
  assert.equal(new Date(wake.sleepAt).getHours(), 23);
});

test("en leggetid som ikke er en tid blir bare borte, oppvåkningen står", () => {
  const wake = normalizeWake({ wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(), sleepAt: "i går", source: "usage" }, naa);
  assert.equal(wake.sleepAt, null);
  assert.ok(wake.wokeAt);
});

test("en leggetid etter oppvåkningen er ikke en leggetid", () => {
  const wake = normalizeWake({
    wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(),
    sleepAt: new Date(2026, 7, 28, 10, 0).toISOString(),
    source: "usage",
  }, naa);
  assert.equal(wake.sleepAt, null);
});
