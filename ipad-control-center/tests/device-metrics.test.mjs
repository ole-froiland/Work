import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describeSyncPayload, normalizeDeviceUpdate, weatherDescription } from "../server/device-metrics-service.mjs";

test("normalizes trusted mobile metrics and preserves missing values", () => {
  const result = normalizeDeviceUpdate({
    screenTime: { socialMinutes: 214, socialWeeklyAverageMinutes: 187, topApps: [{ name: "Instagram", minutes: 71 }, { name: "Snapchat", minutes: 22 }] },
    steps: { today: 6_842, weeklyAverage: 5_710 },
    location: { label: "Mosterøy", latitude: 59.07, longitude: 5.37 },
    sources: {
      screenTime: { provider: "DeviceActivity", observedAt: new Date().toISOString() },
      steps: { provider: "HealthKit", observedAt: new Date().toISOString() },
      location: { provider: "CoreLocation", observedAt: new Date().toISOString() },
    },
  });

  assert.deepEqual(result.screenTime, { socialMinutes: 214, socialWeeklyAverageMinutes: 187, topApps: [{ name: "Instagram", minutes: 71 }, { name: "Snapchat", minutes: 22 }] });
  assert.deepEqual(result.steps, { today: 6_842, weeklyAverage: 5_710 });
  assert.deepEqual(result.location, { label: "Mosterøy", latitude: 59.07, longitude: 5.37, source: "device" });
});

test("rejects unverified browser values even when their numbers look valid", () => {
  const result = normalizeDeviceUpdate({
    screenTime: { socialMinutes: 60, socialWeeklyAverageMinutes: 90 },
    steps: { today: 5_000 },
    location: { label: "Feil sted", latitude: 1, longitude: 1 },
  });

  assert.deepEqual(result.screenTime, { socialMinutes: null, socialWeeklyAverageMinutes: null, topApps: [] });
  assert.deepEqual(result.steps, { today: null, weeklyAverage: null });
  assert.equal(result.location.label, "Mosterøy");
});

test("rejects impossible mobile values instead of displaying them", () => {
  const result = normalizeDeviceUpdate({
    screenTime: { socialMinutes: -10, socialWeeklyAverageMinutes: 3_000 },
    steps: { today: -1 },
  }, { screenTime: { socialMinutes: 100, socialWeeklyAverageMinutes: 90 }, steps: { today: 4_000, weeklyAverage: 3_800 } });

  assert.deepEqual(result.screenTime, { socialMinutes: 100, socialWeeklyAverageMinutes: 90, topApps: [] });
  assert.deepEqual(result.steps, { today: 4_000, weeklyAverage: 3_800 });
});

test("maps weather codes to short Norwegian labels", () => {
  assert.equal(weatherDescription(0), "Klart");
  assert.equal(weatherDescription(63), "Regn");
  assert.equal(weatherDescription(75), "Snø");
});

test("names the sources a sync actually carried", () => {
  const full = {
    sources: {
      screenTime: { provider: "DeviceActivity", observedAt: "2026-08-23T08:00:00.000Z" },
      steps: { provider: "HealthKit", observedAt: "2026-08-23T08:00:00.000Z" },
      location: { provider: "CoreLocation", observedAt: "2026-08-23T08:00:00.000Z" },
    },
  };
  assert.equal(describeSyncPayload(full), "screenTime, steps, location");

  // Nektet HealthKit tilgang, kommer sendingen uten skritt — og da er det den
  // linja som skiller «appen fikk ikke lov» fra «telefonen ringte aldri».
  const withoutSteps = { sources: { ...full.sources, steps: undefined } };
  assert.equal(describeSyncPayload(withoutSteps), "screenTime, location");
  assert.equal(describeSyncPayload({}), "ingen kilder");
  assert.equal(describeSyncPayload({ sources: { steps: { provider: "HealthKit" } } }), "ingen kilder");
});

test("takes the sources that answered when one of them failed", () => {
  // Appen sender nå hver kilde for seg. Kom posisjonen aldri i havn — den kan
  // gjerne feile innendørs — skal skrittene likevel komme frem, og forrige
  // posisjon bli stående i stedet for å bli nullet ut.
  const previous = {
    steps: { today: 100, weeklyAverage: 200 },
    location: { label: "Stavanger", latitude: 58.96, longitude: 5.76, source: "device" },
    sources: {
      steps: { provider: "HealthKit", observedAt: "2026-08-21T14:22:55.000Z" },
      location: { provider: "CoreLocation", observedAt: "2026-08-21T14:22:54.000Z" },
    },
  };
  // Ferskt, ikke fast: en oppføring i framtiden avvises med rette, og et fast
  // tidsstempel blir framtidig eller for gammelt alt etter når testen kjøres.
  const nå = new Date(Date.now() - 60_000).toISOString();
  const utenPosisjon = normalizeDeviceUpdate({
    steps: { today: 4321, weeklyAverage: 3000 },
    sources: { steps: { provider: "HealthKit", observedAt: nå } },
    deviceName: "iPhone",
  }, previous);

  assert.equal(utenPosisjon.steps.today, 4321);
  assert.equal(utenPosisjon.sources.steps.observedAt, nå);
  assert.deepEqual(utenPosisjon.location, previous.location);
  assert.deepEqual(utenPosisjon.sources.location, previous.sources.location);
  assert.equal(describeSyncPayload({ sources: { steps: { provider: "HealthKit", observedAt: nå } } }), "steps");
});

test("iPhone-koblingen registrerer datadrevet HealthKit-synk ved oppstart", async () => {
  const [model, app] = await Promise.all([
    readFile(new URL("../ios-companion/Sources/MetricsSyncModel.swift", import.meta.url), "utf8"),
    readFile(new URL("../ios-companion/Sources/PanelCompanionApp.swift", import.meta.url), "utf8"),
  ]);

  assert.match(model, /HKObserverQuery\(sampleType: stepType/);
  assert.match(model, /enableBackgroundDelivery\(for: stepType, frequency: \.hourly/);
  assert.match(model, /stepsStatus = "Godkjent"\s+startAutomaticSync\(\)/);
  assert.match(app, /didFinishLaunchingWithOptions[\s\S]*MetricsSyncModel\.shared\.startAutomaticSync\(\)/);
});
