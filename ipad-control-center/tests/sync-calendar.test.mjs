import test from "node:test";
import assert from "node:assert/strict";
import { appleCalendarAccessMissing, describeCalendarAccess, filterPanelCalendarEvents, getSyncCalendar, mergeCalendarEvents, mutateMacAppleCalendar, normalizeSyncCalendar, readAppleCalendarNow, readMacAppleCalendar } from "../server/sync-calendar-service.mjs";
import { normalizeSyncNoteCommand, normalizeSyncNotes } from "../server/sync-notes-service.mjs";

test("normalizes and sorts trusted Sync calendar snapshots", () => {
  const result = normalizeSyncCalendar({ events: [
    { id: "b", title: " Sen ", start: "2026-08-12T12:00:00+02:00", end: "2026-08-12T13:00:00+02:00", tone: "sky", source: "google" },
    { id: "a", title: "Tidlig", start: "2026-08-12T08:00:00+02:00", end: "2026-08-12T09:00:00+02:00", kind: "focus" },
    { id: "bad", title: "Ugyldig", start: "nope", end: "nope" },
  ] });
  assert.deepEqual(result.events.map((event) => event.id), ["a", "b"]);
  assert.equal(result.events[1].title, "Sen");
  assert.equal(result.events[1].source, "google");
  assert.equal(result.events[0].tone, "violet");
});

test("Apple Calendar replaces stale Apple snapshots without duplicating Sync events", () => {
  const cached = [
    { id: "apple:old", title: "Apple old", start: "2026-08-14T10:00:00.000Z", end: "2026-08-14T11:00:00.000Z", source: "apple" },
    { id: "sync:note", title: "Sync note", start: "2026-08-15T10:00:00.000Z", end: "2026-08-15T11:00:00.000Z", source: "sync" },
  ];
  const apple = [{ id: "apple-local:new", title: "Apple new", start: "2026-08-16T10:00:00.000Z", end: "2026-08-16T11:00:00.000Z", source: "apple" }];
  assert.deepEqual(mergeCalendarEvents(cached, apple).map((event) => event.id), ["apple-local:new"]);
});

test("keeps calendars hidden on the Mac out of the wall panel", () => {
  const events = [
    { id: "new", calendarName: "olealexanderfroiland02@gmail.com" },
    { id: "old-study", calendarName: "NHH H26" },
    { id: "old-routine", calendarName: "Rutine H26" },
    { id: "home", calendarName: "Hjem" },
  ];

  assert.deepEqual(filterPanelCalendarEvents(events).map((event) => event.id), ["new", "home"]);
});

