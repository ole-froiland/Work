import test from "node:test";
import assert from "node:assert/strict";

import { createPanelOpener, nextPanelCandidate, buildMetricDetails, buildMonthDays, buildStatusChecks, calendarDayScrollMinute, clockMinutes, describeCalendarActivity, describeNextEvent, describeRepair, describeSyncAge, eventOccursOnDay, followCalendarDay, formatAppName, formatCountdown, formatMinutes, formatResetTime, formatTimer, isPanelReachable, isSocialApp, LAN_PANEL_URL, layoutDayEvents, LOCAL_PANEL_URL, LOOPBACK_PANEL_URL, needsCompanionUpdate, normalizePanelHost, notePanelAttempt, panelHostCandidates, planDay, planPanelEntry, readUsageResponse, resolvePanelRedirect, shiftCalendarDate, socialAppIconKey, summarizeAgentSessions } from "../src/dashboard.js";

function fakeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
import { createScreenWakeLockController } from "../src/wake-lock.js";

test("formats focus time safely", () => {
  assert.equal(formatTimer(45 * 60), "45:00");
  assert.equal(formatTimer(61), "01:01");
  assert.equal(formatTimer(-3), "00:00");
});

test("holder skjermen våken til bryteren slås av, og kobler til igjen etter appbytte", async () => {
  let visible = true;
  let active = false;
  const locks = [];
  const wakeLock = {
    async request(type) {
      assert.equal(type, "screen");
      const listeners = new Map();
      const lock = {
        released: false,
        addEventListener(name, listener) { listeners.set(name, listener); },
        async release() { this.released = true; listeners.get("release")?.(); },
      };
      locks.push(lock);
      return lock;
    },
  };
  const controller = createScreenWakeLockController({ wakeLock, isVisible: () => visible, onActiveChange: (next) => { active = next; } });

  assert.equal(await controller.setWanted(true), true);
  assert.equal(active, true);
  visible = false;
  await locks[0].release();
  assert.equal(active, false);
  visible = true;
  assert.equal(await controller.handleVisibilityChange(), true);
  assert.equal(locks.length, 2);
  assert.equal(active, true);
  await controller.setWanted(false);
  assert.equal(active, false);
  assert.equal(locks[1].released, true);
});

test("formats synced screen time", () => {
  assert.equal(formatMinutes(214), "3 t 34 min");
  assert.equal(formatMinutes(42), "42 min");
  assert.equal(formatMinutes(null), "Ikke synket");
});

test("explains that AI usage requires the local Mac panel when Netlify returns HTML", async () => {
  const response = new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=UTF-8" } });

  await assert.rejects(readUsageResponse(response), /ole-mac-panel\.tail161d1e\.ts\.net:4173/);
});

test("reads AI usage JSON from the local Mac panel", async () => {
  const snapshot = { codex: { ok: true }, claude: { ok: true } };
  const response = Response.json(snapshot);

  assert.deepEqual(await readUsageResponse(response), snapshot);
});

test("redirects the public panel to the Mac that owns the private data", () => {
  assert.equal(
    resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app" }),
    "http://ole-mac-panel.tail161d1e.ts.net:4173",
  );
  assert.equal(resolvePanelRedirect({ hostname: "Ole-sin-MacBook-Air.local" }), null);
});

