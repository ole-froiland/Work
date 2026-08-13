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
