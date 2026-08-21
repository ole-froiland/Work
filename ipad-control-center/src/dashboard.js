export function formatTimer(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? Math.floor(seconds) : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function formatMinutes(value) {
  if (!Number.isFinite(value)) return "Ikke synket";
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return `${hours} t ${String(remainder).padStart(2, "0")} min`;
}

export const LOCAL_PANEL_URL = "http://Ole-sin-MacBook-Air.local:4173";

export function resolvePanelRedirect({ hostname = "", search = "" } = {}) {
  const isPanelDeploy = hostname === "ole-work-panel.netlify.app"
    || hostname.endsWith("--ole-work-panel.netlify.app");
  const keepPublicShell = new URLSearchParams(search).get("public") === "1";
  return isPanelDeploy && !keepPublicShell ? LOCAL_PANEL_URL : null;
}

export async function readUsageResponse(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Åpne ${LOCAL_PANEL_URL} for å se AI-bruk`);
  }
  return response.json();
}

const APP_DISPLAY_NAMES = new Map([
  ["com.burbn.instagram", "Instagram"],
  ["com.toyopagroup.picaboo", "Snapchat"],
  ["com.apple.mobilesafari", "Safari"],
  ["com.apple.incallservice", "Telefon og FaceTime"],
  ["com.linkedin.linkedin", "LinkedIn"],
  ["com.google.ios.youtube", "YouTube"],
  ["com.zhiliaoapp.musically", "TikTok"],
  ["com.facebook.facebook", "Facebook"],
  ["com.facebook.messenger", "Messenger"],
  ["com.spotify.client", "Spotify"],
  ["com.openai.chat", "ChatGPT"],
  ["com.atebits.tweetie2", "X"],
  ["com.burbn.barcelona", "Threads"],
  ["com.reddit.reddit", "Reddit"],
  ["pinterest", "Pinterest"],
  ["com.tumblr.tumblr", "Tumblr"],
  ["alexisbarreyat.bereal", "BeReal"],
  ["com.hammerandchisel.discord", "Discord"],
  ["tv.twitch", "Twitch"],
]);

// Kortet måler bare det Ole vil bruke mindre tid på, så listen er bevisst
// kort og navngitt. iPhonen sender appens visningsnavn når den har ett, og
// bunt-ID-en ellers — begge veier ender i det samme kanoniske navnet her.
// Samme liste finnes i ios-companion/Sources/SocialApps.swift, som avgjør
// hva iPhonen i det hele tatt henter. Endrer du én, endre begge.
const SOCIAL_APP_NAMES = new Set([
  "instagram", "snapchat", "tiktok", "facebook", "messenger", "x", "twitter",
  "threads", "reddit", "linkedin", "pinterest", "tumblr", "bereal", "discord",
  "twitch", "youtube",
]);

export function isSocialApp(value) {
  return SOCIAL_APP_NAMES.has(formatAppName(value).toLowerCase());
}

export function formatAppName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return "Ukjent app";
  const knownName = APP_DISPLAY_NAMES.get(name.toLowerCase());
  if (knownName) return knownName;
  if (!/^(?:[a-z\d-]+\.){2,}[a-z\d-]+$/i.test(name)) return name;

  const readable = name
    .split(".")
    .at(-1)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : "Ukjent app";
}

export function buildMonthDays(year, month) {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      value: date.getDate(),
      currentMonth: date.getMonth() === month,
    };
  });
}

export function eventOccursOnDay(event, day) {
  const start = new Date(event?.start ?? "");
  if (!Number.isFinite(+start)) return false;
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const eventStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (!event?.allDay) return +dayStart === +eventStart;

  const end = new Date(event?.end ?? "");
  if (!Number.isFinite(+end) || +end <= +start) return false;
  return +dayStart >= +eventStart && +dayStart < +end;
}

// Nullstillingstidspunktet kommer fra leverandøren. Claude sender «is_active: false»
// for ukesvinduet selv når det både har forbruk og et oppgitt tidspunkt, så
// nedtellingen skal vises så lenge tidspunktet finnes — flagget avgjør bare
// teksten når leverandøren ikke oppga noe tidspunkt i det hele tatt.
export function formatResetTime(value, active, now) {
  if (!value) {
    return active
      ? { countdown: "Nullstilling ikke oppgitt", absolute: "Leverandøren oppga ikke tidspunkt" }
      : { countdown: "Starter ved neste bruk", absolute: "Ingen aktiv periode" };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { countdown: "Ugyldig nullstilling", absolute: "–" };
  const totalMinutes = Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const countdown = days > 0
    ? `${days} ${days === 1 ? "dag" : "dager"} ${hours} ${hours === 1 ? "time" : "timer"} igjen`
    : hours > 0 ? `${hours} ${hours === 1 ? "time" : "timer"} ${minutes} min igjen` : `${minutes} min igjen`;
  const absolute = new Intl.DateTimeFormat("nb-NO", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(date);
  return { countdown, absolute };
}

// «Ikke synket» alene sier ikke om mobilen aldri har vært koblet til, eller om
// den sluttet å sende for to dager siden. Alderen på siste observasjon skiller.
export function describeSyncAge(source, now = new Date(), fallback = "Venter på iPhone") {
  const observed = new Date(source?.observedAt ?? "");
  if (!source?.provider || Number.isNaN(observed.getTime())) return fallback;
  const minutes = Math.max(0, Math.floor((now.getTime() - observed.getTime()) / 60_000));
  if (minutes < 60) return `Sist synket for ${minutes} min siden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Sist synket for ${hours} ${hours === 1 ? "time" : "timer"} siden`;
  const days = Math.floor(hours / 24);
  return `Sist synket for ${days} ${days === 1 ? "døgn" : "døgn"} siden`;
}

// Telefonen kan synke helt fint og likevel mangle sosial-tallene: da kjører den
// en companion-versjon som bare kjente total skjermtid. «Ikke synket» sender én
// til å lete etter nettverksfeil, når det i virkeligheten er appen på telefonen
// som må byttes ut — og det skjer ikke av seg selv ved å bruke telefonen.
export function needsCompanionUpdate(metrics, now = new Date()) {
  if (Number.isFinite(metrics?.screenTime?.socialMinutes)) return false;
  const observed = new Date(metrics?.sources?.screenTime?.observedAt ?? "");
  if (!metrics?.sources?.screenTime?.provider || Number.isNaN(observed.getTime())) return false;
  return now.getTime() - observed.getTime() < 24 * 60 * 60 * 1000;
}

// Samler alle tilkoblingene på ett sted. Hver sjekk sier hva som er galt og hva
// man gjør med det, slik at statusstripa kan være taus når alt virker.
export function buildStatusChecks({ syncCalendar, syncNotes, deviceMetrics, usage } = {}, now = new Date()) {
  const events = Array.isArray(syncCalendar?.events) ? syncCalendar.events : [];
  const notes = Array.isArray(syncNotes?.notes) ? syncNotes.notes : [];
  const providerDetail = (provider) => {
    if (!provider) return "Henter kvotedata …";
    return provider.ok ? "Kvoten er hentet" : provider.error || "Leverandøren svarte ikke";
  };
  return [
    {
      id: "calendar",
      label: "Apple Kalender",
      ok: Boolean(syncCalendar?.connected),
      detail: syncCalendar?.connected
        ? `${events.length} hendelser hentet`
        : "Åpne Kalender på Mac-en",
    },
    {
      id: "notes",
      label: "Sync-notater",
      ok: Boolean(syncNotes?.connected),
      detail: syncNotes?.connected ? `${notes.length} notater hentet` : "Åpne Sync på Mac-en",
    },
    {
      id: "mobile",
      label: "iPhone-verdier",
      ok: Boolean(deviceMetrics?.syncConnected),
      detail: deviceMetrics?.syncConnected
        ? "Sosial tid, skritt og posisjon er ferske"
        : `${describeSyncAge(deviceMetrics?.sources?.steps, now, "Har aldri sendt")}. Åpne Panelkobling på iPhonen.`,
    },
    { id: "codex", label: "Codex-bruk", ok: Boolean(usage?.codex?.ok), detail: providerDetail(usage?.codex) },
    { id: "claude", label: "Claude-bruk", ok: Boolean(usage?.claude?.ok), detail: providerDetail(usage?.claude) },
  ];
}

// Agentkortet skal kunne leses på et blikk fra andre siden av rommet: jobber
// den, står den fast, eller er den ferdig? Alderen på siste hendelse er det som
// skiller «tenker» fra «har stoppet opp», så den står alltid i teksten.
export function formatAgentAge(value, now = new Date()) {
  const stamp = new Date(value ?? "");
  if (!Number.isFinite(+stamp)) return "ukjent tid";
  const seconds = Math.max(0, Math.round((now.getTime() - stamp.getTime()) / 1000));
  if (seconds < 10) return "nå";
  if (seconds < 60) return `${seconds} s siden`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min siden`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "time" : "timer"} siden`;
}

const AGENT_STATES = {
  working: { label: "Jobber", tone: "working" },
  stalled: { label: "Står stille", tone: "stalled" },
  done: { label: "Venter", tone: "done" },
};

// Merkelappen sier tilstanden, teksten ved siden av sier hva som skjer. De to
// skal aldri gjenta hverandre: en økt som venter viser mappa si i stedet.
export function describeAgentSession(session, now = new Date()) {
  const state = AGENT_STATES[session?.state] ?? { label: "Ukjent", tone: "done" };
  const age = formatAgentAge(session?.lastActivityAt, now);
  const detail = session?.state === "working"
    ? `${session.subagent ? "Underagent jobber" : session.activity ?? "Tenker"} · ${age}`
    : session?.state === "stalled"
      ? `Stoppet for ${age.replace(" siden", "")}`
      : [session?.project, age].filter(Boolean).join(" · ");
  return {
    id: session?.id,
    provider: session?.provider,
    title: session?.title || "Uten navn",
    project: session?.project || "",
    label: state.label,
    tone: state.tone,
    detail,
  };
}

function taskWord(count) {
  return count === 1 ? "oppgave" : "oppgaver";
}

// Overskriften er hele poenget med kortet: den skal svare på «kjører det noe
// nå?» uten at man leser lista. Derfor navngir den leverandøren når bare én av
// dem jobber, og teller opp når begge gjør det.
export function summarizeAgentSessions(snapshot, now = new Date()) {
  if (!snapshot) return { headline: "Henter økter …", activeCount: 0, count: 0, sessions: [], empty: false };
  if (snapshot.ok === false) {
    // Feilmeldingen står alene: «ingen økter» ved siden av den ville lest som om
    // vi visste at ingenting kjørte, og det er nettopp det vi ikke vet.
    return { headline: snapshot.error || "Kunne ikke lese øktene", activeCount: 0, count: 0, sessions: [], empty: false };
  }
  const sessions = (Array.isArray(snapshot.sessions) ? snapshot.sessions : [])
    .map((session) => describeAgentSession(session, now));
  const busy = sessions.filter((session) => session.tone === "working");
  const stalled = sessions.filter((session) => session.tone === "stalled");
  const done = sessions.filter((session) => session.tone === "done");

  const names = [...new Set(busy.map((session) => (session.provider === "codex" ? "Codex" : "Claude")))];
  const headline = busy.length
    ? names.length === 1
      ? `${names[0]} jobber med ${busy.length} ${taskWord(busy.length)}`
      : `${busy.length} ${taskWord(busy.length)} kjører`
    : stalled.length
      ? `${stalled.length} ${taskWord(stalled.length)} står stille`
      : done.length
        ? "Ingenting kjører nå"
        : "Ingen økter de siste åtte timene";

  return { headline, activeCount: busy.length + stalled.length, count: sessions.length, sessions, empty: sessions.length === 0 };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatEventClock(date) {
  return new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(date);
}

// «I dag» og «I morgen» er tydeligere enn datoen på de dagene det gjelder.
function formatEventDay(date, now) {
  const offset = Math.round((+startOfDay(date) - +startOfDay(now)) / 86_400_000);
  if (offset === 0) return "I dag";
  if (offset === 1) return "I morgen";
  if (offset > 1 && offset < 7) return new Intl.DateTimeFormat("nb-NO", { weekday: "long" }).format(date);
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short" }).format(date);
}

export function formatCountdown(milliseconds) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "starter nå";
  if (minutes < 60) return `om ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `om ${hours} t ${restMinutes} min` : `om ${hours} t`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `om ${days} d ${restHours} t` : `om ${days} d`;
}

