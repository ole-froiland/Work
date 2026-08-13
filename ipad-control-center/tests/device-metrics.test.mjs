import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDeviceUpdate, weatherDescription } from "../server/device-metrics-service.mjs";

test("normalizes trusted mobile metrics and preserves missing values", () => {
  const result = normalizeDeviceUpdate({
    screenTime: { yesterdayMinutes: 214, weeklyAverageMinutes: 187, topApps: [{ name: "Safari", minutes: 71 }, { name: "Meldinger", minutes: 22 }] },
    steps: { today: 6_842, weeklyAverage: 5_710 },
    location: { label: "Mosterøy", latitude: 59.07, longitude: 5.37 },
    sources: {
      screenTime: { provider: "DeviceActivity", observedAt: new Date().toISOString() },
      steps: { provider: "HealthKit", observedAt: new Date().toISOString() },
      location: { provider: "CoreLocation", observedAt: new Date().toISOString() },
    },
  });

  assert.deepEqual(result.screenTime, { yesterdayMinutes: 214, weeklyAverageMinutes: 187, topApps: [{ name: "Safari", minutes: 71 }, { name: "Meldinger", minutes: 22 }] });
  assert.deepEqual(result.steps, { today: 6_842, weeklyAverage: 5_710 });
  assert.deepEqual(result.location, { label: "Mosterøy", latitude: 59.07, longitude: 5.37, source: "device" });
});

test("rejects unverified browser values even when their numbers look valid", () => {
  const result = normalizeDeviceUpdate({
    screenTime: { yesterdayMinutes: 60, weeklyAverageMinutes: 90 },
    steps: { today: 5_000 },
    location: { label: "Feil sted", latitude: 1, longitude: 1 },
  });

  assert.deepEqual(result.screenTime, { yesterdayMinutes: null, weeklyAverageMinutes: null, topApps: [] });
  assert.deepEqual(result.steps, { today: null, weeklyAverage: null });
  assert.equal(result.location.label, "Mosterøy");
});

test("rejects impossible mobile values instead of displaying them", () => {
  const result = normalizeDeviceUpdate({
    screenTime: { yesterdayMinutes: -10, weeklyAverageMinutes: 3_000 },
    steps: { today: -1 },
  }, { screenTime: { yesterdayMinutes: 100, weeklyAverageMinutes: 90 }, steps: { today: 4_000, weeklyAverage: 3_800 } });

  assert.deepEqual(result.screenTime, { yesterdayMinutes: 100, weeklyAverageMinutes: 90, topApps: [] });
  assert.deepEqual(result.steps, { today: 4_000, weeklyAverage: 3_800 });
});

test("maps weather codes to short Norwegian labels", () => {
  assert.equal(weatherDescription(0), "Klart");
  assert.equal(weatherDescription(63), "Regn");
  assert.equal(weatherDescription(75), "Snø");
});
