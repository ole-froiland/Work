import test from "node:test";
import assert from "node:assert/strict";

import { buildMetricDetails, buildMonthDays, buildStatusChecks, calendarDayScrollMinute, describeCalendarActivity, describeNextEvent, describeRepair, describeSyncAge, eventOccursOnDay, formatAppName, formatCountdown, formatMinutes, formatResetTime, formatTimer, isSocialApp, needsCompanionUpdate, readUsageResponse, resolvePanelRedirect, shiftCalendarDate, socialAppIconKey, summarizeAgentSessions } from "../src/dashboard.js";

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

test("counts social apps as social, whether iPhone sends a name or a bundle id", () => {
  assert.equal(isSocialApp("com.burbn.instagram"), true);
  assert.equal(isSocialApp("TikTok"), true);
  assert.equal(isSocialApp("com.atebits.Tweetie2"), true);
  assert.equal(isSocialApp("X"), true);
  assert.equal(isSocialApp("Safari"), false);
  assert.equal(isSocialApp("com.openai.chat"), false);
  assert.equal(isSocialApp(undefined), false);
});

test("assigns recognizable icons to social apps and a safe fallback", () => {
  assert.equal(socialAppIconKey("com.burbn.instagram"), "instagram");
  assert.equal(socialAppIconKey("Twitter"), "x");
  assert.equal(socialAppIconKey("BeReal"), "app");
});

test("separates an outdated companion from a phone that stopped syncing", () => {
  const now = new Date("2026-08-15T15:00:00+02:00");
  const source = { provider: "DeviceActivity", observedAt: "2026-08-15T13:38:00+02:00" };

  // Synker fint, men sender gammelt format: appen må byttes ut, ikke nettet.
  assert.equal(needsCompanionUpdate({ screenTime: {}, sources: { screenTime: source } }, now), true);
  // Har sendt sosialtid: alt er som det skal.
  assert.equal(needsCompanionUpdate({ screenTime: { socialMinutes: 12 }, sources: { screenTime: source } }, now), false);
  // Har ikke sendt på to døgn: da er det synken som er problemet.
  assert.equal(needsCompanionUpdate({
    screenTime: {},
    sources: { screenTime: { provider: "DeviceActivity", observedAt: "2026-08-13T13:38:00+02:00" } },
  }, now), false);
  // Har aldri sendt noe: heller ikke en utdatert app.
  assert.equal(needsCompanionUpdate({ screenTime: {}, sources: {} }, now), false);
});

