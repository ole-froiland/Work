import test from "node:test";
import assert from "node:assert/strict";

import {
  FOCUS_SESSION_KEY,
  createFocusSession,
  describeFocusEvent,
  focusPhaseProgress,
  focusSecondsLeft,
  loadFocusSession,
  pauseFocusSession,
  readFocusSettings,
  resumeFocusSession,
  saveFocusSession,
  settleFocusSession,
  skipFocusPhase,
  startFocusSession,
  stopFocusSession,
} from "../src/focus-session.js";

const MIN = 60_000;
const T0 = Date.parse("2026-09-09T09:00:00Z");

function fakeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function økt(overrides = {}) {
  return createFocusSession({ workMinutes: 25, breakMinutes: 5, sets: 2, activity: "Matte", ...overrides });
}

test("en ny økt står stille på arbeidslengden", () => {
  const session = økt();
  assert.equal(session.phase, "idle");
  assert.equal(session.running, false);
  assert.equal(focusSecondsLeft(session, T0), 25 * 60);
});

test("starten legger sluttpunktet på klokka, ikke en nedtelling", () => {
  const session = startFocusSession(økt(), T0);
  assert.equal(session.phase, "work");
  assert.equal(session.endsAt, T0 + 25 * MIN);
  assert.equal(focusSecondsLeft(session, T0), 25 * 60);
  assert.equal(focusSecondsLeft(session, T0 + 10 * MIN), 15 * 60);
});

// Dette er hele grunnen til at modulen finnes. Safari fryser tidtakerne når
// telefonen låses; en nedtelling som trekker fra ett sekund om gangen står
// derfor stille i lomma, og økta lyver om hvor langt den er kommet.
test("tiden går selv om ingenting har fått tikke", () => {
  const session = startFocusSession(økt({ workMinutes: 45 }), T0);
  const { session: etter, events } = settleFocusSession(session, T0 + 20 * MIN);
  assert.equal(events.length, 0);
  assert.equal(etter.phase, "work");
  assert.equal(focusSecondsLeft(etter, T0 + 20 * MIN), 25 * 60);
});

test("en fase som gikk ut mens skjermen var av, går over til pause", () => {
  const session = startFocusSession(økt(), T0);
  const { session: etter, events } = settleFocusSession(session, T0 + 26 * MIN);
  assert.deepEqual(events, [{ type: "break", minutes: 5 }]);
  assert.equal(etter.phase, "break");
  assert.equal(etter.set, 1);
  // Pausen begynte da økta sluttet, ikke da telefonen ble hentet fram igjen.
  assert.equal(etter.endsAt, T0 + 30 * MIN);
  assert.equal(focusSecondsLeft(etter, T0 + 26 * MIN), 4 * 60);
});

// En telefon kan ligge i timevis. Da er det ikke ett steg som har gått, men
// alle stegene som fikk plass i fraværet.
test("et langt fravær rulles gjennom alle fasene det rakk", () => {
  const session = startFocusSession(økt(), T0);
  const { session: etter, events } = settleFocusSession(session, T0 + 32 * MIN);
  assert.deepEqual(events, [
    { type: "break", minutes: 5 },
    { type: "work", set: 2, sets: 2 },
  ]);
  assert.equal(etter.phase, "work");
  assert.equal(etter.set, 2);
  assert.equal(etter.endsAt, T0 + 55 * MIN);
});

test("en økt som ble ferdig mens telefonen lå, står som ferdig", () => {
  const session = startFocusSession(økt(), T0);
  const { session: etter, events } = settleFocusSession(session, T0 + 3 * 60 * MIN);
  assert.equal(events.at(-1).type, "done");
  assert.equal(etter.phase, "idle");
  assert.equal(etter.running, false);
  assert.equal(etter.set, 1);
  assert.equal(etter.endsAt, null);
  assert.equal(focusSecondsLeft(etter, T0 + 3 * 60 * MIN), 25 * 60);
});

