import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Lenkene til ChatGPT-prosjektene er skrevet av Ole og kan ikke utledes på nytt
// hvis de forsvinner. De hører derfor hjemme i Application Support sammen med
// dagsplanen, ikke i Caches — og ikke i repoet, som ligger åpent.
const PROJECT_FILE = join(homedir(), "Library", "Application Support", "ipad-control-center", "subject-projects.json");
const HISTORY_FILE = join(homedir(), "Library", "Application Support", "ipad-control-center", "subject-session-history.json");

// Samme fire fag som `SUBJECT_CODES` i `src/dashboard.js`. Nettleseren kjenner
// kodene, Mac-en kjenner adressene. Endres den ene lista, må den andre endres i
// samme slengen.
const SUBJECT_CODES = ["BUS400N", "BUS401E", "BUS446", "STR402A"];
// Fristene et fag har lenger fram enn dette hjelper ikke på en økt i dag, og
// gjør bare prompten lengre enn den trenger å være.
const DEADLINE_WINDOW_DAYS = 21;
const MAX_DEADLINES = 5;
const MAX_MINUTES = 12 * 60;
const RECENT_WORK_DAYS = 14;
const ROTATION_SESSION_MINUTES = 45;

function isSubjectCode(value) {
  return typeof value === "string" && SUBJECT_CODES.includes(value.toUpperCase());
}

// En adresse som ikke kan være et ChatGPT-prosjekt skal ikke åpnes. Uten denne
// grensa ville en feilskrevet linje i filen sende Chrome hvor som helst.
function normalizeProjectUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "chatgpt.com" && url.hostname !== "chat.openai.com") return null;
  return url.toString();
}

// Mangler filen, er ingen fag koblet opp — og da skal panelet la være å tilby en
// knapp i det hele tatt, i stedet for å tilby en som ikke fører noe sted.
export async function readSubjectProjects(file = PROJECT_FILE) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
  const projects = {};
  for (const code of SUBJECT_CODES) {
    const url = normalizeProjectUrl(parsed?.[code]);
    if (url) projects[code] = url;
  }
  return projects;
}

// Bare kodene ut til nettleseren. Adressene blir på Mac-en.
export async function listConnectedSubjects(file = PROJECT_FILE) {
  return Object.keys(await readSubjectProjects(file));
}

export async function readSubjectHistory(file = HISTORY_FILE) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return (Array.isArray(parsed) ? parsed : []).filter((entry) => isSubjectCode(entry?.code) && Number.isFinite(Date.parse(entry?.startedAt)));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

