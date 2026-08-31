import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const METRICS_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "device-metrics.json");
const MOSTEROY = { label: "Mosterøy", latitude: 59.07, longitude: 5.37, source: "fallback" };
const WEATHER_CACHE_MS = 10 * 60 * 1000;
const SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let weatherCache = null;

function finiteInRange(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function normalizeSource(value, expectedProvider) {
  const observedAt = new Date(value?.observedAt ?? "");
  const age = Date.now() - observedAt.getTime();
  if (value?.provider !== expectedProvider || !Number.isFinite(age) || age < -5 * 60 * 1000 || age > SOURCE_MAX_AGE_MS) return null;
  return { provider: expectedProvider, observedAt: observedAt.toISOString() };
}

// Skjermtiden telefonen sender beskriver *gårsdagen*, regnet fra da den ble
// hentet. Et tall hentet i går handler altså om forgårs, og «I går» på kortet er
// da feil med en hel dag. Vinduet var 48 timer, og et 44 timer gammelt tall gled
// gjennom som ferskt — kortet så helt friskt ut mens det viste noe annet enn det
// sa. Derfor døgnet, ikke en varighet: tallet er «I går» bare den dagen det ble
// hentet.
function observedToday(source, now = new Date()) {
  const observedAt = new Date(source?.observedAt ?? "");
  return Number.isFinite(+observedAt) && observedAt.toDateString() === now.toDateString();
}

function isFresh(source, maximumAge) {
  const observedAt = new Date(source?.observedAt ?? "").getTime();
  return Number.isFinite(observedAt) && Date.now() - observedAt <= maximumAge;
}

function normalizeTopApps(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 10).flatMap((app) => {
    const name = typeof app?.name === "string" ? app.name.trim().slice(0, 100) : "";
    const minutes = finiteInRange(app?.minutes, 0, 2_880);
    return name && minutes !== null ? [{ name, minutes }] : [];
  }).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
}

// Grunnen til at en kilde manglet, slik telefonen selv oppga den. Uten dette
// kunne panelet bare si «Ikke synket», og forskjellen på «Helse sa nei»,
// «tillatelsen er borte» og «telefonen har ikke ringt» var umulig å se — de tre
// krever helt ulike ting av Ole. Bare kjente nøkler slippes gjennom, og teksten
// kappes: den kommer fra en telefon og skal ikke kunne fylle kortet.
export function normalizeProblems(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(["screenTime", "steps", "location"].flatMap((name) => {
    const reason = typeof value[name] === "string" ? value[name].trim().slice(0, 200) : "";
    return reason ? [[name, reason]] : [];
  }));
}

export function normalizeDeviceUpdate(input = {}, previous = {}) {
  const reported = normalizeProblems(input.problems);
  const screenTimeSource = normalizeSource(input.sources?.screenTime, "DeviceActivity");
  const stepsSource = normalizeSource(input.sources?.steps, "HealthKit");
  const locationSource = normalizeSource(input.sources?.location, "CoreLocation");
  const socialMinutes = finiteInRange(input.screenTime?.socialMinutes, 0, 2_880);
  const socialWeeklyAverageMinutes = finiteInRange(input.screenTime?.socialWeeklyAverageMinutes, 0, 2_880);
  const topApps = normalizeTopApps(input.screenTime?.topApps);
  const todaySteps = finiteInRange(input.steps?.today, 0, 250_000);
  const weeklyAverageSteps = finiteInRange(input.steps?.weeklyAverage, 0, 250_000);
  const latitude = finiteInRange(input.location?.latitude, -90, 90);
  const longitude = finiteInRange(input.location?.longitude, -180, 180);
  const label = typeof input.location?.label === "string" && input.location.label.trim()
    ? input.location.label.trim().slice(0, 80)
    : null;

  return {
    updatedAt: new Date().toISOString(),
    screenTime: {
      socialMinutes: screenTimeSource && socialMinutes !== null ? socialMinutes : previous.screenTime?.socialMinutes ?? null,
      socialWeeklyAverageMinutes: screenTimeSource && socialWeeklyAverageMinutes !== null ? socialWeeklyAverageMinutes : previous.screenTime?.socialWeeklyAverageMinutes ?? null,
      topApps: screenTimeSource && topApps !== null ? topApps : previous.screenTime?.topApps ?? [],
    },
    steps: {
      today: stepsSource && todaySteps !== null ? todaySteps : previous.steps?.today ?? null,
      weeklyAverage: stepsSource && weeklyAverageSteps !== null ? weeklyAverageSteps : previous.steps?.weeklyAverage ?? null,
    },
    location: locationSource && latitude !== null && longitude !== null
      ? { label: label ?? "Nær deg", latitude, longitude, source: "device" }
      : previous.location ?? MOSTEROY,
    sources: {
      screenTime: screenTimeSource ?? previous.sources?.screenTime ?? null,
      steps: stepsSource ?? previous.sources?.steps ?? null,
      location: locationSource ?? previous.sources?.location ?? null,
    },
    // En kilde som kom fram har ingen feil å vise lenger. En som fortsatt
    // mangler beholder grunnen fra forrige gang hvis denne synken ikke oppga en
    // ny — telefonen sender bare det den vet akkurat da.
    problems: {
      screenTime: screenTimeSource ? null : reported.screenTime ?? previous.problems?.screenTime ?? null,
      steps: stepsSource ? null : reported.steps ?? previous.problems?.steps ?? null,
      location: locationSource ? null : reported.location ?? previous.problems?.location ?? null,
    },
    deviceName: typeof input.deviceName === "string" && input.deviceName.trim()
      ? input.deviceName.trim().slice(0, 80)
      : previous.deviceName ?? null,
  };
}

