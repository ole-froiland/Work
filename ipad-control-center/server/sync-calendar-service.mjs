import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CALENDAR_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "sync-calendar.json");
const MAX_EVENTS = 1_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TONES = new Set(["violet", "emerald", "amber", "sky"]);
const KINDS = new Set(["focus", "meeting", "launch", "deadline"]);

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
  try {
    const snapshot = JSON.parse(await readFile(CALENDAR_FILE, "utf8"));
    const age = Date.now() - new Date(snapshot.updatedAt ?? "").getTime();
    return { ...snapshot, connected: Number.isFinite(age), stale: !Number.isFinite(age) || age > MAX_AGE_MS };
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return { updatedAt: null, events: [], connected: false, stale: false };
  }
}
