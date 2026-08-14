import test from "node:test";
import assert from "node:assert/strict";

import { buildMetricDetails, buildMonthDays, eventOccursOnDay, formatAppName, formatMinutes, formatTimer, readUsageResponse, resolvePanelRedirect } from "../src/dashboard.js";

test("formats focus time safely", () => {
  assert.equal(formatTimer(45 * 60), "45:00");
  assert.equal(formatTimer(61), "01:01");
  assert.equal(formatTimer(-3), "00:00");
});

test("formats synced screen time", () => {
  assert.equal(formatMinutes(214), "3 t 34 min");
  assert.equal(formatMinutes(42), "42 min");
  assert.equal(formatMinutes(null), "Ikke synket");
});

test("explains that AI usage requires the local Mac panel when Netlify returns HTML", async () => {
  const response = new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=UTF-8" } });

  await assert.rejects(readUsageResponse(response), /Ole-sin-MacBook-Air\.local:4173/);
});

test("reads AI usage JSON from the local Mac panel", async () => {
  const snapshot = { codex: { ok: true }, claude: { ok: true } };
  const response = Response.json(snapshot);

  assert.deepEqual(await readUsageResponse(response), snapshot);
});

test("redirects the public panel to the Mac that owns the private data", () => {
  assert.equal(
    resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app" }),
    "http://Ole-sin-MacBook-Air.local:4173",
  );
  assert.equal(resolvePanelRedirect({ hostname: "Ole-sin-MacBook-Air.local" }), null);
});

test("allows the public shell to be opened explicitly for diagnostics", () => {
  assert.equal(resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app", search: "?public=1" }), null);
});

test("shows friendly app names instead of iOS bundle identifiers", () => {
  assert.equal(formatAppName("com.burbn.instagram"), "Instagram");
  assert.equal(formatAppName("com.toyopagroup.picaboo"), "Snapchat");
  assert.equal(formatAppName("com.apple.InCallService"), "Telefon og FaceTime");
  assert.equal(formatAppName("com.example.MyUsefulApp"), "My Useful App");
  assert.equal(formatAppName("Allerede lesbart"), "Allerede lesbart");
});

test("builds a six-week month grid starting on Monday", () => {
  const august2026 = buildMonthDays(2026, 7);
  assert.equal(august2026.length, 42);
  assert.deepEqual(august2026[0], { value: 27, currentMonth: false });
  assert.deepEqual(august2026[5], { value: 1, currentMonth: true });
  assert.deepEqual(august2026[41], { value: 6, currentMonth: false });
});

test("shows an all-day trip on every included calendar day", () => {
  const trip = { start: "2027-01-10T00:00:00", end: "2027-01-20T00:00:00", allDay: true };
  assert.equal(eventOccursOnDay(trip, new Date(2027, 0, 10)), true);
  assert.equal(eventOccursOnDay(trip, new Date(2027, 0, 19)), true);
  assert.equal(eventOccursOnDay(trip, new Date(2027, 0, 20)), false);
});

test("builds honest metric details from synced device values", () => {
  const metrics = {
    screenTime: { yesterdayMinutes: 304, weeklyAverageMinutes: 300, topApps: [{ name: "Safari", minutes: 91 }] },
    steps: { today: 158, weeklyAverage: 797 },
    weather: { ok: true, label: "Mosterøy", temperature: 19, apparentTemperature: 18, condition: "Overskyet" },
    sources: {
      screenTime: { observedAt: "2026-08-12T12:00:00+02:00" },
      steps: { observedAt: "2026-08-12T12:00:00+02:00" },
      location: { provider: "CoreLocation" },
    },
  };
  assert.equal(buildMetricDetails("screenTime", metrics).summary, "5 t 04 min");
  assert.deepEqual(buildMetricDetails("screenTime", metrics).apps, [{ name: "Safari", value: "1 t 31 min" }]);
  assert.deepEqual(buildMetricDetails("steps", metrics).rows[2], ["Mot snittet", "80 % under snittet"]);
  assert.deepEqual(buildMetricDetails("weather", metrics).rows[3], ["Posisjonskilde", "iPhone"]);
});