test("reads and normalizes events returned by the local Calendar app", async () => {
  let invocation;
  const runner = async (...args) => {
    invocation = args;
    return { stdout: JSON.stringify([{
      id: "apple-local:one",
      title: "Cowork",
      start: "2026-08-18T08:00:00.000Z",
      end: "2026-08-18T10:00:00.000Z",
      source: "apple",
      tone: "amber",
      kind: "meeting",
      calendarName: "Calendar",
    }]) };
  };
  const events = await readMacAppleCalendar(runner, new Date("2026-08-13T12:00:00.000Z"));
  assert.equal(invocation[0], "/usr/bin/osascript");
  assert.match(invocation[1][3], /EventKit/);
  assert.doesNotMatch(invocation[1][3], /Application\(['"]Calendar['"]\)/);
  // Ett år tilbake og tre fram: kortere vindu lot avtaler ligge i Apple
  // Kalender som panelet ikke kunne vise når Ole bladde forbi kanten.
  assert.deepEqual(invocation[1].slice(-2), ["1755086400", "1881230400"]);
  assert.equal(invocation[2].timeout, 10_000);
  assert.equal(events.length, 1);
  assert.deepEqual(
    { id: events[0].id, title: events[0].title, source: events[0].source },
    { id: "apple-local:one", title: "Cowork", source: "apple" },
  );
});

test("creates a validated event in the local Apple Calendar", async () => {
  let invocation;
  const runner = async (...args) => {
    invocation = args;
    return { stdout: JSON.stringify([{
      id: "apple-local:new",
      title: "Cowork",
      start: "2026-08-18T08:00:00.000Z",
      end: "2026-08-18T10:00:00.000Z",
      source: "apple",
      tone: "amber",
      kind: "meeting",
      calendarName: "Hjem",
    }]) };
  };
  const result = await mutateMacAppleCalendar({
    operation: "create",
    events: [{ title: "Cowork", start: "2026-08-18T08:00:00.000Z", end: "2026-08-18T10:00:00.000Z" }],
  }, runner);
  assert.equal(invocation[0], "/usr/bin/osascript");
  assert.match(invocation[1][3], /target\.events\.push/);
  assert.equal(result.events[0].id, "apple-local:new");
});

test("rejects malformed payload shapes without fabricating events", () => {
  assert.deepEqual(normalizeSyncCalendar({ events: "wrong" }).events, []);
});

test("normalizes active Sync notes and safe panel commands", () => {
  const result = normalizeSyncNotes({
    userId: "user-1",
    notes: [
      { id: "older", title: " Eldre ", created_at: "2026-08-11T08:00:00Z" },
      { id: "newer", title: "Nyere", created_at: "2026-08-12T08:00:00Z" },
      { id: "invalid", title: "", created_at: "bad" },
    ],
  });
  assert.deepEqual(result.notes.map((note) => note.title), ["Nyere", "Eldre"]);
  assert.deepEqual(normalizeSyncNoteCommand({ type: "create", title: " Ring Ola " }), { type: "create", title: "Ring Ola" });
  assert.deepEqual(normalizeSyncNoteCommand({ type: "complete", noteId: "note-1" }), { type: "complete", noteId: "note-1" });
  assert.equal(normalizeSyncNoteCommand({ type: "delete", noteId: "note-1" }), null);
});

test("en feilet kalenderlesing etterlater en lesbar årsak i stedet for stillhet", async () => {
  const failing = async () => {
    const error = new Error("Command failed");
    error.stderr = "/usr/bin/osascript: line 4\nexecution error: Panelet mangler tilgang til Apple Kalender (-1743)";
    throw error;
  };
  await assert.rejects(() => readAppleCalendarNow(failing), /mangler tilgang til Apple Kalender/);
});

test("kjenner igjen manglende kalendertilgang, som krever noe annet enn en omstart", () => {
  assert.equal(appleCalendarAccessMissing("Panelet mangler tilgang til Apple Kalender"), true);
  assert.equal(appleCalendarAccessMissing("Not authorized to send Apple events"), true);
  assert.equal(appleCalendarAccessMissing("Kalender kjører ikke"), false);
  assert.equal(appleCalendarAccessMissing(null), false);
});

test("rydder osascript-støyen bort fra kalenderfeilen", async () => {
  const failing = async () => {
    const error = new Error("Command failed");
    error.stderr = "execution error: Error: Error: Panelet mangler tilgang til Apple Kalender (-2700)";
    throw error;
  };
  await assert.rejects(
    () => readAppleCalendarNow(failing),
    (error) => error.message === "Panelet mangler tilgang til Apple Kalender (-2700)",
  );
});

test("skiller skrivetilgang fra avslag og fra aldri å ha blitt spurt", () => {
  assert.match(describeCalendarAccess("Panelet mangler tilgang til Apple Kalender (status 4)"), /bare skrivetilgang/);
  assert.match(describeCalendarAccess("Panelet mangler tilgang til Apple Kalender (status 2)"), /avslått/);
  assert.match(describeCalendarAccess("Panelet mangler tilgang til Apple Kalender (status 0)"), /aldri fått spørsmålet/);
  assert.equal(describeCalendarAccess("noe helt annet"), "Panelet mangler tilgang til Apple Kalender");
});

test("en manuell oppdatering leser Apple Kalender på nytt i stedet for å servere vinduet om igjen", async () => {
  let reads = 0;
  const runner = async () => {
    reads += 1;
    return { stdout: JSON.stringify([{
      id: `apple-local:${reads}`,
      title: "Cowork",
      start: "2026-08-18T08:00:00.000Z",
      end: "2026-08-18T10:00:00.000Z",
      source: "apple",
      calendarName: "Hjem",
    }]) };
  };

  await getSyncCalendar({ force: true, runner });
  assert.equal(reads, 1);

  // Pollingen skal fortsatt kunne hvile i vinduet: to iPad-er og en Mac som
  // spør samtidig skal ikke bety én osascript-kjøring hver.
  await getSyncCalendar({ runner });
  assert.equal(reads, 1);

  // Trykket på Kalender-raden skal forbi vinduet. Gjorde det ikke det, fikk
  // Ole nøyaktig den samme utdaterte lista tilbake av en oppdatering.
  const forced = await getSyncCalendar({ force: true, runner });
  assert.equal(reads, 2);
  assert.equal(forced.connected, true);
  assert.equal(forced.appleError, null);
});

test("en lesing som feiler etter en som gikk bra melder fra i stedet for å se frisk ut", async () => {
  const working = async () => ({ stdout: JSON.stringify([{
    id: "apple-local:one",
    title: "Cowork",
    start: "2026-08-18T08:00:00.000Z",
    end: "2026-08-18T10:00:00.000Z",
    source: "apple",
    calendarName: "Hjem",
  }]) });
  await getSyncCalendar({ force: true, runner: working });

  const failing = async () => {
    const error = new Error("Command failed");
    error.stderr = "execution error: Panelet mangler tilgang til Apple Kalender (status 4)";
    throw error;
  };
  const snapshot = await getSyncCalendar({ force: true, runner: failing });

  // Hendelsene fra sist ligger der fortsatt, men panelet skal ikke påstå at de
  // er hentet nå: raden leser `appleError` og sier hva som er galt.
  assert.equal(snapshot.appleError, "Panelet mangler tilgang til Apple Kalender (status 4)");
});

test("et tak som slår inn tar det fjerneste bort, ikke tilfeldige avtaler", () => {
  // EventKit svarer ikke i tidsrekkefølge. Ble det beskåret før sorteringen,
  // kunne dagens avtale ryke mens en i 2029 ble stående.
  const events = [
    { id: "langt-fram", title: "Langt fram", start: "2029-07-03T22:00:00.000Z", end: "2029-07-03T23:00:00.000Z" },
    { id: "i-dag", title: "I dag", start: "2026-08-23T08:00:00.000Z", end: "2026-08-23T09:00:00.000Z" },
    { id: "i-morgen", title: "I morgen", start: "2026-08-24T08:00:00.000Z", end: "2026-08-24T09:00:00.000Z" },
  ];

  assert.deepEqual(normalizeSyncCalendar({ events }, 2).events.map((event) => event.id), ["i-dag", "i-morgen"]);
});
