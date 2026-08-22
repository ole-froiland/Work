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
let appleCache = { events: [], updatedAt: 0, ready: false, error: null };
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

export async function mutateMacAppleCalendar(input, runner = execFileAsync) {
  if (input?.operation !== "create" || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 20) {
    throw new Error("Ugyldig kalenderendring");
  }
  const events = input.events.map(normalizeWritableEvent);
  const script = `
    const calendarApp = Application('Calendar');
    const preferred = ['Hjem', 'Home', 'Kalender', 'Calendar', 'Privat', 'Personal'];
    const calendars = calendarApp.calendars();
    const target = preferred.map(name => calendars.find(calendar => calendar.name() === name)).find(Boolean) || calendars[0];
    if (!target) throw new Error('Fant ingen Apple-kalender');
    const input = ${JSON.stringify(events)};
    const created = input.map(value => {
      const event = calendarApp.Event({
        summary: value.title,
        startDate: new Date(value.start),
        endDate: new Date(value.end),
        alldayEvent: value.allDay
      });
      target.events.push(event);
      return { id: 'apple-local:' + event.uid(), ...value, calendarName: target.name(), source: 'apple', tone: 'amber', kind: 'meeting' };
    });
    JSON.stringify(created);
  `;
  const { stdout } = await runner("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 30_000,
    maxBuffer: 512 * 1024,
  });
  const created = normalizeSyncCalendar({ events: JSON.parse(stdout) }).events;
  const createdKeys = new Set(created.map(eventFingerprint));
  appleCache = {
    events: [...appleCache.events.filter((event) => !createdKeys.has(eventFingerprint(event))), ...created]
      .sort((a, b) => +new Date(a.start) - +new Date(b.start)),
    updatedAt: Date.now(),
    ready: true,
  };
  return { events: created };
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
  if (appleCache.ready) refreshMacAppleCalendar();
  else await refreshMacAppleCalendar();
  if (appleCache.ready) {
    return {
      updatedAt: new Date(appleCache.updatedAt).toISOString(),
      events: mergeCalendarEvents(snapshot.events, appleCache.events),
      connected: true,
      stale: false,
      appleError: null,
    };
  }
  return { ...snapshot, appleError: appleCache.error };
}

function refreshMacAppleCalendar() {
  if (appleRefresh) return appleRefresh;
  if (Date.now() - appleCache.updatedAt < APPLE_CACHE_MS) return Promise.resolve();
  appleRefresh = readMacAppleCalendar()
    .then((events) => {
      appleCache = { events, updatedAt: Date.now(), ready: true, error: null };
    })
    // Å svelge årsaken her gjorde enhver kalenderfeil til den samme tause
    // «ikke tilkoblet». Lesingen får fortsatt lov til å feile stille, men den
    // legger igjen hvorfor, slik at panelet kan si det og reparere riktig.
    .catch((error) => {
      appleCache = { ...appleCache, error: appleReadErrorMessage(error) };
    })
    .finally(() => {
      appleRefresh = null;
    });
  return appleRefresh;
}

// osascript skriver hele skriptet til stderr når det feiler. Første linje med
// tekst er den som sier hva som faktisk gikk galt.
function appleReadErrorMessage(error) {
  const raw = String(error?.stderr || error?.message || "");
  const line = raw
    .split("\n")
    .map((value) => value.trim().replace(/^execution error:\s*/i, "").replace(/^(Error:\s*)+/i, ""))
    .find((value) => value && !value.startsWith("/usr/bin/osascript"));
  return (line || "Kalenderlesingen svarte ikke").slice(0, 300);
}

// Brukes av reparasjonen: leser Apple Kalender nå, forbi cachevinduet, og lar
// feilen boble opp i stedet for å gjemme den.
export async function readAppleCalendarNow(runner) {
  try {
    const events = runner ? await readMacAppleCalendar(runner) : await readMacAppleCalendar();
    appleCache = { events, updatedAt: Date.now(), ready: true, error: null };
    return events;
  } catch (error) {
    const message = appleReadErrorMessage(error);
    appleCache = { ...appleCache, error: message };
    throw new Error(message);
  }
}

