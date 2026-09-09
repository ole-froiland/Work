// Fokusøkta måles mot klokka, ikke mot en nedtelling som må få lov til å
// tikke. En telefon er ikke en vegg-iPad: skjermen slokner, Safari fryser
// tidtakerne i bakgrunnen, og en fane som har ligget lenge nok blir kastet og
// lastet på nytt når den hentes fram igjen. Alle tre gjør det samme med en
// `setInterval` som trekker fra ett sekund om gangen — den blir stående der
// den var, og økta lyver om hvor langt den er kommet.
//
// Derfor er det ene som lagres når fasen slutter (`endsAt`), ikke hvor mye som
// er igjen. Det som er igjen regnes ut fra `Date.now()` hver gang noe skal
// vises, og en økt som har vært borte i en time rulles gjennom alle fasene som
// fikk plass i fraværet i stedet for bare den ene som sto for tur.

export const FOCUS_SESSION_KEY = "panel-mobile-focus";

// Grensene som lengdene settes innenfor. De skal aldri kunne bli null: en fase
// uten varighet slutter i samme øyeblikk den begynner, og en økt av slike
// faser har ingen ende å rulle fram til.
const MIN_MINUTES = 1;
const MAX_MINUTES = 180;
const MAX_SETS = 12;

// `Number(null)` er 0 og består enhver finite-sjekk. En manglende nøkkel ville
// derfor blitt trukket opp til minstelengden i stedet for å falle tilbake på
// standarden, og en telefon som aldri har åpnet panelet før hadde begynt på
// ett minutt.
function clamp(value, low, high, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, Math.round(number)));
}

function phaseMinutes(session, phase) {
  return phase === "break" ? session.breakMinutes : session.workMinutes;
}

// Innstillingene deles med iPad-panelet og ligger som løse nøkler. Mangler de,
// er det første gang panelet åpnes på denne telefonen.
export function readFocusSettings(storage) {
  const read = (key) => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  return {
    workMinutes: clamp(read("panel-focus-work"), MIN_MINUTES, MAX_MINUTES, 45),
    breakMinutes: clamp(read("panel-focus-break"), MIN_MINUTES, MAX_MINUTES, 10),
    sets: clamp(read("panel-focus-sets"), 1, MAX_SETS, 2),
    activity: read("panel-focus-activity") || "",
  };
}

export function createFocusSession(settings = {}) {
  const workMinutes = clamp(settings.workMinutes, MIN_MINUTES, MAX_MINUTES, 45);
  const breakMinutes = clamp(settings.breakMinutes, MIN_MINUTES, MAX_MINUTES, 10);
  const sets = clamp(settings.sets, 1, MAX_SETS, 2);
  return {
    phase: "idle",
    running: false,
    set: 1,
    sets,
    workMinutes,
    breakMinutes,
    activity: typeof settings.activity === "string" ? settings.activity : "",
    endsAt: null,
    leftMs: workMinutes * 60_000,
  };
}

function toIdle(session) {
  return { ...session, phase: "idle", running: false, set: 1, endsAt: null, leftMs: session.workMinutes * 60_000 };
}

// Neste steg i syklusen, uten hensyn til klokka. Hendelsen sier hva som skjedde,
// slik at panelet kan si det samme enten det stod og så på eller kom tilbake
// til en telefon som hadde ligget med skjermen av.
export function nextFocusPhase(session) {
  if (session.phase === "work" && session.set < session.sets) {
    return { phase: "break", set: session.set, event: { type: "break", minutes: session.breakMinutes } };
  }
  if (session.phase === "break") {
    return { phase: "work", set: session.set + 1, event: { type: "work", set: session.set + 1, sets: session.sets } };
  }
  return { phase: "idle", set: 1, event: { type: "done" } };
}

export function startFocusSession(session, nowMs) {
  return {
    ...session,
    phase: "work",
    running: true,
    set: 1,
    endsAt: nowMs + session.workMinutes * 60_000,
    leftMs: session.workMinutes * 60_000,
  };
}

export function pauseFocusSession(session, nowMs) {
  if (!session.running || session.phase === "idle") return session;
  return { ...session, running: false, endsAt: null, leftMs: Math.max(0, session.endsAt - nowMs) };
}

export function resumeFocusSession(session, nowMs) {
  if (session.running || session.phase === "idle") return session;
  return { ...session, running: true, endsAt: nowMs + Math.max(0, session.leftMs) };
}

export function stopFocusSession(session) {
  return toIdle(session);
}

