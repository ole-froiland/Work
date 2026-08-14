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
]);

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
    const yesterday = metrics.screenTime?.yesterdayMinutes;
    const average = metrics.screenTime?.weeklyAverageMinutes;
    return {
      eyebrow: "iPhone og iPad",
      title: "Skjermtid",
      summary: formatMinutes(yesterday),
      apps: Array.isArray(metrics.screenTime?.topApps)
        ? metrics.screenTime.topApps.slice(0, 5).map((app) => ({ name: formatAppName(app.name), value: formatMinutes(app.minutes) }))
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