test("allows the public shell to be opened explicitly for diagnostics", () => {
  assert.equal(resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app", search: "?public=1" }), null);
});

test("remembers an address given once, since .local dies on an iPhone hotspot", () => {
  // Hotspoten slipper ikke Bonjour mellom klientene, så navneoppslaget stopper
  // før panelet i det hele tatt lastes. Adressen settes derfor én gang.
  const storage = fakeStorage();
  assert.equal(
    resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app", search: "?host=mac.tail1234.ts.net" }, storage),
    "http://mac.tail1234.ts.net:4173",
  );
  assert.equal(
    resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app" }, storage),
    "http://mac.tail1234.ts.net:4173",
  );
});

test("stores the address even when the public shell is asked for", () => {
  const storage = fakeStorage();
  assert.equal(
    resolvePanelRedirect(
      { hostname: "ole-work-panel.netlify.app", search: "?host=172.20.10.5&public=1" },
      storage,
    ),
    null,
  );
  assert.equal(
    resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app" }, storage),
    "http://172.20.10.5:4173",
  );
});

test("refuses an address that cannot be the Mac, so the public page is no open redirect", () => {
  const storage = fakeStorage();
  assert.equal(
    resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app", search: "?host=evil.example.com" }, storage),
    "http://ole-mac-panel.tail161d1e.ts.net:4173",
  );
  assert.equal(storage.getItem("panelHost"), null);
  assert.equal(normalizePanelHost("https://evil.example.com"), null);
  assert.equal(normalizePanelHost("8.8.8.8"), null);
});

test("defaults to the tailnet address, which answers on any network", () => {
  // .local svarer bare på samme LAN. Tailscale-navnet er det eneste som svarer
  // likt hjemme, på hotspot og på mobildata, så det er standardadressen.
  assert.equal(LOCAL_PANEL_URL, "http://ole-mac-panel.tail161d1e.ts.net:4173");
  // URL-en normaliserer verten til små bokstaver — som er nøyaktig det
  // nettleserne sender, og skrivemåten allowedHosts allerede godtar.
  assert.equal(normalizePanelHost(LAN_PANEL_URL), LAN_PANEL_URL.toLowerCase());
});

test("keeps a stored address that no longer passes the check from being used", () => {
  const storage = fakeStorage();
  storage.setItem("panelHost", "http://evil.example.com:4173");
  assert.equal(
    resolvePanelRedirect({ hostname: "ole-work-panel.netlify.app" }, storage),
    "http://ole-mac-panel.tail161d1e.ts.net:4173",
  );
});

test("spør om adressen første gang i stedet for å gjette på en", () => {
  // En https-side får ikke spørre en http-adresse om den svarer, så et hopp uten
  // noe å gå på er ren gjetning. Gjetter den feil, ender Ole på nettleserens
  // feilside — der siden ikke lenger finnes og ikke kan rette seg selv.
  const storage = fakeStorage();
  const session = fakeStorage();
  const location = { hostname: "ole-work-panel.netlify.app", search: "" };

  const first = planPanelEntry({ location, storage, session, now: 1_000 });
  assert.equal(first.mode, "chooser");
  assert.equal(first.failedUrl, null);

  // Valget huskes, og da går neste åpning rett inn uten å spørre igjen.
  storage.setItem("panelHost", LAN_PANEL_URL.toLowerCase());
  const second = planPanelEntry({ location, storage, session, now: 2_000 });
  assert.equal(second.mode, "redirect");
  assert.equal(second.url, LAN_PANEL_URL.toLowerCase());
});

test("sier fra hvilken adresse som sviktet når vi kommer tilbake", () => {
  const storage = fakeStorage({ panelHost: LOCAL_PANEL_URL });
  const session = fakeStorage();
  const location = { hostname: "ole-work-panel.netlify.app", search: "" };

  notePanelAttempt(session, LOCAL_PANEL_URL, 1_000);
  const back = planPanelEntry({ location, storage, session, now: 4_000 });
  assert.equal(back.mode, "chooser");
  assert.equal(back.failedUrl, LOCAL_PANEL_URL);

  // Sporet brukes én gang: den huskede adressen skal prøves igjen neste gang,
  // ikke bli stående i velgeren for alltid.
  assert.equal(planPanelEntry({ location, storage, session, now: 5_000 }).mode, "redirect");
});

test("glemmer et gammelt forsøk, så en ny økt ikke starter i velgeren", () => {
  const session = fakeStorage();
  notePanelAttempt(session, LOCAL_PANEL_URL, 1_000);
  const plan = planPanelEntry({
    location: { hostname: "ole-work-panel.netlify.app", search: "" },
    storage: fakeStorage({ panelHost: LOCAL_PANEL_URL }),
    session,
    now: 1_000 + 120_000,
  });
  assert.equal(plan.mode, "redirect");
});

test("prøver en nyskrevet adresse selv rett etter at en annen feilet", () => {
  const session = fakeStorage();
  notePanelAttempt(session, LOCAL_PANEL_URL, 1_000);
  const plan = planPanelEntry({
    location: { hostname: "ole-work-panel.netlify.app", search: "?host=192.168.1.40" },
    storage: fakeStorage(),
    session,
    now: 2_000,
  });
  assert.equal(plan.mode, "redirect");
  assert.equal(plan.url, "http://192.168.1.40:4173");
});

test("avbryter et hopp som aldri svarer, i stedet for å spinne over en tom side", () => {
  // Slår navnet opp uten at noen svarer på porten, kommer det ingen feilside:
  // navigeringen blir hengende, adressefeltet står igjen på Netlify-adressen og
  // fanen spinner. Det var dette som så ut som en blank skjerm.
  const replaced = [];
  const session = fakeStorage();
  const storage = fakeStorage();
  const stalled = [];
  let pending = null;
  const openPanel = createPanelOpener({
    location: { replace: (url) => replaced.push(url) },
    storage,
    session,
    onStalled: (url) => stalled.push(url),
    setTimer: (callback) => { pending = callback; },
    now: () => 1_000,
  });

  assert.equal(openPanel("192.168.1.40", { remember: true }), "http://192.168.1.40:4173");
  assert.deepEqual(replaced, ["http://192.168.1.40:4173"]);
  assert.equal(storage.getItem("panelHost"), "http://192.168.1.40:4173");
  assert.deepEqual(stalled, []);

  pending();
  assert.deepEqual(stalled, ["http://192.168.1.40:4173"]);
  // Sporet er lagt igjen, så en feilside og et tilbaketrykk gir samme velger.
  assert.equal(
    planPanelEntry({ location: { hostname: "ole-work-panel.netlify.app", search: "" }, storage, session, now: 2_000 }).mode,
    "chooser",
  );
});

test("nekter å hoppe til en adresse som ikke kan være Mac-en", () => {
  const replaced = [];
  const openPanel = createPanelOpener({ location: { replace: (url) => replaced.push(url) } });
  assert.equal(openPanel("evil.example.com"), null);
  assert.deepEqual(replaced, []);
});

test("tilbyr en adresse for hvert nett panelet kan åpnes fra", () => {
  // Tailnettet krever Tailscale i begge ender, .local krever samme wifi, og
  // loopback finnes bare på Mac-en. Ingen av dem svarer overalt alene.
  const urls = panelHostCandidates({ stored: "http://192.168.1.40:4173" }).map((candidate) => candidate.url);
  assert.deepEqual(urls, [
    "http://192.168.1.40:4173",
    LAN_PANEL_URL.toLowerCase(),
    LOCAL_PANEL_URL,
    LOOPBACK_PANEL_URL,
  ]);
  // Er den lagrede adressen allerede i lista, skal den ikke stå der to ganger.
  assert.equal(panelHostCandidates({ stored: LOCAL_PANEL_URL }).length, 3);
});

test("går videre til neste adresse selv når en henger", () => {
  // iPad-en har husket .local og drar på mobildata. Da svarer ikke Bonjour-navnet
  // lenger, men tailnettet gjør det — og det skal skje uten at noen rører den.
  const candidates = panelHostCandidates({ stored: LAN_PANEL_URL });
  const first = candidates[0].url;
  assert.equal(first, LAN_PANEL_URL.toLowerCase());

  const second = nextPanelCandidate(candidates, [first]);
  assert.equal(second.url, LOCAL_PANEL_URL);
  assert.equal(nextPanelCandidate(candidates, [first, LOCAL_PANEL_URL]).url, LOOPBACK_PANEL_URL);
  // Når ingen står igjen, er det først da det er noe å spørre om.
  assert.equal(nextPanelCandidate(candidates, candidates.map((c) => c.url)), null);
});

test("kjenner igjen panelet på maskinen siden åpnes fra", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return { ok: true, json: async () => ({ panel: true }) };
  };
  assert.equal(await isPanelReachable(LOOPBACK_PANEL_URL, { fetchImpl }), true);
  assert.deepEqual(asked, [`${LOOPBACK_PANEL_URL}/api/panel-hello`]);
});