export async function recordSubjectSession(code, now = new Date(), file = HISTORY_FILE) {
  const history = await readSubjectHistory(file);
  const cutoff = +now - RECENT_WORK_DAYS * 86_400_000;
  const recent = history.filter((entry) => Date.parse(entry.startedAt) >= cutoff);
  recent.push({ code, startedAt: now.toISOString() });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(recent, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return recent;
}

function eventMinutesInWindow(event, code, cutoff, now) {
  if (typeof event?.title !== "string" || event.title.startsWith("📌")) return 0;
  if (!new RegExp(`\\b${code}\\b`, "i").test(event.title)) return 0;
  const start = Date.parse(event.start ?? "");
  const end = Date.parse(event.end ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= +now || end <= cutoff) return 0;
  return Math.max(0, (Math.min(end, +now) - Math.max(start, cutoff)) / 60_000);
}

// Kalenderen sier hva som faktisk har stått som fagarbeid nylig. Historikken
// gjør at spontane trykk også roterer jevnt, selv på dager uten kalenderøkter.
export function selectBalancedSubject({ codes, events = [], history = [], now = new Date() }) {
  const available = SUBJECT_CODES.filter((code) => codes?.includes(code));
  if (available.length === 0) return null;
  const cutoff = +now - RECENT_WORK_DAYS * 86_400_000;
  return available
    .map((code) => {
      const calendarMinutes = events.reduce((total, event) => total + eventMinutesInWindow(event, code, cutoff, now), 0);
      const recentChoices = history.filter((entry) => entry?.code === code && Date.parse(entry.startedAt) >= cutoff);
      const lastChosen = recentChoices.reduce((latest, entry) => Math.max(latest, Date.parse(entry.startedAt)), 0);
      return { code, score: calendarMinutes + recentChoices.length * ROTATION_SESSION_MINUTES, lastChosen };
    })
    .sort((a, b) => a.score - b.score || a.lastChosen - b.lastChosen || SUBJECT_CODES.indexOf(a.code) - SUBJECT_CODES.indexOf(b.code))[0].code;
}

function subjectDeadlines(events, code, now) {
  const until = +now + DEADLINE_WINDOW_DAYS * 86_400_000;
  const pattern = new RegExp(`\\b${code}\\b`, "i");
  return (Array.isArray(events) ? events : [])
    .filter((event) => typeof event?.title === "string" && event.title.startsWith("📌") && pattern.test(event.title))
    .map((event) => ({ title: event.title, start: new Date(event.start ?? "") }))
    .filter((entry) => Number.isFinite(+entry.start) && +entry.start > +now && +entry.start <= until)
    .sort((a, b) => +a.start - +b.start)
    .slice(0, MAX_DEADLINES);
}

function dayMonth(date) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Fristteksten skal si hva som skal leveres, ikke gjenta fagkoden og emojien som
// allerede står i overskriften over lista.
function deadlineText(title, code) {
  return title.replace("📌", "").replace(new RegExp(`\\b${code}\\b`, "i"), "").replace(/^[\s–-]+/, "").trim();
}

// En planlagt økt får kalenderkontekst. Den spontane Skole-knappen holder seg
// kort og lar prosjektet bruke fagfilene og den eksisterende konteksten selv.
export function buildSessionPrompt({ code, minutes, title, events, now = new Date() }) {
  if (!Number.isFinite(minutes)) {
    return `Jeg vil ta en liten økt i ${code}. Bruk filene, tidligere samtaler og resten av konteksten i dette prosjektet til å vurdere hvor jeg ligger an, hva jeg bør kunne, og hva som kommer framover. Velg det viktigste jeg bør øve på nå, og start direkte. Test meg aktivt og tilpass økta etter svarene mine.`;
  }
  const deadlines = subjectDeadlines(events, code, now);
  const heading = `Jeg har en økt på ${minutes} minutter i ${code} nå.`;
  const fromCalendar = title ? `Kalenderen sier: «${title}».` : null;
  const deadlineBlock = deadlines.length
    ? [`Frister i ${code} de neste tre ukene:`, ...deadlines.map((entry) => `- ${dayMonth(entry.start)} ${deadlineText(entry.title, code)}`)].join("\n")
    : `Kalenderen har ingen ${code}-frister de neste tre ukene.`;
  const ask = [
    "Legg opp økta: hva vi gjør, i hvilken rekkefølge, og hvor lenge på hver del.",
    "Start med det som betyr mest for nærmeste frist.",
    "Spør meg hvor jeg står i faget hvis du trenger å vite det for å prioritere.",
  ].join(" ");
  return [heading, fromCalendar, "", deadlineBlock, "", ask].filter((line) => line !== null).join("\n");
}

// Tittelen kommer fra kalenderen på Mac-en, men den går veien om nettleseren, så
// den behandles som ukjent inndata på vei inn igjen.
export function normalizeSessionRequest(payload) {
  const code = isSubjectCode(payload?.code) ? String(payload.code).toUpperCase() : null;
  if (!code) throw new Error("Ukjent fag");
  const hasMinutes = payload?.minutes !== undefined && payload?.minutes !== null;
  const minutes = hasMinutes ? Math.round(Number(payload.minutes)) : null;
  if (hasMinutes && (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES)) throw new Error("Ugyldig lengde på økta");
  const title = typeof payload?.title === "string" && payload.title.trim() ? payload.title.trim().slice(0, 300) : null;
  return { code, minutes, title };
}

export { SUBJECT_CODES };