// Hoppet skal ikke arve tiden som var igjen: den neste fasen begynner nå.
export function skipFocusPhase(session, nowMs) {
  if (session.phase === "idle") return session;
  const { phase, set, event } = nextFocusPhase(session);
  if (phase === "idle") return { session: toIdle(session), events: [event] };
  const lengthMs = phaseMinutes(session, phase) * 60_000;
  return {
    session: {
      ...session,
      phase,
      set,
      endsAt: session.running ? nowMs + lengthMs : null,
      leftMs: lengthMs,
    },
    events: [event],
  };
}

// Ruller økta fram til der klokka faktisk står. Telefonen kan ha ligget med
// skjermen av i en time, og da er det ikke ett steg som har gått, men alle de
// som fikk plass i fraværet. Fasene legges etter hverandre fra `endsAt` og ikke
// fra `nowMs`, slik at et opphold ikke forskyver resten av økta.
export function settleFocusSession(session, nowMs) {
  if (!session?.running || session.phase === "idle" || !Number.isFinite(session.endsAt)) {
    return { session, events: [] };
  }
  const events = [];
  let current = session;
  // Syklusen tar slutt av seg selv etter to faser per sett. Grensen står
  // likevel: en lagret økt kan komme fra en eldre utgave med andre tall, og en
  // løkke som ikke kan avsluttes tar hele panelet med seg.
  const limit = 2 * Math.max(1, session.sets) + 2;
  for (let step = 0; step < limit; step += 1) {
    if (nowMs < current.endsAt) return { session: current, events };
    const { phase, set, event } = nextFocusPhase(current);
    events.push(event);
    if (phase === "idle") return { session: toIdle(current), events };
    current = { ...current, phase, set, endsAt: current.endsAt + phaseMinutes(current, phase) * 60_000 };
  }
  return { session: toIdle(current), events };
}

export function focusSecondsLeft(session, nowMs) {
  if (!session || session.phase === "idle") return Math.max(0, Math.ceil((session?.leftMs ?? 0) / 1000));
  const leftMs = session.running ? session.endsAt - nowMs : session.leftMs;
  return Math.max(0, Math.ceil((Number.isFinite(leftMs) ? leftMs : 0) / 1000));
}

// Hvor langt inn i fasen man er, 0–1. Brukes til stripa i fullskjermsvisningen.
export function focusPhaseProgress(session, nowMs) {
  if (!session || session.phase === "idle") return 0;
  const total = phaseMinutes(session, session.phase) * 60;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - focusSecondsLeft(session, nowMs) / total));
}

export function describeFocusEvent(event) {
  if (!event) return "";
  if (event.type === "break") return `Pause i ${event.minutes} min`;
  if (event.type === "work") return `Sett ${event.set} av ${event.sets}`;
  return "Fokusøkten er fullført";
}

// Bare en økt som er i gang er verdt å lagre. Er den ferdig, skal nøkkelen bort:
// en tom økt som ligger igjen ville åpnet fullskjerm neste gang panelet lastes.
export function saveFocusSession(storage, session) {
  try {
    if (!session || session.phase === "idle") {
      storage?.removeItem(FOCUS_SESSION_KEY);
      return;
    }
    storage?.setItem(FOCUS_SESSION_KEY, JSON.stringify({
      phase: session.phase,
      running: session.running,
      set: session.set,
      sets: session.sets,
      workMinutes: session.workMinutes,
      breakMinutes: session.breakMinutes,
      activity: session.activity,
      endsAt: session.endsAt,
      leftMs: session.leftMs,
    }));
  } catch {
    // Privat vindu eller full lagring: økta lever da bare så lenge fanen gjør
    // det. Det er bedre enn å ta ned panelet på vei inn i en fokusøkt.
  }
}

export function loadFocusSession(storage) {
  let raw = null;
  try {
    raw = storage?.getItem(FOCUS_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || (parsed.phase !== "work" && parsed.phase !== "break")) return null;
  const base = createFocusSession(parsed);
  const running = Boolean(parsed.running);
  // En økt som står på pause må ha en rest, og en som går må ha et sluttpunkt.
  // Mangler det, er posten ubrukelig, og da er det ærligere å begynne på nytt
  // enn å vise et tall vi har funnet på.
  if (running && !Number.isFinite(parsed.endsAt)) return null;
  if (!running && !Number.isFinite(parsed.leftMs)) return null;
  return {
    ...base,
    phase: parsed.phase,
    running,
    set: clamp(parsed.set, 1, base.sets, 1),
    endsAt: running ? parsed.endsAt : null,
    leftMs: running ? base.leftMs : Math.max(0, parsed.leftMs),
  };
}