test("regner en adresse som ubrukelig når noe annet enn panelet svarer", async () => {
  assert.equal(
    await isPanelReachable(LOOPBACK_PANEL_URL, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    false,
  );
  assert.equal(
    await isPanelReachable(LOOPBACK_PANEL_URL, { fetchImpl: async () => ({ ok: false, json: async () => ({ panel: true }) }) }),
    false,
  );
  // En https-side som nektes å hente fra http kaster. Da skal panelet falle
  // tilbake til den vanlige adressen, ikke stoppe opp.
  assert.equal(
    await isPanelReachable(LOOPBACK_PANEL_URL, { fetchImpl: async () => { throw new Error("blocked"); } }),
    false,
  );
});

test("fills in the panel port when the address is given without one", () => {
  assert.equal(normalizePanelHost("mac.tail1234.ts.net"), "http://mac.tail1234.ts.net:4173");
  assert.equal(normalizePanelHost("192.168.1.40:8080"), "http://192.168.1.40:8080");
  assert.equal(normalizePanelHost("  "), null);
  assert.equal(normalizePanelHost(null), null);
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

test("places overlapping day events side by side without shrinking separate events", () => {
  const events = [
    { id: "a", start: "2026-08-24T09:00:00+02:00", end: "2026-08-24T10:00:00+02:00" },
    { id: "b", start: "2026-08-24T09:15:00+02:00", end: "2026-08-24T10:00:00+02:00" },
    { id: "c", start: "2026-08-24T10:00:00+02:00", end: "2026-08-24T11:00:00+02:00" },
  ];

  assert.deepEqual(layoutDayEvents(events).map(({ event, column, columnCount }) => [event.id, column, columnCount]), [
    ["a", 0, 2],
    ["b", 1, 2],
    ["c", 0, 1],
  ]);
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

test("dagsvisningen følger med over midnatt i stedet for å bli stående på i går", () => {
  const trackedToday = new Date("2026-08-22T23:59:00+02:00");
  const now = new Date("2026-08-23T00:01:00+02:00");
  const rollover = followCalendarDay(new Date("2026-08-22T09:00:00+02:00"), trackedToday, now);

  assert.equal(rollover.rolled, true);
  assert.equal(rollover.date.getDate(), 23);
  assert.equal(rollover.today.getDate(), 23);
});

test("en dag Ole selv har bladd seg fram til blir stående når døgnet skifter", () => {
  const trackedToday = new Date("2026-08-22T23:59:00+02:00");
  const now = new Date("2026-08-23T00:01:00+02:00");
  const chosen = new Date("2026-08-28T09:00:00+02:00");
  const rollover = followCalendarDay(chosen, trackedToday, now);

  assert.equal(rollover.rolled, false);
  assert.equal(rollover.date, chosen);
  // Panelet måler neste skifte mot den nye dagen, ellers ville hvert tikk
  // resten av døgnet melde om et døgnskifte som allerede er behandlet.
  assert.equal(rollover.today.getDate(), 23);
});

test("en iPad som har sovet i flere døgn våkner på den ekte dagen", () => {
  const trackedToday = new Date("2026-08-20T22:00:00+02:00");
  const now = new Date("2026-08-23T07:30:00+02:00");
  const rollover = followCalendarDay(new Date("2026-08-20T09:00:00+02:00"), trackedToday, now);

  assert.equal(rollover.rolled, true);
  assert.equal(rollover.date.getDate(), 23);
});

test("samme døgn rører ikke datoen, uansett hvor mange ganger klokka tikker", () => {
  const trackedToday = new Date("2026-08-23T07:30:00+02:00");
  const chosen = new Date("2026-08-23T09:00:00+02:00");
  const rollover = followCalendarDay(chosen, trackedToday, new Date("2026-08-23T18:00:00+02:00"));

  assert.equal(rollover.rolled, false);
  assert.equal(rollover.date, chosen);
  assert.equal(rollover.today, trackedToday);
});

test("Kalender-raden sier hvorfor lesingen feilet i stedet for å telle opp gamle hendelser", () => {
  const now = new Date("2026-08-23T11:45:00.000Z");
  const checks = buildStatusChecks({
    syncCalendar: {
      connected: true,
      events: [{ id: "a" }, { id: "b" }],
      appleError: "Panelet mangler tilgang til Apple Kalender (status 4)",
    },
  }, now);

  assert.equal(checks[0].ok, false);
  assert.equal(checks[0].detail, "Panelet mangler tilgang til Apple Kalender (status 4)");
});

const malen = {
  wakeAnchor: "07:00",
  dayEnd: "23:00",
  blocks: [
    { id: "morgen", title: "Morgenrutine", minutes: 30, tone: "sky" },
    { id: "lese", title: "Lese BUS400N", minutes: 90, tone: "violet" },
  ],
};
const dagen = new Date(2026, 7, 28);

function tid(timer, minutter = 0) {
  return new Date(2026, 7, 28, timer, minutter).toISOString();
}

test("leser klokkeslett, og avviser det som ikke er et", () => {
  assert.equal(clockMinutes("07:00"), 420);
  assert.equal(clockMinutes("23:59"), 1439);
  assert.equal(clockMinutes("24:00"), null);
  assert.equal(clockMinutes("7:5"), null);
  assert.equal(clockMinutes(""), null);
  assert.equal(clockMinutes(undefined), null);
});

test("uten oppvåkning legges malen ut fra sitt eget ankertidspunkt", () => {
  const { placed, dropped, shift } = planDay({ template: malen, wokeAt: null, anchors: [], day: dagen });
  assert.equal(shift, 0);
  assert.deepEqual(dropped, []);
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.endMinute]), [
    ["morgen", 420, 450],
    ["lese", 450, 540],
  ]);
});

test("står Ole opp tidligere enn malen, skyves ingenting bakover", () => {
  const { placed, shift } = planDay({ template: malen, wokeAt: tid(5, 30), anchors: [], day: dagen });
  assert.equal(shift, 0);
  assert.equal(placed[0].startMinute, 420);
});

test("alle bolker skyves like langt når det ikke finnes ankre", () => {
  const { placed, shift } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [], day: dagen });
  assert.equal(shift, 160);
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.endMinute]), [
    ["morgen", 580, 610],
    ["lese", 610, 700],
  ]);
});

