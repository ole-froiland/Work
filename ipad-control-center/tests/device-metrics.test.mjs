import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describeSyncPayload, normalizeDeviceUpdate, normalizeProblems, weatherDescription } from "../server/device-metrics-service.mjs";

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

const nå = new Date().toISOString();
const helse = { steps: { today: 100, weeklyAverage: 90 }, sources: { steps: { provider: "HealthKit", observedAt: nå } } };

test("telefonens grunn til at en kilde manglet blir tatt vare på", () => {
  const neste = normalizeDeviceUpdate({ ...helse, problems: { screenTime: "Gi full tilgang til app- og nettstedbruk." } }, {});
  assert.equal(neste.problems.screenTime, "Gi full tilgang til app- og nettstedbruk.");
  // Skrittene kom fram, og da har de ingen feil å vise.
  assert.equal(neste.problems.steps, null);
});

test("en kilde som kommer fram igjen mister feilen sin", () => {
  const før = normalizeDeviceUpdate({ ...helse, problems: { screenTime: "Ingen tilgang" } }, {});
  const etter = normalizeDeviceUpdate({
    screenTime: { socialMinutes: 42, socialWeeklyAverageMinutes: 40, topApps: [] },
    sources: { screenTime: { provider: "DeviceActivity", observedAt: nå } },
  }, før);
  assert.equal(etter.problems.screenTime, null);
  assert.equal(etter.screenTime.socialMinutes, 42);
});

test("en grunn blir stående til en ny synk sier noe annet", () => {
  const før = normalizeDeviceUpdate({ ...helse, problems: { screenTime: "Ingen tilgang" } }, {});
  // Neste synk nevner ikke skjermtid i det hele tatt. Grunnen skal ikke forsvinne
  // bare fordi telefonen ikke gjentok den.
  const etter = normalizeDeviceUpdate(helse, før);
  assert.equal(etter.problems.screenTime, "Ingen tilgang");
});

test("bare kjente kilder slippes gjennom, og teksten kappes", () => {
  const p = normalizeProblems({ screenTime: "x".repeat(500), ondsinnet: "slipp meg inn", steps: "   " });
  assert.deepEqual(Object.keys(p), ["screenTime"]);
  assert.equal(p.screenTime.length, 200);
  assert.deepEqual(normalizeProblems(null), {});
  assert.deepEqual(normalizeProblems("nei"), {});
});

test("skjermtid fra i går beskriver forgårs, og skal ikke stå som «I går»", async () => {
  const { getDeviceMetrics, updateDeviceMetrics } = await import("../server/device-metrics-service.mjs");
  const iGår = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const gammel = normalizeDeviceUpdate({
    screenTime: { socialMinutes: 142, socialWeeklyAverageMinutes: 180, topApps: [] },
    sources: { screenTime: { provider: "DeviceActivity", observedAt: iGår } },
  }, {});
  // 20 timer gammelt slapp gjennom det gamle 48-timersvinduet.
  assert.equal(gammel.sources.screenTime.provider, "DeviceActivity");
  assert.notEqual(new Date(iGår).toDateString(), new Date().toDateString());
});
