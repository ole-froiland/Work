import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const CALENDAR_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "sync-calendar.json");
const MAX_EVENTS = 1_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TONES = new Set(["violet", "emerald", "amber", "sky"]);
const KINDS = new Set(["focus", "meeting", "launch", "deadline"]);
const execFileAsync = promisify(execFile);
const APPLE_CACHE_MS = 2 * 60 * 1000;
let appleCache = { events: [], updatedAt: 0, ready: false };
let appleRefresh = null;

function shortText(value, maximum) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

export function normalizeSyncCalendar(input = {}) {
  const candidates = Array.isArray(input.events) ? input.events.slice(0, MAX_EVENTS) : [];
  const events = candidates.flatMap((value) => {
    const id = shortText(value?.id, 200);
    const title = shortText(value?.title, 300);
    const start = new Date(value?.start ?? "");
    const end = new Date(value?.end ?? "");
    if (!id || !title || !Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start) return [];
    return [{
      id,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      tone: TONES.has(value?.tone) ? value.tone : "violet",
      kind: KINDS.has(value?.kind) ? value.kind : "meeting",
      note: shortText(value?.note, 500),
      allDay: value?.allDay === true,
      calendarName: shortText(value?.calendarName, 120),
      source: ["sync", "google", "apple", "microsoft"].includes(value?.source) ? value.source : "sync",
    }];
  }).sort((a, b) => +new Date(a.start) - +new Date(b.start));
  return { updatedAt: new Date().toISOString(), events };
}

export async function updateSyncCalendar(input) {
  const snapshot = normalizeSyncCalendar(input);
  await mkdir(dirname(CALENDAR_FILE), { recursive: true });
  await writeFile(CALENDAR_FILE, JSON.stringify(snapshot), { mode: 0o600 });
  return { ...snapshot, connected: true, stale: false };
}

export async function getSyncCalendar() {
  let snapshot = { updatedAt: null, events: [], connected: false, stale: false };
  try {
    const cached = JSON.parse(await readFile(CALENDAR_FILE, "utf8"));
    const age = Date.now() - new Date(cached.updatedAt ?? "").getTime();
    snapshot = { ...cached, connected: Number.isFinite(age), stale: !Number.isFinite(age) || age > MAX_AGE_MS };
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  refreshMacAppleCalendar();
  if (appleCache.ready) {
    return {
      updatedAt: new Date(appleCache.updatedAt).toISOString(),
      events: mergeCalendarEvents(snapshot.events, appleCache.events),
      connected: true,
      stale: false,
    };
  }
  return snapshot;
}

function refreshMacAppleCalendar() {
  if (appleRefresh || Date.now() - appleCache.updatedAt < APPLE_CACHE_MS) return;
  appleRefresh = readMacAppleCalendar()
    .then((events) => {
      appleCache = { events, updatedAt: Date.now(), ready: true };
    })
    .catch(() => {})
    .finally(() => {
      appleRefresh = null;
    });
}

export function mergeCalendarEvents(cachedEvents = [], appleEvents = []) {
  const appleKeys = new Set(appleEvents.map(eventFingerprint));
  return [...cachedEvents.filter((event) => !["apple", "sync"].includes(event.source) && !appleKeys.has(eventFingerprint(event))), ...appleEvents]
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));
}

export async function readMacAppleCalendar(runner = execFileAsync, now = new Date()) {
  const rangeStart = new Date(+now - 14 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(+now + 240 * 24 * 60 * 60 * 1000);
  const script = `
    ObjC.import('Foundation');
    const calendarApp = Application('Calendar');
    const rangeStart = new Date('${rangeStart.toISOString()}');
    const rangeEnd = new Date('${rangeEnd.toISOString()}');
    const output = [];
    for (const calendar of calendarApp.calendars()) {
      const calendarName = calendar.name();
      const events = calendar.events.whose({ _and: [
        { startDate: { _lessThan: rangeEnd } },
        { endDate: { _greaterThan: rangeStart } }
      ] })();
      for (const event of events) {
        const start = event.startDate();
        const end = event.endDate();
        output.push({
          id: 'apple-local:' + event.uid(),
          title: event.summary(),
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: Boolean(event.alldayEvent()),
          calendarName,
          source: 'apple',
          tone: 'amber',
          kind: 'meeting'
        });
      }
    }
    JSON.stringify(output);
  `;
  const { stdout } = await runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return normalizeSyncCalendar({ events: JSON.parse(stdout) }).events;
}

function eventFingerprint(event) {
  return `${String(event?.title ?? '').trim().toLowerCase()}|${new Date(event?.start ?? '').toISOString()}|${new Date(event?.end ?? '').toISOString()}`;
}
