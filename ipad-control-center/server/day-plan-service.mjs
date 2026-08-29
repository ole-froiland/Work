import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Malen er skrevet av Ole og kan ikke utledes på nytt hvis den forsvinner. Den
// hører derfor hjemme i Application Support, ikke i Caches der kalendercachen
// ligger. Oppvåkningen gjelder én dag og kan utledes på nytt i morgen.
const TEMPLATE_FILE = join(homedir(), "Library", "Application Support", "ipad-control-center", "day-plan.json");
const WAKE_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "day-wake.json");
// Nettene kan ikke utledes på nytt når de først er tapt, og hører derfor hjemme
// sammen med malen framfor i Caches.
const HISTORY_FILE = join(homedir(), "Library", "Application Support", "ipad-control-center", "sleep-history.json");
const MAX_NIGHTS = 60;
const MAX_BLOCKS = 40;
const MAX_MINUTES = 12 * 60;
const TONES = new Set(["violet", "emerald", "amber", "sky"]);
const SOURCES = new Set(["shortcut", "usage", "manual"]);

function shortText(value, maximum) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

function clockText(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59 ? value : null;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function normalizeDayPlanTemplate(input) {
  const wakeAnchor = clockText(input?.wakeAnchor);
  const dayEnd = clockText(input?.dayEnd);
  if (!wakeAnchor || !dayEnd || !Array.isArray(input?.blocks)) return null;
  if (dayEnd <= wakeAnchor) return null;
  const blocks = input.blocks.slice(0, MAX_BLOCKS).flatMap((value) => {
    const id = shortText(value?.id, 100);
    const title = shortText(value?.title, 200);
    const minutes = Number(value?.minutes);
    if (!id || !title || !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) return [];
    return [{ id, title, minutes, tone: TONES.has(value?.tone) ? value.tone : "violet" }];
  });
  return { wakeAnchor, dayEnd, blocks };
}

export function normalizeWake(input, now = new Date()) {
  const wokeAt = new Date(input?.wokeAt ?? "");
  if (!Number.isFinite(+wokeAt)) throw new Error("Ugyldig tidspunkt");
  // Begge avvisningene betyr at noe er galt i kilden, ikke at Ole sto opp i går
  // eller i morgen. Da er det bedre å la gårsdagens plan stå.
  if (+wokeAt > +now) throw new Error("Tidspunktet ligger fram i tid");
  if (dateKey(wokeAt) !== dateKey(now)) throw new Error("Tidspunktet er ikke i dag");
  if (!SOURCES.has(input?.source)) throw new Error("Ukjent kilde");
  // Leggetiden er et tillegg, ikke et krav. En natt der den mangler er fortsatt
  // en natt, og oppvåkningen skal ikke avvises fordi den andre enden er borte.
  const slept = new Date(input?.sleepAt ?? "");
  const sleepAt = Number.isFinite(+slept) && +slept < +wokeAt ? slept.toISOString() : null;
  return { wokeAt: wokeAt.toISOString(), source: input.source, sleepAt };
}

function emptyWake(now) {
  return { date: dateKey(now), wokeAt: null, source: null, sleepAt: null, confirmed: false, done: [] };
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

export async function readDayPlanTemplate() {
  return normalizeDayPlanTemplate(await readJsonFile(TEMPLATE_FILE));
}

export async function readWake(now = new Date()) {
  const stored = await readJsonFile(WAKE_FILE);
  // En oppføring fra i går er ikke feil, den er bare gammel. Ny dag, ny start.
  if (!stored || stored.date !== dateKey(now)) return emptyWake(now);
  return {
    date: stored.date,
    wokeAt: typeof stored.wokeAt === "string" ? stored.wokeAt : null,
    source: SOURCES.has(stored.source) ? stored.source : null,
    sleepAt: typeof stored.sleepAt === "string" ? stored.sleepAt : null,
    confirmed: stored.source === "manual",
    done: Array.isArray(stored.done) ? stored.done : [],
  };
}

export async function recordWake(input, now = new Date()) {
  const { wokeAt, source, sleepAt } = normalizeWake(input, now);
  const current = await readWake(now);
  // En rettelse Ole har gjort for hånd skal ikke kunne overskrives av et signal
  // som kommer etterpå. Gjettet taper alltid mot mennesket.
  if (current.source === "manual" && source !== "manual") return current;
  const next = { ...current, wokeAt, source, sleepAt: sleepAt ?? current.sleepAt, confirmed: source === "manual" };
  await writeJsonFile(WAKE_FILE, next);
  await recordNight({ date: next.date, wokeAt: next.wokeAt, sleepAt: next.sleepAt });
  return next;
}

export async function markBlockDone(input, now = new Date()) {
  const id = shortText(input?.id, 100);
  if (!id) throw new Error("Ugyldig bolk");
  const at = new Date(input?.at ?? now);
  if (!Number.isFinite(+at)) throw new Error("Ugyldig tidspunkt");
  const current = await readWake(now);
  // En bryter, ikke en enveisdør. Uten dette kunne en bolk som ble huket av ved
  // et uhell aldri hukes av igjen — og haket den av før tida, krympet den til
  // en stripe det ikke gikk an å treffe.
  const already = current.done.some((entry) => entry?.id === id);
  const rest = current.done.filter((entry) => entry?.id !== id);
  const done = already ? rest : [...rest, { id, at: at.toISOString() }];
  const next = { ...current, done };
  await writeJsonFile(WAKE_FILE, next);
  return next;
}

export async function getDayPlan(now = new Date()) {
  const [template, wake, history] = await Promise.all([readDayPlanTemplate(), readWake(now), readSleepHistory()]);
  // Fraværet av en mal er ingen feiltilstand. Da oppfører panelet seg som før.
  return { template, wake, history, connected: template !== null };
}

export async function readSleepHistory() {
  const stored = await readJsonFile(HISTORY_FILE);
  return {
    version: 1,
    targetWake: clockText(stored?.targetWake),
    nights: Array.isArray(stored?.nights) ? stored.nights.slice(-MAX_NIGHTS) : [],
  };
}

export async function recordNight(input) {
  const date = shortText(input?.date, 10);
  const woke = new Date(input?.wokeAt ?? "");
  if (!date || !Number.isFinite(+woke)) throw new Error("Ugyldig natt");
  const slept = new Date(input?.sleepAt ?? "");
  const night = {
    date,
    wokeAt: woke.toISOString(),
    sleepAt: Number.isFinite(+slept) && +slept < +woke ? slept.toISOString() : null,
  };
  const history = await readSleepHistory();
  // Én oppføring per dato. Retter Ole oppvåkningen sin, skal natta oppdateres
  // og ikke legges til en gang til.
  const nights = [...history.nights.filter((entry) => entry?.date !== date), night]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-MAX_NIGHTS);
  const next = { ...history, nights };
  await writeJsonFile(HISTORY_FILE, next);
  return next;
}

export async function saveTargetWake(value) {
  const targetWake = clockText(value);
  if (!targetWake) throw new Error("Ugyldig klokkeslett");
  const history = await readSleepHistory();
  const next = { ...history, targetWake };
  await writeJsonFile(HISTORY_FILE, next);
  return next;
}