function describeEntry(entry, extra) {
  const { event } = entry;
  return {
    id: event.id,
    title: event.title || "Uten navn",
    tone: event.tone || "violet",
    calendarName: event.calendarName || (event.source === "sync" ? "Sync" : event.source) || "",
    ...extra,
  };
}

// Kortet svarer på «hva er det neste jeg skal». Et møte som ennå ikke har startet
// vinner derfor over et som pågår, og heldagsoppføringer kommer sist siden de
// ikke har et klokkeslett å telle ned til.
export function describeNextEvent(events, now = new Date()) {
  const entries = (Array.isArray(events) ? events : [])
    .map((event) => ({ event: event ?? {}, start: new Date(event?.start ?? ""), end: new Date(event?.end ?? "") }))
    .filter((entry) => Number.isFinite(+entry.start));

  const timed = entries.filter((entry) => !entry.event.allDay);

  const upcoming = timed
    .filter((entry) => +entry.start > +now)
    .sort((a, b) => +a.start - +b.start)[0];
  if (upcoming) {
    const hasEnd = Number.isFinite(+upcoming.end) && +upcoming.end > +upcoming.start;
    return describeEntry(upcoming, {
      ongoing: false,
      when: `${formatEventDay(upcoming.start, now)} ${formatEventClock(upcoming.start)}${hasEnd ? `–${formatEventClock(upcoming.end)}` : ""}`,
      countdown: formatCountdown(+upcoming.start - +now),
    });
  }

  const ongoing = timed
    .filter((entry) => Number.isFinite(+entry.end) && +entry.start <= +now && +entry.end > +now)
    .sort((a, b) => +a.end - +b.end)[0];
  if (ongoing) {
    return describeEntry(ongoing, {
      ongoing: true,
      when: `Slutter ${formatEventClock(ongoing.end)}`,
      countdown: "pågår nå",
    });
  }

  const allDay = entries
    .filter((entry) => entry.event.allDay && Number.isFinite(+entry.end) && +entry.end > +now)
    .sort((a, b) => +a.start - +b.start)[0];
  if (allDay) {
    return describeEntry(allDay, {
      ongoing: +allDay.start <= +now,
      when: formatEventDay(allDay.start, now),
      countdown: "hele dagen",
    });
  }

  return null;
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(value) : "Ikke synket";
}

