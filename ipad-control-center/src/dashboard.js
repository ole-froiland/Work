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

// Tailscale-adressen svarer likt hjemme, på hotspot og på mobildata, så lenge
// Tailscale er på på iPad-en. .local-navnet under krever Bonjour og svarer bare
// på samme LAN — det står igjen som reserve, og settes med ?host= ved behov.
export const LOCAL_PANEL_URL = "http://ole-mac-panel.tail161d1e.ts.net:4173";
export const LAN_PANEL_URL = "http://Ole-sin-MacBook-Air.local:4173";
// Åpnes panelet i en nettleser på Mac-en selv, svarer tailnett-navnet aldri:
// tailscaled kjører i userspace-modus og ruter ikke Mac-ens egen trafikk inn i
// tailnettet, så navnet slår ikke engang opp. Loopback svarer alltid der.
export const LOOPBACK_PANEL_URL = "http://localhost:4173";
export const PANEL_HOST_KEY = "panelHost";
// Adressen som ble forsøkt legges igjen her rett før siden forlates. Er den her
// når siden lastes igjen, kom vi tilbake — altså svarte ikke Mac-en.
export const PANEL_ATTEMPT_KEY = "panelRedirectAttempt";
export const PANEL_ATTEMPT_WINDOW_MS = 90_000;
// En adresse som ikke svarer gir ikke alltid en feilside. Slår navnet opp, men
// svarer ingen på porten, blir navigeringen bare hengende: fanen spinner, siden
// står tom og nettleseren viser fortsatt den gamle adressen. Dokumentet lever
// derimot fortsatt, så etter denne fristen avbrytes forsøket og velgeren vises.
export const PANEL_STALL_MS = 8_000;
const PANEL_PORT = "4173";