test("keeps non-social apps out of the list even if an old sync sent them", () => {
  const metrics = {
    screenTime: {
      socialMinutes: 150,
      socialWeeklyAverageMinutes: 180,
      topApps: [
        { name: "Safari", minutes: 90 },
        { name: "Instagram", minutes: 80 },
        { name: "com.openai.chat", minutes: 40 },
        { name: "Snapchat", minutes: 20 },
      ],
    },
    sources: { screenTime: { observedAt: "2026-08-14T12:00:00+02:00" } },
  };

  assert.deepEqual(buildMetricDetails("screenTime", metrics).apps, [
    { name: "Instagram", icon: "instagram", value: "1 t 20 min" },
    { name: "Snapchat", icon: "snapchat", value: "20 min" },
  ]);
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

test("steps one day, one week or one whole month at a time", () => {
  const saturday = new Date(2026, 7, 22);
  assert.equal(+shiftCalendarDate(saturday, "day", 1), +new Date(2026, 7, 23));
  assert.equal(+shiftCalendarDate(saturday, "week", -1), +new Date(2026, 7, 15));
  assert.equal(+shiftCalendarDate(saturday, "month", 1), +new Date(2026, 8, 22));
});

test("lands in the next month, not thirty days ahead", () => {
  // 31. mars + 30 dager er 30. april, og et sveip til hoppet forbi hele april.
  assert.equal(+shiftCalendarDate(new Date(2027, 2, 31), "month", 1), +new Date(2027, 3, 30));
  assert.equal(+shiftCalendarDate(new Date(2027, 4, 31), "month", -1), +new Date(2027, 3, 30));
});

test("opens the day at the current hour instead of at midnight", () => {
  const today = new Date(2026, 7, 22, 14, 30);
  assert.equal(calendarDayScrollMinute(today, [], today), 13 * 60 + 30);
});

test("opens another day at its first activity", () => {
  const events = [
    { id: "b", start: "2026-08-24T12:15:00", end: "2026-08-24T13:00:00" },
    { id: "a", start: "2026-08-24T09:45:00", end: "2026-08-24T10:30:00" },
    { id: "c", start: "2026-08-25T06:00:00", end: "2026-08-25T07:00:00" },
  ];
  assert.equal(calendarDayScrollMinute(new Date(2026, 7, 24), events, new Date(2026, 7, 22, 20, 0)), 8 * 60 + 45);
});

test("falls back to a normal morning on an empty day, and never scrolls above midnight", () => {
  const empty = new Date(2026, 7, 24);
  const now = new Date(2026, 7, 22, 20, 0);
  assert.equal(calendarDayScrollMinute(empty, [], now), 7 * 60);
  assert.equal(calendarDayScrollMinute(now, [], new Date(2026, 7, 22, 0, 20)), 0);
});

test("ignores all-day entries when deciding where the day opens", () => {
  const events = [
    { id: "trip", start: "2026-08-24T00:00:00", end: "2026-08-26T00:00:00", allDay: true },
    { id: "gym", start: "2026-08-24T10:00:00", end: "2026-08-24T11:00:00" },
  ];
  assert.equal(calendarDayScrollMinute(new Date(2026, 7, 24), events, new Date(2026, 7, 22, 20, 0)), 9 * 60);
});

test("builds honest metric details from synced device values", () => {
  const metrics = {
    screenTime: { socialMinutes: 304, socialWeeklyAverageMinutes: 300, topApps: [{ name: "Instagram", minutes: 91 }] },
    steps: { today: 158, weeklyAverage: 797 },
    weather: { ok: true, label: "Mosterøy", temperature: 19, apparentTemperature: 18, condition: "Overskyet", locationSource: "device" },
    sources: {
      screenTime: { observedAt: "2026-08-12T12:00:00+02:00" },
      steps: { observedAt: "2026-08-12T12:00:00+02:00" },
      location: { provider: "CoreLocation" },
    },
  };
  assert.equal(buildMetricDetails("screenTime", metrics).title, "Sosiale medier");
  assert.equal(buildMetricDetails("screenTime", metrics).summary, "5 t 04 min");
  assert.deepEqual(buildMetricDetails("screenTime", metrics).apps, [{ name: "Instagram", icon: "instagram", value: "1 t 31 min" }]);
  assert.deepEqual(buildMetricDetails("steps", metrics).rows[2], ["Mot snittet", "80 % under snittet"]);
  assert.deepEqual(buildMetricDetails("weather", metrics).rows[3], ["Posisjonskilde", "iPhone"]);
});

test("admits the weather is the fallback once the phone's position goes stale", () => {
  // Kilden blir stående i mellomlageret lenge etter at posisjonen er for gammel
  // til å brukes. Spør man den, sier kortet «iPhone» mens det viser Mosterøy.
  const metrics = {
    weather: { ok: true, label: "Mosterøy", temperature: 13, apparentTemperature: 8, condition: "Overskyet", locationSource: "fallback" },
    sources: { location: { provider: "CoreLocation", observedAt: "2026-08-21T14:22:54.000Z" } },
  };
  assert.deepEqual(buildMetricDetails("weather", metrics).rows[3], ["Posisjonskilde", "Mosterøy-reserve"]);
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

test("shows the activity in progress together with the next activity", () => {
  const now = new Date(2026, 7, 14, 11, 15);
  const activity = describeCalendarActivity([
    localEvent("Skole", 10, 12),
    localEvent("Trening", 13, 14),
    localEvent("Ferdig", 8, 9),
  ], now);

  assert.equal(activity.current.title, "Skole");
  assert.equal(activity.current.when, "Slutter 12:00");
  assert.equal(activity.current.remaining, "45 min igjen");
  assert.equal(activity.next.title, "Trening");
  assert.equal(activity.next.countdown, "om 1 t 45 min");
});

test("uses the ordinary next activity when nothing is in progress", () => {
  const now = new Date(2026, 7, 14, 11, 15);
  const activity = describeCalendarActivity([localEvent("Trening", 13, 14)], now);

  assert.equal(activity.current, null);
  assert.equal(activity.next.title, "Trening");
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

test("says how long ago the phone last synced instead of only 'not synced'", () => {
  const now = new Date("2026-08-14T21:45:00.000Z");
  const at = (iso) => ({ provider: "HealthKit", observedAt: iso });

  assert.equal(describeSyncAge(at("2026-08-14T21:20:00.000Z"), now), "Sist synket for 25 min siden");
  assert.equal(describeSyncAge(at("2026-08-14T18:45:00.000Z"), now), "Sist synket for 3 timer siden");
  assert.equal(describeSyncAge(at("2026-08-14T20:45:00.000Z"), now), "Sist synket for 1 time siden");
  assert.equal(describeSyncAge(at("2026-08-12T14:56:00.000Z"), now), "Sist synket for 2 døgn siden");
});

test("falls back to naming the source when the phone has never synced", () => {
  const now = new Date("2026-08-14T21:45:00.000Z");

  assert.equal(describeSyncAge(undefined, now, "HealthKit · Apple Helse"), "HealthKit · Apple Helse");
  assert.equal(describeSyncAge({ provider: "HealthKit" }, now, "reserve"), "reserve");
  assert.equal(describeSyncAge({ observedAt: "2026-08-14T21:20:00.000Z" }, now, "reserve"), "reserve");
});

test("reports every connection with what to do about it", () => {
  const now = new Date("2026-08-15T11:45:00.000Z");
  const checks = buildStatusChecks({
    syncCalendar: { connected: true, events: [{ id: "a" }, { id: "b" }] },
    syncNotes: { connected: true, notes: [{ id: "n" }] },
    deviceMetrics: { syncConnected: true },
    usage: { codex: { ok: true }, claude: { ok: true } },
  }, now);

  assert.deepEqual(checks.map((check) => check.id), ["calendar", "notes", "mobile", "codex", "claude"]);
  assert.equal(checks.every((check) => check.ok), true);
  assert.equal(checks[0].detail, "2 hendelser hentet");
});

test("explains each broken connection instead of only flagging it", () => {
  const now = new Date("2026-08-15T11:45:00.000Z");
  const checks = buildStatusChecks({
    syncCalendar: { connected: false, events: [] },
    syncNotes: { connected: false, notes: [] },
    deviceMetrics: { syncConnected: false, sources: { steps: { provider: "HealthKit", observedAt: "2026-08-13T11:45:00.000Z" } } },
    usage: { codex: { ok: false, error: "Codex er ikke innlogget" }, claude: { ok: true } },
  }, now);

  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(checks.filter((check) => !check.ok).length, 4);
  assert.equal(byId.calendar.detail, "Åpne Kalender på Mac-en");
  assert.equal(byId.notes.detail, "Åpne Sync på Mac-en");
  assert.match(byId.mobile.detail, /Sist synket for 2 døgn siden\. Åpne Panelkobling/);
  assert.equal(byId.codex.detail, "Codex er ikke innlogget");
  assert.equal(byId.claude.ok, true);
});

test("does not claim a fault before the data has loaded", () => {
  const checks = buildStatusChecks({}, new Date("2026-08-15T11:45:00.000Z"));
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  assert.equal(byId.codex.detail, "Henter kvotedata …");
  assert.equal(byId.mobile.detail, "Har aldri sendt. Åpne Panelkobling på iPhonen.");
});

test("answers whether Claude is working, and on how many tasks", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const summary = summarizeAgentSessions({
    ok: true,
    updatedAt: now.toISOString(),
    sessions: [
      { id: "a", provider: "claude", title: "NHH-notater", project: "nhh", state: "working", activity: "Endrer filer", lastActivityAt: "2026-08-21T11:59:55.000Z" },
      { id: "b", provider: "claude", title: "Panelkortet", project: "Work", state: "working", activity: "Kjører kommandoer", lastActivityAt: "2026-08-21T11:58:00.000Z" },
      { id: "c", provider: "claude", title: "Mac performance", project: "test12", state: "done", lastActivityAt: "2026-08-21T10:35:00.000Z" },
    ],
  }, now);

  assert.equal(summary.headline, "Claude jobber med 2 oppgaver");
  assert.equal(summary.activeCount, 2);
  assert.equal(summary.sessions[0].detail, "Endrer filer · nå");
  assert.equal(summary.sessions[1].detail, "Kjører kommandoer · 2 min siden");
  assert.equal(summary.sessions[2].project, "test12");
  // Raden har allerede merkelappen «Ferdig». Detaljen sier bare når.
  assert.equal(summary.sessions[2].detail, "1 time siden");
  assert.equal(summary.sessions[2].label, "Ferdig");
});

test("counts both assistants together when Codex is running too", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const summary = summarizeAgentSessions({
    ok: true,
    sessions: [
      { id: "a", provider: "claude", state: "working", title: "Panelkortet", activity: "Leser filer", lastActivityAt: "2026-08-21T11:59:50.000Z" },
      { id: "b", provider: "codex", state: "working", title: "Push til main", activity: "Kjører kommandoer", lastActivityAt: "2026-08-21T11:59:40.000Z" },
    ],
  }, now);

  assert.equal(summary.headline, "2 oppgaver kjører");
});

test("says plainly when nothing is running", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  assert.equal(summarizeAgentSessions({ ok: true, sessions: [] }, now).headline, "Ingen økter de siste åtte timene");
  assert.equal(summarizeAgentSessions({ ok: true, sessions: [] }, now).empty, true);
  assert.equal(
    summarizeAgentSessions({ ok: true, sessions: [{ id: "c", provider: "claude", state: "done", title: "Ferdig sak", lastActivityAt: "2026-08-21T11:30:00.000Z" }] }, now).headline,
    "1 oppgave er ferdig",
  );
  assert.equal(summarizeAgentSessions(null, now).headline, "Henter økter …");
});

test("marks a session that stopped mid-task instead of showing it as active", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const summary = summarizeAgentSessions({
    ok: true,
    sessions: [{ id: "a", provider: "claude", state: "stalled", title: "Venter", activity: "Kjører kommandoer", lastActivityAt: "2026-08-21T11:40:00.000Z" }],
  }, now);

  assert.equal(summary.headline, "1 oppgave er avsluttet");
  assert.equal(summary.sessions[0].detail, "20 min siden");
  assert.equal(summary.sessions[0].label, "Avsluttet");
  assert.equal(summary.sessions[0].tone, "ended");
});

test("never repeats the state chip in the line under it", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const summary = summarizeAgentSessions({
    ok: true,
    sessions: [
      { id: "a", provider: "claude", state: "done", title: "Ferdig", lastActivityAt: "2026-08-21T11:00:00.000Z" },
      { id: "b", provider: "codex", state: "needs_input", title: "Spør", lastActivityAt: "2026-08-21T11:55:00.000Z" },
      { id: "c", provider: "claude", state: "stalled", title: "Stoppet", lastActivityAt: "2026-08-21T11:30:00.000Z" },
    ],
  }, now);

  for (const session of summary.sessions) {
    assert.equal(session.detail.includes("·"), false, `${session.title} gjentar tilstanden`);
    assert.match(session.detail, /siden$/);
  }
});

test("shows the panel error instead of pretending nothing runs", () => {
  const summary = summarizeAgentSessions({ ok: false, error: "Åpne panelet på Mac-en", sessions: [] }, new Date());

  assert.equal(summary.headline, "Åpne panelet på Mac-en");
});

test("names the underagent when Claude delegates a task", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const summary = summarizeAgentSessions({
    ok: true,
    sessions: [{ id: "a", provider: "claude", state: "working", title: "Stor jobb", activity: "Kjører en underagent", subagent: true, lastActivityAt: "2026-08-21T11:59:00.000Z" }],
  }, now);

  assert.equal(summary.sessions[0].detail, "Underagent jobber · 1 min siden");
});