test("en økt på pause står stille uansett hvor lenge den blir liggende", () => {
  const startet = startFocusSession(økt(), T0);
  const pauset = pauseFocusSession(startet, T0 + 5 * MIN);
  assert.equal(pauset.running, false);
  assert.equal(pauset.endsAt, null);
  assert.equal(focusSecondsLeft(pauset, T0 + 5 * MIN), 20 * 60);
  assert.equal(focusSecondsLeft(pauset, T0 + 90 * MIN), 20 * 60);
  assert.deepEqual(settleFocusSession(pauset, T0 + 90 * MIN).events, []);

  const fortsatt = resumeFocusSession(pauset, T0 + 90 * MIN);
  assert.equal(fortsatt.running, true);
  assert.equal(fortsatt.endsAt, T0 + 110 * MIN);
});

test("et hopp gir neste fase hele lengden sin fra nå", () => {
  const session = startFocusSession(økt(), T0);
  const { session: etter, events } = skipFocusPhase(session, T0 + 3 * MIN);
  assert.deepEqual(events, [{ type: "break", minutes: 5 }]);
  assert.equal(etter.phase, "break");
  assert.equal(etter.endsAt, T0 + 8 * MIN);
});

test("siste sett hopper til ferdig, ikke til en tredje runde", () => {
  const session = { ...startFocusSession(økt(), T0), phase: "work", set: 2 };
  const { session: etter, events } = skipFocusPhase(session, T0);
  assert.deepEqual(events, [{ type: "done" }]);
  assert.equal(etter.phase, "idle");
});

test("avslutt setter økta tilbake til utgangspunktet", () => {
  const session = startFocusSession(økt(), T0);
  const etter = stopFocusSession(settleFocusSession(session, T0 + 26 * MIN).session);
  assert.equal(etter.phase, "idle");
  assert.equal(etter.set, 1);
  assert.equal(etter.activity, "Matte");
  assert.equal(focusSecondsLeft(etter, T0), 25 * 60);
});

test("ett sett har ingen pause i seg", () => {
  const session = startFocusSession(økt({ sets: 1 }), T0);
  const { session: etter, events } = settleFocusSession(session, T0 + 26 * MIN);
  assert.deepEqual(events, [{ type: "done" }]);
  assert.equal(etter.phase, "idle");
});

test("stripa fyller seg gjennom fasen og aldri utenfor den", () => {
  const session = startFocusSession(økt(), T0);
  assert.equal(focusPhaseProgress(session, T0), 0);
  assert.ok(Math.abs(focusPhaseProgress(session, T0 + 12.5 * MIN) - 0.5) < 0.01);
  assert.equal(focusPhaseProgress(session, T0 + 25 * MIN), 1);
  assert.equal(focusPhaseProgress(session, T0 + 90 * MIN), 1);
  assert.equal(focusPhaseProgress(økt(), T0), 0);
});

test("lengder utenfor grensene blir trukket inn, aldri til null", () => {
  const session = createFocusSession({ workMinutes: 0, breakMinutes: -5, sets: 0 });
  assert.ok(session.workMinutes >= 1);
  assert.ok(session.breakMinutes >= 1);
  assert.ok(session.sets >= 1);
});

// En fase uten varighet slutter i samme øyeblikk den begynner. Uten grensen
// over ville framrullingen aldri nådd fram til nå, og panelet stått og malt.
test("en økt med ubrukelige lengder ruller ikke i evig tid", () => {
  const ødelagt = { ...økt(), phase: "work", running: true, set: 1, sets: 2, workMinutes: 0, breakMinutes: 0, endsAt: T0 };
  const { session: etter } = settleFocusSession(ødelagt, T0 + 60 * MIN);
  assert.equal(etter.phase, "idle");
});