// .local-navnet krever Bonjour. Hjemme svarer det, men en iPhone-hotspot
// slipper ikke multicast mellom klientene sine, så oppslaget dør og panelet
// blir en blank skjerm uten noe som forklarer hvorfor. Derfor kan adressen
// overstyres én gang med ?host= og huskes etterpå — da trengs ingen ny
// utrulling når Mac-en får et nytt navn eller en ny adresse.
function isPrivatePanelHostname(hostname = "") {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
  if (host === "local" || host.endsWith(".local")) return true;
  if (host.endsWith(".ts.net")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 100.64/10 er området Tailscale deler ut, og det ligger utenfor RFC 1918.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// Adressen står i en URL hvem som helst kan åpne, så den slipper bare gjennom
// verter som faktisk kan være Mac-en. Ellers ville panelsiden vært en åpen
// videresending til hva som helst.
export function normalizePanelHost(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (!isPrivatePanelHostname(url.hostname)) return null;
  if (!url.port) url.port = PANEL_PORT;
  return `${url.protocol}//${url.host}`;
}

function readStoredPanelHost(storage) {
  try {
    return normalizePanelHost(storage?.getItem(PANEL_HOST_KEY));
  } catch {
    return null;
  }
}

function rememberPanelHost(storage, value) {
  try {
    storage?.setItem(PANEL_HOST_KEY, value);
  } catch {
    // Privat vindu eller blokkert lagring: adressen gjelder da bare dette besøket.
  }
}

export function storePanelHost(storage, value) {
  const normalized = normalizePanelHost(value);
  if (!normalized) return null;
  rememberPanelHost(storage, normalized);
  return normalized;
}

export function isPanelDeployHostname(hostname = "") {
  return hostname === "ole-work-panel.netlify.app"
    || hostname.endsWith("--ole-work-panel.netlify.app");
}

export function resolvePanelRedirect({ hostname = "", search = "" } = {}, storage = null) {
  if (!isPanelDeployHostname(hostname)) return null;
  const params = new URLSearchParams(search);
  const requested = normalizePanelHost(params.get("host"));
  if (requested) rememberPanelHost(storage, requested);
  if (params.get("public") === "1") return null;
  return requested ?? readStoredPanelHost(storage) ?? LOCAL_PANEL_URL;
}

// Én adresse svarer ikke overalt: tailnettet krever Tailscale i begge ender,
// .local krever samme LAN, og loopback finnes bare på Mac-en. Panelet skal
// kunne åpnes uansett nett, så alle tre står som valg — og standardrekkefølgen
// setter den som svarer flest steder først.
export function panelHostCandidates({ stored = null } = {}) {
  const seen = new Set();
  const candidates = [];
  const add = (value, label, note) => {
    const url = normalizePanelHost(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, label, note });
  };
  add(stored, "Sist valgte adresse", "Adressen som ble valgt sist på denne enheten.");
  // Rekkefølgen er hvor sannsynlig det er at adressen svarer der panelet
  // faktisk åpnes: .local svarer både på hjemmenettet og på Mac-en selv,
  // tailnettet bare med Tailscale på, loopback bare på Mac-en.
  add(LAN_PANEL_URL, "Samme wifi som Mac-en", "Bonjour-navnet. Svarer hjemme og på Mac-en selv, men ikke på hotspot eller mobildata.");
  add(LOCAL_PANEL_URL, "Tailscale", "Svarer uansett nett — men bare når Tailscale står på i begge ender, og aldri fra Mac-en selv.");
  add(LOOPBACK_PANEL_URL, "På Mac-en selv", "Når panelet åpnes i en nettleser på Mac-en som kjører det.");
  return candidates;
}

export function notePanelAttempt(session, url, now = Date.now()) {
  try {
    session?.setItem(PANEL_ATTEMPT_KEY, JSON.stringify({ url, at: now }));
  } catch {
    // Uten sesjonslager mister vi bare muligheten til å se at vi kom tilbake.
  }
}

function takePanelAttempt(session, now) {
  let raw = null;
  try {
    raw = session?.getItem(PANEL_ATTEMPT_KEY) ?? null;
    session?.removeItem(PANEL_ATTEMPT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const attempt = JSON.parse(raw);
    if (!attempt?.url || !Number.isFinite(attempt.at)) return null;
    if (now - attempt.at > PANEL_ATTEMPT_WINDOW_MS) return null;
    return attempt.url;
  } catch {
    return null;
  }
}

// Netlify-siden er bare et veiskilt, og et veiskilt som peker feil skal si det
// selv. Før dette forlot siden seg selv med én gang: svarte ikke adressen, satt
// Ole igjen med en blank skjerm og ingen måte å velge en annen adresse på.
export function planPanelEntry({ location = {}, storage = null, session = null, now = Date.now() } = {}) {
  const { hostname = "", search = "" } = location;
  if (!isPanelDeployHostname(hostname)) return { mode: "app", candidates: [] };
  const params = new URLSearchParams(search);
  const requested = normalizePanelHost(params.get("host"));
  if (requested) rememberPanelHost(storage, requested);
  const stored = readStoredPanelHost(storage);
  const candidates = panelHostCandidates({ stored });
  const failedUrl = takePanelAttempt(session, now);
  if (params.get("public") === "1") return { mode: "app", candidates };
  // En adresse Ole nettopp skrev inn skal alltid prøves, også rett etter at en
  // annen feilet — ellers ville rettelsen havnet i velgeren i stedet for å åpne.
  if (requested) return { mode: "redirect", url: requested, candidates };
  if (failedUrl) return { mode: "chooser", candidates, failedUrl };
  // Uten en husket adresse finnes det ingenting å gå på. En https-side får ikke
  // spørre en http-adresse om den svarer, så et hopp her ville vært gjetning —
  // og gjetter den feil, ender Ole på nettleserens feilside, der siden ikke kan
  // rette seg selv. Da er det bedre å spørre én gang og huske svaret.
  if (stored) return { mode: "redirect", url: stored, candidates };
  return { mode: "chooser", candidates, failedUrl: null };
}

// Selve hoppet til Mac-en, med begge feilene et hopp kan ha: adressen som ikke
// finnes (nettleseren viser sin egen feilside, og Ole kommer tilbake hit), og
// adressen som aldri svarer (ingenting skjer i det hele tatt). Den siste er den
// som så ut som en blank skjerm, og den fanges bare av en frist.
export function createPanelOpener({
  location,
  storage = null,
  session = null,
  onStalled = () => {},
  stallMs = PANEL_STALL_MS,
  setTimer = setTimeout,
  now = Date.now,
} = {}) {
  return function openPanel(value, { remember = false } = {}) {
    const url = normalizePanelHost(value);
    if (!url) return null;
    if (remember) rememberPanelHost(storage, url);
    notePanelAttempt(session, url, now());
    location.replace(url);
    setTimer(() => onStalled(url), stallMs);
    return url;
  };
}

// Svarer panelet her? Spørsmålet kan bare stilles til http://localhost: en
// https-side får ikke lov å hente fra andre http-adresser, og et tailnett-navn
// som ikke svarer kan derfor ikke oppdages på forhånd — bare etter at siden er
// forlatt. Endepunktet inneholder ingen data, bare et ja.
export async function isPanelReachable(url, { fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  if (!url || typeof fetchImpl !== "function") return false;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${url}/api/panel-hello`, { cache: "no-store", signal: controller?.signal });
    if (!response?.ok) return false;
    const body = await response.json();
    return body?.panel === true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
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

const SOCIAL_APP_ICON_KEYS = new Map([
  ["instagram", "instagram"],
  ["snapchat", "snapchat"],
  ["linkedin", "linkedin"],
  ["facebook", "facebook"],
  ["messenger", "messenger"],
  ["youtube", "youtube"],
  ["tiktok", "tiktok"],
  ["x", "x"],
  ["twitter", "x"],
  ["threads", "threads"],
  ["reddit", "reddit"],
  ["pinterest", "pinterest"],
  ["tumblr", "tumblr"],
  ["discord", "discord"],
  ["twitch", "twitch"],
]);

export function socialAppIconKey(value) {
  return SOCIAL_APP_ICON_KEYS.get(formatAppName(value).toLowerCase()) ?? "app";
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

// Dagsvisningen bruker absolutte posisjoner. Når to avtaler overlapper i tid,
// må de derfor få hver sin kolonne; full bredde på begge gjør at den som
// tegnes sist skjuler den andre. Hendelser som bare berører samme minutt
// (én slutter idet neste starter) kan fortsatt bruke hele bredden.
export function layoutDayEvents(events = []) {
  const result = events.map((event) => ({ event, column: 0, columnCount: 1 }));
  const timed = result
    .map((item, index) => ({ ...item, index, start: +new Date(item.event?.start ?? ""), end: +new Date(item.event?.end ?? "") }))
    .filter((item) => !item.event?.allDay && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  function placeGroup(group) {
    const columnEnds = [];
    for (const item of group) {
      let column = columnEnds.findIndex((end) => end <= item.start);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = item.end;
      item.column = column;
    }
    for (const item of group) result[item.index] = { event: item.event, column: item.column, columnCount: columnEnds.length };
  }

  let group = [];
  let groupEnd = -Infinity;
  for (const item of timed) {
    if (group.length > 0 && item.start >= groupEnd) {
      placeGroup(group);
      group = [];
      groupEnd = -Infinity;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length > 0) placeGroup(group);
  return result;
}

export const DAY_MINUTES = 24 * 60;

// Ett steg frem eller tilbake, målt i den enheten man faktisk ser på. Måned var
// tidligere «30 dager», og da hoppet 31. mars rett forbi april og landet i mai.
export function shiftCalendarDate(date, view, direction) {
  const step = Math.sign(direction);
  if (!step) return new Date(date);
  if (view === "month") {
    const target = new Date(date.getFullYear(), date.getMonth() + step, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
  }
  const next = new Date(date);
  next.setDate(date.getDate() + step * (view === "week" ? 7 : 1));
  return next;
}

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Panelet henger på veggen døgnet rundt, og datoen ble bare satt den gangen
// fanen ble åpnet. Etter midnatt gikk klokka videre mens dagsvisningen ble
// stående på gårsdagen, og da viste panelet noe annet enn Apple Kalender helt
// til noen trykket «I dag».
//
// `trackedToday` er dagen panelet mente var i dag ved forrige måling, og den
// avgjør forskjellen på de to tilfellene: fulgte visningen dagens dato, følger
// den med over skiftet — hadde Ole bladd seg bort til en annen dag, får han bli
// der. Sov iPad-en i flere døgn, lander den på den ekte dagen, ikke på dagen
// etter den den sovnet på.
export function followCalendarDay(date, trackedToday, now) {
  const changed = !sameCalendarDay(trackedToday, now);
  const rolled = changed && sameCalendarDay(date, trackedToday);
  return {
    date: rolled ? new Date(now) : date,
    today: changed ? new Date(now) : trackedToday,
    rolled,
  };
}

// Dagsvisningen dekker hele døgnet, så den kan ikke åpne på midnatt — da ser
// dagen tom ut. Den starter der noe skjer: klokka nå på dagens dato, ellers
// første avtale, og ellers en vanlig morgen.
export function calendarDayScrollMinute(date, events, now, lead = 60) {
  const today = now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth() && now.getDate() === date.getDate();
  const anchor = today ? now.getHours() * 60 + now.getMinutes() : firstEventMinute(events, date);
  return Math.max(0, Math.min(anchor, DAY_MINUTES) - lead);
}

function firstEventMinute(events, date) {
  const minutes = (Array.isArray(events) ? events : [])
    .filter((event) => !event?.allDay && eventOccursOnDay(event, date))
    .map((event) => {
      const start = new Date(event.start);
      return start.getHours() * 60 + start.getMinutes();
    });
  return minutes.length ? Math.min(...minutes) : 8 * 60;
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
    // Raden heter Apple Kalender, så den skal svare for Apple Kalender. Feilet
    // lesingen mens en eldre en fortsatt lå i minnet, sto raden grønn og talte
    // opp hendelser som ikke lenger var hentet fra noe sted — den utdaterte
    // lista så da helt frisk ut. Årsaken finnes, og da er det den som skal stå.
    {
      id: "calendar",
      label: "Apple Kalender",
      ok: Boolean(syncCalendar?.connected) && !syncCalendar?.appleError,
      detail: syncCalendar?.appleError
        || (syncCalendar?.connected ? `${events.length} hendelser hentet` : "Åpne Kalender på Mac-en"),
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

// Hva raden skal si etter et reparasjonsforsøk. Serveren vet hva den prøvde og
// hva som gjenstår; klienten vet om companion-appen på telefonen er for gammel.
// Regelen bor ett sted hver, og settes sammen her — å kopiere den ene inn i den
// andre er hvordan de to kommer ut av takt.
export function describeRepair(result, now = new Date()) {
  if (!result) return null;
  if (result.ok) return { ok: true, detail: result.detail, next: null };
  if (result.id === "mobile" && needsCompanionUpdate(result.metrics, now)) {
    return {
      ok: false,
      detail: "Panelkobling på iPhonen er for gammel og sender ikke sosial tid. Installer den på nytt.",
      next: null,
    };
  }
  return { ok: false, detail: result.detail, next: result.next ?? null };
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
  stalled: { label: "Avsluttet", tone: "ended" },
  needs_input: { label: "Trenger svar", tone: "input" },
  done: { label: "Ferdig", tone: "done" },
};

// Merkelappen sier tilstanden, mens mappa og aktiviteten står hver for seg.
// Dermed forsvinner ikke mappen når en økt jobber, og «ferdig» blandes ikke
// sammen med en tur som stoppet før den rakk å svare.
export function describeAgentSession(session, now = new Date()) {
  const state = AGENT_STATES[session?.state] ?? { label: "Ukjent", tone: "done" };
  const age = formatAgentAge(session?.lastActivityAt, now);
  // Merkelappen sier allerede tilstanden. Detaljen skal si det merkelappen ikke
  // sier — hva økta driver med, og hvor lenge siden. «FERDIG» ved siden av
  // «Fullført» er det samme ordet to ganger, og det stjal plassen fra tittelen.
  const detail = session?.state === "working"
    ? `${session.subagent ? "Underagent jobber" : session.activity ?? "Tenker"} · ${age}`
    : age;
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
  const ended = sessions.filter((session) => session.tone === "ended");
  const needsInput = sessions.filter((session) => session.tone === "input");
  const done = sessions.filter((session) => session.tone === "done");

  const names = [...new Set(busy.map((session) => (session.provider === "codex" ? "Codex" : "Claude")))];
  const headline = busy.length
    ? names.length === 1
      ? `${names[0]} jobber med ${busy.length} ${taskWord(busy.length)}`
      : `${busy.length} ${taskWord(busy.length)} kjører`
    : needsInput.length
      ? `${needsInput.length} ${taskWord(needsInput.length)} trenger svar`
      : done.length
        ? `${done.length} ${taskWord(done.length)} er ${done.length === 1 ? "ferdig" : "ferdige"}`
        : ended.length
          ? `${ended.length} ${taskWord(ended.length)} er avsluttet`
          : "Ingen økter de siste åtte timene";

  return { headline, activeCount: busy.length, count: sessions.length, sessions, empty: sessions.length === 0 };
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

function formatRemaining(milliseconds) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min igjen`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} t ${restMinutes} min igjen` : `${hours} t igjen`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} t igjen` : `${days} d igjen`;
}

// Aktivitetskortet skal først svare på «hva holder jeg på med nå?», men uten
// å gjemme det som kommer etterpå. Derfor returneres begge tilstandene hver for
// seg i stedet for at en fremtidig avtale alltid vinner over en pågående.
export function describeCalendarActivity(events, now = new Date()) {
  const candidates = Array.isArray(events) ? events : [];
  const ongoing = candidates
    .map((event) => ({ event: event ?? {}, start: new Date(event?.start ?? ""), end: new Date(event?.end ?? "") }))
    .filter((entry) => !entry.event.allDay && Number.isFinite(+entry.start) && Number.isFinite(+entry.end) && +entry.start <= +now && +entry.end > +now)
    .sort((a, b) => +a.end - +b.end)[0];

  const current = ongoing
    ? describeEntry(ongoing, {
      ongoing: true,
      when: `Slutter ${formatEventClock(ongoing.end)}`,
      remaining: formatRemaining(+ongoing.end - +now),
    })
    : null;

  const nextEvents = current
    ? candidates.filter((event) => !event?.allDay && +new Date(event?.start ?? "") > +now)
    : candidates;

  return { current, next: describeNextEvent(nextEvents, now) };
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
          .map((app) => ({
            name: formatAppName(app.name),
            icon: socialAppIconKey(app.name),
            value: formatMinutes(app.minutes),
          }))
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
      // Serveren har allerede avgjort dette og sier «device» eller «fallback».
      // Spurte vi i stedet om telefonen noen gang hadde sendt en posisjon, ble
      // svaret aldri nei igjen: kilden blir stående i mellomlageret lenge etter
      // at posisjonen er for gammel til å brukes, og da sa kortet «iPhone» mens
      // det viste været på Mosterøy.
      ["Posisjonskilde", weather.locationSource === "device" ? "iPhone" : "Mosterøy-reserve"],
    ],
  };
}