test("labels each session with the state word the card shows", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const summary = summarizeAgentSessions({
    ok: true,
    sessions: [
      { id: "a", provider: "claude", state: "working", title: "Kjører", activity: "Leser filer", lastActivityAt: "2026-08-21T11:59:50.000Z" },
      { id: "b", provider: "claude", state: "stalled", title: "Fast", activity: "Kjører kommandoer", lastActivityAt: "2026-08-21T11:30:00.000Z" },
      { id: "c", provider: "codex", state: "needs_input", title: "Spørsmål", project: "Work", lastActivityAt: "2026-08-21T11:45:00.000Z" },
    ],
  }, now);

  assert.deepEqual(summary.sessions.map((session) => session.label), ["Jobber", "Avsluttet", "Trenger svar"]);
  assert.equal(summary.count, 3);
  assert.equal(summary.activeCount, 1);
});

test("en reparert rad viser hva som faktisk ble gjort", () => {
  const result = describeRepair({ id: "calendar", ok: true, detail: "76 hendelser hentet" });
  assert.deepEqual(result, { ok: true, detail: "76 hendelser hentet", next: null });
});

test("en rad som står fast beholder det ene steget som gjenstår", () => {
  const result = describeRepair({
    id: "claude",
    ok: false,
    detail: "Påloggingen må fornyes på Mac-en",
    next: { action: "claude-login", label: "Åpne Terminal med claude" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.next.action, "claude-login");
});

test("en utdatert companion-app får sin egen forklaring, ikke «for gamle verdier»", () => {
  const now = new Date("2026-08-15T13:38:00+02:00");
  const result = describeRepair({
    id: "mobile",
    ok: false,
    detail: "Siste verdier er for gamle. Åpne Panelkobling på iPhonen.",
    metrics: {
      screenTime: {},
      sources: { screenTime: { provider: "DeviceActivity", observedAt: "2026-08-15T09:00:00+02:00" } },
    },
  }, now);
  assert.match(result.detail, /for gammel/);
  assert.equal(result.next, null);
});

test("en iPhone som bare ikke har sendt beholder serverens forklaring", () => {
  const now = new Date("2026-08-15T13:38:00+02:00");
  const result = describeRepair({
    id: "mobile",
    ok: false,
    detail: "iPhonen har aldri sendt verdier. Åpne Panelkobling på iPhonen.",
    metrics: { screenTime: {}, sources: {} },
  }, now);
  assert.match(result.detail, /aldri sendt/);
});
