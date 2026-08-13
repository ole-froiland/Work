import test from "node:test";
import assert from "node:assert/strict";
import { mergeCalendarEvents, normalizeSyncCalendar, readMacAppleCalendar } from "../server/sync-calendar-service.mjs";
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

test("reads and normalizes events returned by the local Calendar app", async () => {
  const runner = async () => ({ stdout: JSON.stringify([{
    id: "apple-local:one",
    title: "Cowork",
    start: "2026-08-18T08:00:00.000Z",
    end: "2026-08-18T10:00:00.000Z",
    source: "apple",
    tone: "amber",
    kind: "meeting",
    calendarName: "Calendar",
  }]) });
  const events = await readMacAppleCalendar(runner, new Date("2026-08-13T12:00:00.000Z"));
  assert.equal(events.length, 1);
  assert.deepEqual(
    { id: events[0].id, title: events[0].title, source: events[0].source },
    { id: "apple-local:one", title: "Cowork", source: "apple" },
  );
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