// Å be om tilgang er den ene måten å få fram macOS-dialogen på. Å lete etter
// riktig rad i Personvern er noe helt annet enn å trykke «Tillat» på en dialog
// som allerede står der, så panelet spør før det sender Ole inn i innstillinger.
// EventKit svarer via en blokk, og osascript avslutter med en gang skriptet er
// ferdig, så kjøresløyfa må holdes i live til svaret kommer.
export async function requestAppleCalendarAccess(runner = execFileAsync) {
  const script = `
    function run() {
      ObjC.import('EventKit');
      ObjC.import('Foundation');
      const store = $.EKEventStore.alloc.init;
      let finished = false;
      let granted = false;
      store.requestFullAccessToEventsWithCompletion(function (ok) {
        granted = ok;
        finished = true;
      });
      const deadline = Date.now() + 45000;
      while (!finished && Date.now() < deadline) {
        $.NSRunLoop.currentRunLoop.runModeBeforeDate(
          $.NSDefaultRunLoopMode,
          $.NSDate.dateWithTimeIntervalSinceNow(0.2)
        );
      }
      return JSON.stringify({ asked: finished, granted: Boolean(granted) });
    }
  `;
  const { stdout } = await runner("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 60_000,
    maxBuffer: 64 * 1024,
  });
  return JSON.parse(stdout.trim());
}

export function appleCalendarAccessMissing(message) {
  return /mangler tilgang|not authorized|denied/i.test(String(message ?? ""));
}

// macOS 14 delte kalendertilgang i to: «Skriv kun» lar panelet legge inn
// hendelser, men ikke lese én eneste. Det er en helt annen beskjed enn å ha
// blitt avslått, og en helt annen enn aldri å ha blitt spurt.
export function describeCalendarAccess(message) {
  const text = String(message ?? "");
  if (/status 4/.test(text)) return "Panelet har bare skrivetilgang til Kalender og kan ikke lese hendelser. Sett den til «Full tilgang».";
  if (/status 2/.test(text)) return "Kalendertilgang er avslått for panelet.";
  if (/status 0/.test(text)) return "Panelet har aldri fått spørsmålet om kalendertilgang.";
  return "Panelet mangler tilgang til Apple Kalender";
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
    function run(argv) {
      ObjC.import('EventKit');
      const authorization = Number($.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent));
      // 0 = ikke spurt ennå, 2 = avslått, 3 = full tilgang, 4 = bare skrive.
      // Forskjellen avgjør om en dialog kan fikse det eller om Ole må inn i
      // Systeminnstillinger, så statusen følger med i feilen.
      if (authorization !== 3) {
        throw new Error('Panelet mangler tilgang til Apple Kalender (status ' + authorization + ')');
      }
      const store = $.EKEventStore.alloc.init;
      const rangeStart = $.NSDate.dateWithTimeIntervalSince1970(Number(argv[0]));
      const rangeEnd = $.NSDate.dateWithTimeIntervalSince1970(Number(argv[1]));
      const calendars = store.calendarsForEntityType($.EKEntityTypeEvent);
      const predicate = store.predicateForEventsWithStartDateEndDateCalendars(rangeStart, rangeEnd, calendars);
      const events = store.eventsMatchingPredicate(predicate);
      const output = [];
      for (let index = 0; index < events.count; index += 1) {
        const event = events.objectAtIndex(index);
        output.push({
          id: 'apple-local:' + ObjC.unwrap(event.eventIdentifier),
          title: ObjC.unwrap(event.title) || 'Uten navn',
          start: new Date(Number(event.startDate.timeIntervalSince1970) * 1000).toISOString(),
          end: new Date(Number(event.endDate.timeIntervalSince1970) * 1000).toISOString(),
          allDay: Boolean(event.allDay),
          calendarName: ObjC.unwrap(event.calendar.title),
          source: 'apple',
          tone: 'amber',
          kind: 'meeting'
        });
      }
      return JSON.stringify(output);
    }
  `;
  const { stdout } = await runner('/usr/bin/osascript', [
    '-l', 'JavaScript', '-e', script,
    String(Math.floor(+rangeStart / 1000)),
    String(Math.floor(+rangeEnd / 1000)),
  ], {
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return normalizeSyncCalendar({ events: JSON.parse(stdout) }).events;
}

function eventFingerprint(event) {
  return `${String(event?.title ?? '').trim().toLowerCase()}|${new Date(event?.start ?? '').toISOString()}|${new Date(event?.end ?? '').toISOString()}`;
}

function normalizeWritableEvent(value) {
  const title = shortText(value?.title, 300);
  const start = new Date(value?.start ?? "");
  const end = new Date(value?.end ?? "");
  if (!title || !Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start) {
    throw new Error("Hendelsen mangler gyldig navn eller tidspunkt");
  }
  return {
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: value?.allDay === true,
  };
}
