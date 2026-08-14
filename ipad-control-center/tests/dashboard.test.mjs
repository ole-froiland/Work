import test from "node:test";
import assert from "node:assert/strict";

import { buildMetricDetails, buildMonthDays, describeNextEvent, eventOccursOnDay, formatAppName, formatCountdown, formatMinutes, formatResetTime, formatTimer, readUsageResponse, resolvePanelRedirect } from "../src/dashboard.js";

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

function localEvent(id, startHour, endHour, extra = {}) {
  return {
    id,
    title: id,
    start: new Date(2026, 7, 14, startHour, 0).toISOString(),
    end: new Date(2026, 7, 14, endHour, 0).toISOString(),
    tone: "amber",
    calendarName: "Jobb",
    ...extra,
  };
}

test("formats the countdown to the next activity", () => {
  assert.equal(formatCountdown(30_000), "starter nå");
  assert.equal(formatCountdown(25 * 60_000), "om 25 min");
  assert.equal(formatCountdown(60 * 60_000), "om 1 t");
  assert.equal(formatCountdown(135 * 60_000), "om 2 t 15 min");
  assert.equal(formatCountdown(26 * 60 * 60_000), "om 1 d 2 t");
  assert.equal(formatCountdown(-5_000), "starter nå");
});

test("picks the next activity that has not started yet", () => {
  const now = new Date(2026, 7, 14, 11, 0);
  const events = [localEvent("Senere", 15, 16), localEvent("Neste", 13, 14), localEvent("Ferdig", 9, 10)];

  const next = describeNextEvent(events, now);
  assert.equal(next.title, "Neste");
  assert.equal(next.when, "I dag 13:00–14:00");
  assert.equal(next.countdown, "om 2 t");
  assert.equal(next.ongoing, false);
  assert.equal(next.calendarName, "Jobb");
});

test("falls back to the activity in progress when nothing is queued up", () => {
  const now = new Date(2026, 7, 14, 11, 0);

  const next = describeNextEvent([localEvent("Pågår", 10, 12), localEvent("Ferdig", 8, 9)], now);
  assert.equal(next.title, "Pågår");
  assert.equal(next.when, "Slutter 12:00");
  assert.equal(next.countdown, "pågår nå");
  assert.equal(next.ongoing, true);
});

test("names tomorrow and weekdays instead of repeating the date", () => {
  const now = new Date(2026, 7, 14, 11, 0);
  const tomorrow = { ...localEvent("I morgen", 9, 10), start: new Date(2026, 7, 15, 9, 0).toISOString(), end: new Date(2026, 7, 15, 10, 0).toISOString() };

  assert.equal(describeNextEvent([tomorrow], now).when, "I morgen 09:00–10:00");
  assert.equal(describeNextEvent([tomorrow], now).countdown, "om 22 t");
});

test("uses all-day entries only when no timed activity remains", () => {
  const now = new Date(2026, 7, 14, 11, 0);
  const holiday = {
    id: "Ferie",
    title: "Ferie",
    allDay: true,
    start: new Date(2026, 7, 14).toISOString(),
    end: new Date(2026, 7, 16).toISOString(),
  };

  assert.equal(describeNextEvent([holiday, localEvent("Møte", 13, 14)], now).title, "Møte");
  const allDay = describeNextEvent([holiday], now);
  assert.equal(allDay.title, "Ferie");
  assert.equal(allDay.countdown, "hele dagen");
  assert.equal(allDay.when, "I dag");
});

test("reports nothing when the calendar has no activity left", () => {
  const now = new Date(2026, 7, 14, 11, 0);
  assert.equal(describeNextEvent([localEvent("Ferdig", 8, 9)], now), null);
  assert.equal(describeNextEvent([], now), null);
  assert.equal(describeNextEvent(undefined, now), null);
  assert.equal(describeNextEvent([{ title: "Uten tid" }], now), null);
});

test("counts down to a reset the provider reported, even when it flags the window inactive", () => {
  const now = new Date("2026-08-14T19:14:00.000Z");

  // Claude sender is_active: false for ukesvinduet, men oppgir både forbruk og tidspunkt.
  const weekly = formatResetTime("2026-08-17T18:00:00.442Z", false, now);
  assert.equal(weekly.countdown, "2 dager 22 timer igjen");
  assert.match(weekly.absolute, /17\. aug/);

  const session = formatResetTime("2026-08-14T23:20:00.442Z", true, now);
  assert.equal(session.countdown, "4 timer 7 min igjen");
});

test("says so plainly when the provider gave no reset time at all", () => {
  const now = new Date("2026-08-14T19:14:00.000Z");

  assert.deepEqual(formatResetTime(null, false, now), {
    countdown: "Starter ved neste bruk",
    absolute: "Ingen aktiv periode",
  });
  assert.deepEqual(formatResetTime(null, true, now), {
    countdown: "Nullstilling ikke oppgitt",
    absolute: "Leverandøren oppga ikke tidspunkt",
  });
  assert.equal(formatResetTime("ikke en dato", true, now).countdown, "Ugyldig nullstilling");
});

test("never counts below zero once the reset has passed", () => {
  const now = new Date("2026-08-14T19:14:00.000Z");
  assert.equal(formatResetTime("2026-08-10T00:00:00.000Z", true, now).countdown, "0 min igjen");
});