function formatObservedAt(value) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(+date)) return "Ikke oppgitt";
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function comparison(value, average) {
  if (!Number.isFinite(value) || !Number.isFinite(average) || average <= 0) return "Ikke nok data";
  const change = Math.round(((value - average) / average) * 100);
  return `${Math.abs(change)} % ${change >= 0 ? "over" : "under"} snittet`;
}

export function buildMetricDetails(type, metrics = {}) {
  if (type === "screenTime") {
    const yesterday = metrics.screenTime?.socialMinutes;
    const average = metrics.screenTime?.socialWeeklyAverageMinutes;
    // En utdatert companion gir et blandet bilde: applista fra forrige synk står
    // der, men summene mangler. Uten en forklaring ser «Ikke synket» ut som en
    // feil ved siden av tall som åpenbart finnes.
    const outdated = needsCompanionUpdate(metrics);
    return {
      eyebrow: "iPhone og iPad",
      title: "Sosiale medier",
      summary: outdated ? "Utdatert app" : formatMinutes(yesterday),
      notice: outdated
        ? "Telefonen synker fint, men appen på den sender fortsatt bare total skjermtid. Installer Panelkobling på nytt fra Mac-en, så fylles tallene inn. Applista under er fra siste synk."
        : null,
      appsEmpty: "Appfordelingen kommer ved neste iPhone-synk.",
      // iPhonen filtrerer allerede, men en eldre companion-versjon kan ligge
      // i mellomlageret med hele applista. Da skal ikke Safari snike seg inn.
      apps: Array.isArray(metrics.screenTime?.topApps)
        ? metrics.screenTime.topApps
          .filter((app) => isSocialApp(app?.name))
          .slice(0, 5)
          .map((app) => ({ name: formatAppName(app.name), value: formatMinutes(app.minutes) }))
        : [],
      rows: [
        ["I går", formatMinutes(yesterday)],
        ["Snitt siste uke", formatMinutes(average)],
        ["Mot snittet", comparison(yesterday, average)],
        ["Sist synket", formatObservedAt(metrics.sources?.screenTime?.observedAt)],
      ],
    };
  }
  if (type === "steps") {
    const today = metrics.steps?.today;
    const average = metrics.steps?.weeklyAverage;
    return {
      eyebrow: "Apple Helse",
      title: "Skritt",
      summary: formatNumber(today),
      rows: [
        ["I dag", formatNumber(today)],
        ["Snitt siste uke", formatNumber(average)],
        ["Mot snittet", comparison(today, average)],
        ["Sist synket", formatObservedAt(metrics.sources?.steps?.observedAt)],
      ],
    };
  }
  const weather = metrics.weather ?? {};
  return {
    eyebrow: weather.label || "Posisjonen din",
    title: "Været nå",
    summary: weather.ok && Number.isFinite(weather.temperature) ? `${Math.round(weather.temperature)}°` : "Utilgjengelig",
    rows: [
      ["Forhold", weather.ok ? weather.condition : "Vær utilgjengelig"],
      ["Føles som", weather.ok && Number.isFinite(weather.apparentTemperature) ? `${Math.round(weather.apparentTemperature)}°` : "Ikke oppgitt"],
      ["Posisjon", weather.label || "Ikke oppgitt"],
      ["Posisjonskilde", metrics.sources?.location?.provider === "CoreLocation" ? "iPhone" : "Mosterøy-reserve"],
    ],
  };
}