test("en økt i gang overlever at siden lastes på nytt", () => {
  const storage = fakeStorage();
  const session = startFocusSession(økt(), T0);
  saveFocusSession(storage, session);

  const hentet = loadFocusSession(storage);
  assert.equal(hentet.phase, "work");
  assert.equal(hentet.endsAt, T0 + 25 * MIN);
  assert.equal(hentet.workMinutes, 25);
  assert.equal(hentet.sets, 2);
  assert.equal(focusSecondsLeft(hentet, T0 + 10 * MIN), 15 * 60);

  // Og den kommer tilbake dit klokka har gått, ikke dit den ble forlatt.
  const { session: etter, events } = settleFocusSession(hentet, T0 + 27 * MIN);
  assert.deepEqual(events, [{ type: "break", minutes: 5 }]);
  assert.equal(etter.phase, "break");
});

test("en pauset økt overlever også, med resten i behold", () => {
  const storage = fakeStorage();
  saveFocusSession(storage, pauseFocusSession(startFocusSession(økt(), T0), T0 + 5 * MIN));
  const hentet = loadFocusSession(storage);
  assert.equal(hentet.running, false);
  assert.equal(focusSecondsLeft(hentet, T0 + 999 * MIN), 20 * 60);
});

test("en ferdig økt legger ingenting igjen å laste", () => {
  const storage = fakeStorage();
  saveFocusSession(storage, startFocusSession(økt(), T0));
  saveFocusSession(storage, stopFocusSession(økt()));
  assert.equal(storage.getItem(FOCUS_SESSION_KEY), null);
  assert.equal(loadFocusSession(storage), null);
});

test("ubrukelig lagret innhold gir ingen økt i stedet for en oppdiktet", () => {
  assert.equal(loadFocusSession(fakeStorage({ [FOCUS_SESSION_KEY]: "{ikke json" })), null);
  assert.equal(loadFocusSession(fakeStorage({ [FOCUS_SESSION_KEY]: JSON.stringify({ phase: "idle" }) })), null);
  assert.equal(loadFocusSession(fakeStorage({ [FOCUS_SESSION_KEY]: JSON.stringify({ phase: "work", running: true }) })), null);
  assert.equal(loadFocusSession(fakeStorage()), null);
});

// Privat vindu: lagringen kaster i stedet for å svare. Fokusøkta skal fortsatt
// kunne startes — den lever da bare så lenge fanen gjør det.
test("blokkert lagring tar ikke ned økta", () => {
  const blokkert = {
    getItem() { throw new Error("blokkert"); },
    setItem() { throw new Error("blokkert"); },
    removeItem() { throw new Error("blokkert"); },
  };
  assert.equal(loadFocusSession(blokkert), null);
  assert.doesNotThrow(() => saveFocusSession(blokkert, startFocusSession(økt(), T0)));
  assert.deepEqual(readFocusSettings(blokkert), { workMinutes: 45, breakMinutes: 10, sets: 2, activity: "" });
});

test("innstillingene leses fra de samme nøklene som iPad-panelet skriver", () => {
  const storage = fakeStorage({
    "panel-focus-work": "30",
    "panel-focus-break": "15",
    "panel-focus-sets": "3",
    "panel-focus-activity": "Statistikk",
  });
  assert.deepEqual(readFocusSettings(storage), { workMinutes: 30, breakMinutes: 15, sets: 3, activity: "Statistikk" });
  assert.deepEqual(readFocusSettings(fakeStorage()), { workMinutes: 45, breakMinutes: 10, sets: 2, activity: "" });
});

test("hendelsene har hver sin setning", () => {
  assert.equal(describeFocusEvent({ type: "break", minutes: 10 }), "Pause i 10 min");
  assert.equal(describeFocusEvent({ type: "work", set: 2, sets: 3 }), "Sett 2 av 3");
  assert.equal(describeFocusEvent({ type: "done" }), "Fokusøkten er fullført");
  assert.equal(describeFocusEvent(null), "");
});