export function weatherDescription(code) {
  if (code === 0) return "Klart";
  if ([1, 2].includes(code)) return "Lettskyet";
  if (code === 3) return "Overskyet";
  if ([45, 48].includes(code)) return "Tåke";
  if ([51, 53, 55, 56, 57].includes(code)) return "Yr";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Regn";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snø";
  if ([95, 96, 99].includes(code)) return "Torden";
  return "Skiftende";
}

async function readStoredMetrics() {
  try {
    return JSON.parse(await readFile(METRICS_FILE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return normalizeDeviceUpdate({}, {});
    throw error;
  }
}

async function writeStoredMetrics(metrics) {
  await mkdir(dirname(METRICS_FILE), { recursive: true });
  await writeFile(METRICS_FILE, JSON.stringify(metrics), { mode: 0o600 });
}

async function fetchWeather(location) {
  const cacheKey = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
  if (weatherCache?.key === cacheKey && Date.now() - weatherCache.fetchedAt < WEATHER_CACHE_MS) {
    return weatherCache.value;
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", location.latitude);
  url.searchParams.set("longitude", location.longitude);
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code");
  url.searchParams.set("timezone", "auto");
  const response = await fetch(url, { headers: { "User-Agent": "ipad-control-center/1.0" } });
  if (!response.ok) throw new Error(`Været kunne ikke hentes (${response.status})`);
  const payload = await response.json();
  const value = {
    ok: true,
    label: location.label,
    temperature: payload.current?.temperature_2m ?? null,
    apparentTemperature: payload.current?.apparent_temperature ?? null,
    code: payload.current?.weather_code ?? null,
    condition: weatherDescription(payload.current?.weather_code),
    observedAt: payload.current?.time ?? null,
    locationSource: location.source,
  };
  weatherCache = { key: cacheKey, fetchedAt: Date.now(), value };
  return value;
}

// Hvilke kilder telefonen faktisk fikk med seg. Sendinger som mangler en kilde
// ser like vellykkede ut som fullstendige, og da er det umulig å se forskjell på
// «HealthKit sa nei» og «telefonen har ikke ringt» når panelet står tomt.
export function describeSyncPayload(input) {
  const sent = ["screenTime", "steps", "location"].filter((name) => {
    const source = input?.sources?.[name];
    return Boolean(source?.provider && source?.observedAt);
  });
  return sent.length ? sent.join(", ") : "ingen kilder";
}

export async function updateDeviceMetrics(input) {
  const previous = await readStoredMetrics();
  const next = normalizeDeviceUpdate(input, previous);
  await writeStoredMetrics(next);
  return getDeviceMetrics();
}

export async function getDeviceMetrics() {
  const stored = await readStoredMetrics();
  const screenTimeFresh = observedToday(stored.sources?.screenTime);
  const stepsFresh = isFresh(stored.sources?.steps, 12 * 60 * 60 * 1000);
  const locationFresh = isFresh(stored.sources?.location, 24 * 60 * 60 * 1000);
  const location = locationFresh ? stored.location : MOSTEROY;
  let weather;
  try { weather = await fetchWeather(location); }
  catch (error) {
    const cacheKey = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
    weather = weatherCache?.key === cacheKey
      ? weatherCache.value
      : { ok: false, label: location.label, error: error instanceof Error ? error.message : "Værfeil" };
  }
  return {
    updatedAt: stored.updatedAt ?? null,
    screenTime: screenTimeFresh ? stored.screenTime : { socialMinutes: null, socialWeeklyAverageMinutes: null, topApps: [] },
    steps: stepsFresh ? stored.steps : { today: null, weeklyAverage: null },
    weather,
    sources: stored.sources ?? {},
    problems: stored.problems ?? {},
    deviceName: stored.deviceName ?? null,
    syncConnected: screenTimeFresh || stepsFresh || locationFresh,
  };
}