test("en bolk som treffer et anker legges etter ankeret, ikke oppå", () => {
  const forelesning = { id: "f1", title: "Forelesning", start: tid(10, 0), end: tid(12, 0) };
  const { placed } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [forelesning], day: dagen });
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.endMinute]), [
    ["morgen", 720, 750],
    ["lese", 750, 840],
  ]);
});

test("en heldagsavtale er ingen tidsbegrensning og teller ikke som anker", () => {
  const bursdag = { id: "b1", title: "Bursdag", allDay: true, start: tid(0, 0), end: tid(23, 59) };
  const { placed } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [bursdag], day: dagen });
  assert.equal(placed.length, 2);
  assert.equal(placed[0].startMinute, 580);
});

test("en bolk som ikke får plass før dagen er over havner i dropped", () => {
  const { placed, dropped } = planDay({ template: malen, wokeAt: tid(22, 0), anchors: [], day: dagen });
  assert.deepEqual(placed.map((block) => block.id), ["morgen"]);
  assert.deepEqual(dropped.map((block) => block.id), ["lese"]);
});

test("en kort bolk etter en droppet bolk får fortsatt plass", () => {
  const template = {
    ...malen,
    blocks: [
      { id: "lang", title: "Lang", minutes: 120 },
      { id: "kort", title: "Kort", minutes: 15 },
    ],
  };
  const { placed, dropped } = planDay({ template, wokeAt: tid(22, 0), anchors: [], day: dagen });
  assert.deepEqual(dropped.map((block) => block.id), ["lang"]);
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute]), [["kort", 1320]]);
});

test("en avhuket bolk beholder tidspunktet den faktisk ble gjort på", () => {
  const done = [{ id: "morgen", at: tid(10, 5) }];
  const { placed } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [], day: dagen, done });
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.done]), [
    ["morgen", 605, true],
    ["lese", 635, false],
  ]);
});

test("en mal uten bolker gir en tom plan i stedet for å kaste", () => {
  const { placed, dropped, shift } = planDay({ template: { wakeAnchor: "07:00", dayEnd: "23:00", blocks: [] }, day: dagen });
  assert.deepEqual({ placed, dropped, shift }, { placed: [], dropped: [], shift: 0 });
});
