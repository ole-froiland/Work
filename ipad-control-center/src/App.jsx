import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsIn,
  ArrowsOut,
  AppWindow,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  ChatCircleText,
  Check,
  CloudSun,
  DeviceMobile,
  DeviceTabletSpeaker,
  DiscordLogo,
  FacebookLogo,
  FolderOpen,
  Footprints,
  GraduationCap,
  InstagramLogo,
  Laptop,
  LinkedinLogo,
  LinkSimple,
  MessengerLogo,
  MonitorArrowUp,
  MoonStars,
  MusicNotes,
  Pause,
  PinterestLogo,
  Play,
  Plus,
  RedditLogo,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  SnapchatLogo,
  SpeakerHigh,
  SpotifyLogo,
  Television,
  ThreadsLogo,
  TiktokLogo,
  TumblrLogo,
  TwitchLogo,
  Wallet,
  Warning,
  WifiHigh,
  X,
  XLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { DAY_MINUTES, buildMetricDetails, buildMonthDays, buildStatusChecks, calendarDayScrollMinute, describeCalendarActivity, describeRepair, describeSyncAge, eventOccursOnDay, eventsOnDay, followCalendarDay, formatMinutes, formatResetTime, formatTimer, layoutDayEvents, describeWake, needsCompanionUpdate, planCalendarDay, readUsageResponse, shiftCalendarDate, subjectSession, summarizeAgentSessions } from "./dashboard.js";
import { createScreenWakeLockController } from "./wake-lock.js";
import { usePolledResource } from "./panel-data.js";
import { callMacAction } from "./mac-action.js";
import { useSpotify } from "./spotify-client.js";

const staticQuickActions = [
  { id: "focus", label: "Fokus", detail: "Slå fokus av og på overalt", icon: MoonStars, tone: "violet" },
  { id: "music", label: "Musikk", detail: "Åpne Spotify på Mac-en", icon: MusicNotes, tone: "blue" },
  { id: "screen-mirror", label: "Skjermdeling", detail: "Koble iPad-en til som skjerm", icon: MonitorArrowUp, tone: "orange" },
];

const macLinkActions = [
  { id: "school", label: "Skole", detail: "Velger et fag automatisk og starter en liten økt", icon: GraduationCap, tone: "violet" },
  { id: "nhh-subjects", label: "NHH-fag", detail: "Åpne fagoversikten i Chrome på Mac-en", icon: GraduationCap, tone: "blue" },
  { id: "link-site", label: "Linksiden", detail: "Åpne lenkesamlingen i Chrome på Mac-en", icon: LinkSimple, tone: "lime" },
  { id: "private-accounts", label: "Privat regnskap", detail: "Åpne privat regnskap i Chrome på Mac-en", icon: Wallet, tone: "orange" },
];

const macLinkActionIds = new Set(macLinkActions.map((action) => action.id));

function isStandaloneApp() {
  return Boolean(window.navigator.standalone) || window.matchMedia("(display-mode: standalone)").matches;
}

// Safaris fullskjerm kan sveipes bort med et drag nedover, og den gesten er
// systemets — `touch-action` og `preventDefault` kommer ikke rundt den. Fra
// Hjem-skjermen finnes det ingen fullskjerm å avslutte, så der er den borte.
function canSwipeOutOfFullscreen() {
  return !isStandaloneApp() && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function setFullscreen(active) {
  if (active) {
    const element = document.documentElement;
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    if (!request) throw new Error("unsupported");
    await request.call(element, { navigationUI: "hide" });
    return;
  }
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit) throw new Error("unsupported");
  await exit.call(document);
}

const calendarTone = { violet: "violet", emerald: "lime", amber: "orange", sky: "blue" };

const socialAppIcons = {
  app: AppWindow,
  discord: DiscordLogo,
  facebook: FacebookLogo,
  instagram: InstagramLogo,
  linkedin: LinkedinLogo,
  messenger: MessengerLogo,
  pinterest: PinterestLogo,
  reddit: RedditLogo,
  snapchat: SnapchatLogo,
  threads: ThreadsLogo,
  tiktok: TiktokLogo,
  tumblr: TumblrLogo,
  twitch: TwitchLogo,
  x: XLogo,
  youtube: YoutubeLogo,
};

function CodexLogo({ size = 18 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function ClaudeLogo({ size = 18 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

function formatUsagePercent(value) {
  if (!Number.isFinite(value)) return "–";
  return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 6 }).format(value)} %`;
}

function UsageProvider({ name, icon: Icon, tone, data, now }) {
  return (
    <div className={`usage-provider ${data?.ok ? "" : "has-error"} ${data?.stale ? "is-stale" : ""}`}>
      <div className="usage-provider-heading">
        <span className={`app-logo ${tone}`}><Icon size={18} /></span>
        <span>
          <strong>{name}{data?.stale && <i>Sist bekreftet</i>}</strong>
          {!data?.ok && <small>{data?.error || "Henter data …"}</small>}
        </span>
      </div>
      {data?.ok && data.windows.map((window) => {
        const reset = formatResetTime(window.resetsAt, window.active, now);
        return (
          <div className={`usage-window ${window.active ? "" : "is-inactive"}`} key={window.key}>
            <div className="usage-window-top"><span>{window.label}</span><span>{formatUsagePercent(window.usedPercent)} brukt</span><strong>{formatUsagePercent(window.remainingPercent)} igjen</strong></div>
            <div className={`usage-bar ${tone}`}><span style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }} /></div>
            <div className="usage-reset"><strong>{reset.countdown}</strong><small>{reset.absolute}</small></div>
          </div>
        );
      })}
    </div>
  );
}

// Kompakt velger: hele pillen bytter til neste verdi og går rundt på slutten.
function FocusCycle({ label, value, options, format, onPick }) {
  const shown = format ? format(value) : value;
  const next = options[(options.indexOf(value) + 1) % options.length];
  return (
    <button
      className="focus-pill"
      type="button"
      aria-label={`${label}: ${shown}. Trykk for å endre`}
      onClick={() => onPick(next)}
    >
      <span>{label}</span>
      <strong>{shown}</strong>
    </button>
  );
}

function QuickAction({ action, onTrigger }) {
  const Icon = action.icon;
  return (
    <button className={`quick-action tone-${action.tone}${action.toggle ? ` is-toggle ${action.active ? "is-on" : "is-off"}` : ""}`} type="button" onClick={() => onTrigger(action)} title={`${action.label} · ${action.detail}`} aria-label={`${action.label} · ${action.detail}`} aria-pressed={action.toggle ? action.active : undefined}>
      <span className="action-icon"><Icon size={28} weight="fill" /></span>
    </button>
  );
}

function MacLinkAction({ action, onTrigger }) {
  const Icon = action.icon;
  return (
    <button className={`right-shortcut tone-${action.tone}`} type="button" onClick={() => onTrigger(action)} title={`${action.label} · ${action.detail}`} aria-label={`${action.label} · ${action.detail}`}>
      <span className="action-icon"><Icon size={28} weight="fill" /></span>
    </button>
  );
}

function appNameFor(provider) {
  return provider === "codex" ? "ChatGPT" : "Claude";
}

// Kortet leser bare det Claude og Codex selv har skrevet i samtaleloggene sine:
// hvilke økter som er i gang, hva de holder på med, og hva som er ferdig. Uten
// logger står det eksplisitt at ingenting kjører – vi gjetter aldri.
function AgentActivityCard({ snapshot, now, onOpen }) {
  // Panelklokka tikker hvert halvminutt, mens kortet hentes hvert tiende sekund.
  // Alderen måles derfor mot det ferskeste av de to, ellers ville en økt som
  // nettopp skrev en linje kunne se eldre ut enn den er.
  const summary = useMemo(() => {
    const read = Date.parse(snapshot?.updatedAt ?? "");
    const clock = Number.isFinite(read) && read > now.getTime() ? new Date(read) : now;
    return summarizeAgentSessions(snapshot, clock);
  }, [snapshot, now]);
  return (
    <section className="panel-card agent-card">
      <div className="section-heading">
        <h2>Oppgaver</h2>
        <span className="count-badge">{summary.count}</span>
      </div>
      {/* Radene sier selv hva som jobber. Sammendraget er derfor bare til når
          det ikke står noen rader å lese: mens vi henter, når lesingen feilet,
          og når det faktisk ikke er noe å vise. */}
      {!summary.sessions.length && <p className="agent-summary">{summary.headline}</p>}
      <ul className="agent-list">
        {summary.sessions.map((session) => (
          <li className={`is-${session.tone}`} key={session.id}>
            <button className="agent-open" type="button" onClick={() => onOpen(session)} aria-label={`Åpne ${session.title} i ${appNameFor(session.provider)} på Mac-en`}>
              <span className={`app-logo ${session.provider === "codex" ? "code" : "claude"}`}>
                {session.provider === "codex" ? <CodexLogo size={17} /> : <ClaudeLogo size={17} />}
              </span>
              <span className="agent-row">
                <strong title={`${session.title} · ${session.project}`}>{session.title}</strong>
                <span className="agent-row-meta">
                  <small className="agent-folder"><FolderOpen size={11} weight="fill" />{session.project || "Ukjent mappe"}</small>
                  {session.tone !== "done" && <i className={`agent-chip is-${session.tone}`}>{session.label}</i>}
                  <small>{session.detail}</small>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const deviceIcons = {
  Computer: Laptop,
  Smartphone: DeviceMobile,
  Tablet: DeviceTabletSpeaker,
  TV: Television,
  Speaker: SpeakerHigh,
  CastVideo: Television,
};

function deviceIconFor(type) {
  return deviceIcons[type] ?? SpeakerHigh;
}

// Kortet styrer Spotify Connect, så knappene treffer enheten som faktisk
// spiller – iPhone, Mac eller iPad – og ikke bare Spotify på Mac-en.
function NowPlayingCard({ onToast, onConfigure }) {
  const { player, track, devices, busy, playing, duration, progressPercent, closeDevices, control, openDevices, pickDevice, connect } = useSpotify({ onToast });

  if (!player) {
    return (
      <section className="panel-card now-playing-card">
        <div className="now-playing-setup"><p>Kobler til Spotify …</p></div>
      </section>
    );
  }

  if (!player.configured || !player.authorized) {
    const needsClientId = !player.configured;
    return (
      <section className="panel-card now-playing-card">
        <div className="now-playing-setup">
          <span className="now-playing-brand"><SpotifyLogo size={19} weight="fill" /> Spotify</span>
          <p>{needsClientId
            ? "Legg inn en Spotify Client ID for å styre musikken på alle enhetene dine."
            : player.error || "Koble panelet til Spotify-kontoen din."}</p>
          <button type="button" onClick={needsClientId ? onConfigure : connect} disabled={busy}>
            {needsClientId ? "Legg inn Client ID" : "Koble til Spotify"}
          </button>
        </div>
      </section>
    );
  }

  const DeviceIcon = deviceIconFor(player.device?.type);

  return (
    <section className="panel-card now-playing-card">
      <div className="now-playing-top">
        <span className="now-playing-art">
          {track?.artwork ? <img src={track.artwork} alt="" /> : <MusicNotes size={20} weight="fill" />}
        </span>
        <span className="now-playing-text">
          <strong>{track?.title || (player.ok ? "Ingenting spilles" : "Spotify svarte ikke")}</strong>
          <small>{player.ok ? (track?.artist || "Velg en enhet og start musikken") : player.error}</small>
        </span>
      </div>

      <div className="now-playing-progress" role="progressbar" aria-label="Avspilt del av sporet" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}>
        <span style={{ width: duration > 0 ? `${progressPercent}%` : "0%" }} />
      </div>

      <div className="now-playing-controls">
        <button type="button" onClick={() => control("previous")} disabled={busy} aria-label="Forrige spor"><SkipBack size={16} weight="fill" /></button>
        <button
          className="is-primary"
          type="button"
          onClick={() => control(playing ? "pause" : "play", { playing: !playing })}
          disabled={busy}
          aria-label={playing ? "Pause" : "Spill av"}
        >
          {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
        </button>
        <button type="button" onClick={() => control("next")} disabled={busy} aria-label="Neste spor"><SkipForward size={16} weight="fill" /></button>
        <button className="now-playing-device" type="button" onClick={openDevices} disabled={busy} aria-label="Velg hvilken enhet som spiller">
          <DeviceIcon size={15} weight="duotone" />
          <strong>{player.device?.name || "Velg enhet"}</strong>
        </button>
      </div>

      {devices && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDevices(); }}>
          <section className="bridge-modal device-picker" role="dialog" aria-modal="true" aria-labelledby="deviceTitle">
            <div className="modal-title">
              <div><span className="eyebrow">Spotify Connect</span><h2 id="deviceTitle">Spill på</h2></div>
              <button type="button" onClick={closeDevices} aria-label="Lukk"><X /></button>
            </div>
            {devices.length > 0 ? (
              <ul className="device-list">
                {devices.map((device) => {
                  const Icon = deviceIconFor(device.type);
                  return (
                    <li key={device.id}>
                      <button
                        className={device.isActive ? "is-active" : ""}
                        type="button"
                        onClick={() => pickDevice(device)}
                        disabled={device.isRestricted}
                        aria-label={device.isActive ? `${device.name} spiller nå` : `Spill på ${device.name}`}
                      >
                        <span className="status-icon tone-lime"><Icon size={19} weight="duotone" /></span>
                        <span><strong>{device.name}</strong><small>{device.isRestricted ? "Kan ikke styres herfra" : device.isActive ? "Spiller nå" : device.type}</small></span>
                        {device.isActive && <i />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="modal-hint">Spotify ser ingen enheter akkurat nå. Åpne Spotify på iPhone, Mac eller iPad, så dukker de opp her.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

// Egen, fast plass for det som faktisk pågår. Når kalenderen ikke har en
// pågående avtale, blir innholdet stående tomt slik at «Neste aktivitet» ikke
// feilaktig ser ut som noe Ole skal gjøre allerede nå.
// Fagkoden står allerede i tittelen over knappen, og på en rail som er 200 px
// bred er hvert tegn den gjentar et tegn tittelen mister. Derfor bare ikonet —
// koden lever i navnet, for den som ikke ser hva ikonet betyr.
function SubjectSessionButton({ session, onStart }) {
  return (
    <button
      className="subject-session"
      type="button"
      aria-label={`Åpne ${session.code} i ChatGPT med en plan for de neste ${session.minutes} minuttene`}
      title={`Åpne ${session.code} i ChatGPT med en plan for de neste ${session.minutes} minuttene`}
      onClick={() => onStart(session)}
    >
      <ChatCircleText size={19} weight="duotone" />
    </button>
  );
}

function CurrentEventCard({ events, now, subjects, onStartSubject }) {
  const current = useMemo(() => describeCalendarActivity(events, now).current, [events, now]);
  const session = subjectSession(current, subjects);

  return (
    <section className={`panel-card current-event-card${current ? ` tone-${calendarTone[current.tone] || "violet"}` : " is-empty"}${session ? " has-subject" : ""}`} aria-label="Akkurat nå">
      <span className="current-event-icon"><CalendarBlank size={17} weight="duotone" /></span>
      <span className="current-event-text">
        <span className="current-event-kicker"><span className="eyebrow">Akkurat nå</span>{current && <em>{current.remaining}</em>}</span>
        {current && <strong title={current.title}>{current.title}</strong>}
      </span>
      {session && <SubjectSessionButton session={session} onStart={onStartSubject} />}
    </section>
  );
}

// Panelet skal aldri stokke om dagen på et gjett uten at det er synlig at
// gjettet er tatt. Og en plan uten ankre er verre enn ingen plan hvis den
// presenteres som fullstendig — derfor sier stripa fra når avtalene mangler.
function WakeBanner({ wake, template, calendarConnected, onCorrect }) {
  const described = useMemo(() => describeWake(wake, template), [wake, template]);
  const [draft, setDraft] = useState("");
  if (!described && calendarConnected) return null;
  return (
    <div className={`wake-banner tone-${described?.tone ?? "amber"}`} role="status">
      <span>
        {described?.text}
        {!calendarConnected && " Avtalene mangler, så bolkene er lagt ut uten dem."}
      </span>
      {described?.needsConfirmation && (
        <span className="wake-correct">
          <label htmlFor="wake-time">Ikke riktig?</label>
          <input id="wake-time" type="time" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="button" disabled={!draft} onClick={() => { onCorrect(draft); setDraft(""); }}>Rett</button>
        </span>
      )}
    </div>
  );
}

// sleepAt er når telefonen ble lagt fra seg, ikke når Ole sovnet. Kortet sier
// «anslått» hver gang tallet vises, i stedet for å la det se ut som en måling.
function SleepRhythmCard({ rhythm }) {
  if (!rhythm) return null;
  if (rhythm.learning) {
    return (
      <section className="panel-card sleep-card" aria-label="Søvnrytme">
        <span className="eyebrow">Søvnrytme</span>
        <p>{`Lærer fortsatt — ${rhythm.nightCount} ${rhythm.nightCount === 1 ? "natt" : "netter"} av tre.`}</p>
      </section>
    );
  }
  return (
    <section className="panel-card sleep-card" aria-label="Søvnrytme">
      <span className="eyebrow">Søvnrytme</span>
      <div className="sleep-times">
        <span><em>Legg deg</em><strong>{rhythm.targetBedtime}</strong></span>
        <span><em>Stå opp</em><strong>{rhythm.targetWake}</strong></span>
      </div>
      <small>{`${formatMinutes(rhythm.timeInBed)} i senga · ${formatMinutes(rhythm.sleepNeed)} søvn, anslått fra ${rhythm.nightCount} netter`}</small>
      {!rhythm.insideWindow && rhythm.windowText && (
        <small className="sleep-toward">{`Der du er nå. På vei mot ${rhythm.windowText}.`}</small>
      )}
      {rhythm.ignoredRecently > 0 && (
        <small className="sleep-ignored">
          {`Leggetiden gikk forbi ${rhythm.ignoredRecently} av de siste 7 nettene. Rytmen strammer ikke inn de nettene.`}
        </small>
      )}
    </section>
  );
}

function DroppedList({ dropped }) {
  if (!dropped?.length) return null;
  return (
    <section className="panel-card dropped-list" aria-label="Dette rakk du ikke">
      <span className="eyebrow">Dette rakk du ikke i dag</span>
      <ul>{dropped.map((block) => <li key={block.id}>{block.title}<em>{block.minutes} min</em></li>)}</ul>
    </section>
  );
}

// Neste avtale fra Apple Kalender, i samme høyde som musikkortet i venstre spalte.
function NextEventCard({ events, connected, now, subjects, onStartSubject }) {
  const next = useMemo(() => describeCalendarActivity(events, now).next, [events, now]);

  if (!next) {
    return (
      <section className="panel-card next-event-card is-empty">
        <span className="eyebrow">Neste aktivitet</span>
        <p>{connected ? "Ingenting mer på planen" : "Apple Kalender kobles til"}</p>
      </section>
    );
  }

  const session = subjectSession(next, subjects);

  return (
    <section className={`panel-card next-event-card tone-${calendarTone[next.tone] || "violet"}`}>
      <div className={`next-event-top${session ? " has-subject" : ""}`}>
        <span className="next-event-icon"><CalendarBlank size={19} weight="duotone" /></span>
        <span className="next-event-text">
          <span className="eyebrow">Neste aktivitet</span>
          <strong title={next.title}>{next.title}</strong>
        </span>
        {session && <SubjectSessionButton session={session} onStart={onStartSubject} />}
      </div>
      <div className="next-event-meta">
        <span>{next.when}</span><strong>{next.countdown}</strong>
      </div>
    </section>
  );
}

const followUpMessages = {
  "claude-login": "Terminal kjører claude auth login på Mac-en. Fullfør i nettleseren som åpner seg.",
  "codex-login": "Terminal er åpnet med codex login på Mac-en.",
  "calendar-privacy": "Personvern er åpnet på Mac-en. Skru på Kalender for Panel.",
};

// Taus når alt virker, tydelig når noe ikke gjør det. Detaljene ligger bak et
// trykk, slik at kortet ikke bruker plass på å fortelle at det går bra.
function StatusStrip({ checks, onRepair, onFollowUp }) {
  const [open, setOpen] = useState(false);
  // Resultatet av et trykk lever bare så lenge modalen er åpen. Neste gang den
  // åpnes skal den vise den ekte statusen, ikke et minutt gammelt utfall.
  const [repairs, setRepairs] = useState({});
  const broken = checks.filter((check) => !check.ok);
  const summary = broken.length === 0
    ? "Alt er tilkoblet"
    : `${broken.length} ${broken.length === 1 ? "ting virker ikke" : "ting virker ikke"}`;

  function close() {
    setOpen(false);
    setRepairs({});
  }

  async function repair(id) {
    if (repairs[id]?.state === "working") return;
    setRepairs((current) => ({ ...current, [id]: { state: "working" } }));
    const outcome = await onRepair(id);
    setRepairs((current) => ({
      ...current,
      [id]: { state: outcome.ok ? "fixed" : "stuck", detail: outcome.detail, next: outcome.next },
    }));
  }

  async function followUp(id, action) {
    setRepairs((current) => ({ ...current, [id]: { ...current[id], state: "working" } }));
    const message = await onFollowUp(action);
    setRepairs((current) => ({ ...current, [id]: { ...current[id], state: "stuck", detail: message } }));
  }

  return (
    <>
      <button
        className={`status-strip ${broken.length ? "has-problem" : ""}`}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${summary}. Trykk for detaljer`}
      >
        {broken.length ? <Warning size={16} weight="fill" /> : <WifiHigh size={16} weight="bold" />}
        <strong>{summary}</strong>
        <CaretRight size={13} weight="bold" />
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="bridge-modal status-modal" role="dialog" aria-modal="true" aria-labelledby="statusTitle">
            <div className="modal-title">
              <div><span className="eyebrow">Tilkobling</span><h2 id="statusTitle">{summary}</h2></div>
              <button type="button" onClick={close} aria-label="Lukk"><X /></button>
            </div>
            <ul className="status-list">
              {checks.map((check) => {
                const repaired = repairs[check.id];
                const working = repaired?.state === "working";
                const ok = repaired ? repaired.state === "fixed" : check.ok;
                return (
                  <li className={`${ok ? "is-ok" : "is-broken"}${working ? " is-working" : ""}`} key={check.id}>
                    <button
                      className="status-row"
                      type="button"
                      onClick={() => repair(check.id)}
                      disabled={working}
                      aria-label={ok ? `Sjekk ${check.label} på nytt` : `Fiks ${check.label}`}
                    >
                      <i />
                      <span>
                        <strong>{check.label}</strong>
                        <small>{working ? "Prøver …" : repaired?.detail ?? check.detail}</small>
                      </span>
                      <ArrowClockwise className={working ? "is-spinning" : ""} size={15} weight="bold" />
                    </button>
                    {repaired?.next && !working && (
                      <button className="status-next" type="button" onClick={() => followUp(check.id, repaired.next.action)}>
                        {repaired.next.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="modal-hint">Trykk på en rad for å fikse den. Panelet gjør alt det kan selv, og sier fra hvis noe gjenstår på Mac-en.</p>
          </section>
        </div>
      )}
    </>
  );
}

function MiniStatus({ icon: Icon, label, value, detail, tone, onClick }) {
  return (
    <button className="mini-status" type="button" onClick={onClick} aria-haspopup="dialog" aria-label={`Vis mer om ${label}`} data-metric-trigger>
      <span className={`status-icon tone-${tone}`}><Icon size={20} weight="duotone" /></span>
      <span><small>{label}</small><strong>{value}</strong>{detail && <em>{detail}</em>}</span>
    </button>
  );
}

function MetricDetail({ metric, metrics }) {
  const detail = buildMetricDetails(metric.id, metrics);
  const Icon = metric.icon;
  return (
      <section className={`metric-popover anchor-${metric.anchor}`} role="dialog" aria-modal="false" aria-labelledby="metricTitle" data-metric-popover>
        <div className="metric-popover-heading">
          <span className={`status-icon tone-${metric.tone}`}><Icon size={22} weight="duotone" /></span>
          <span><small>{detail.eyebrow}</small><h2 id="metricTitle">{detail.title}</h2></span>
          <strong>{detail.summary}</strong>
        </div>
        {detail.notice && <p className="metric-notice">{detail.notice}</p>}
        {detail.apps && <div className="metric-apps">
          <span className="eyebrow">Mest brukt i går</span>
          {detail.apps.length > 0 ? detail.apps.map((app, index) => {
            const AppIcon = socialAppIcons[app.icon] ?? AppWindow;
            return <div key={app.name}><i>{index + 1}</i><b className={`metric-app-icon is-${app.icon}`} aria-hidden="true"><AppIcon size={17} weight="fill" /></b><strong>{app.name}</strong><span>{app.value}</span></div>;
          }) : <p>{detail.appsEmpty}</p>}
        </div>}
        <dl className="metric-details">
          {detail.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>
  );
}

function formatStepComparison(today, average) {
  if (!Number.isFinite(today) || !Number.isFinite(average) || average <= 0) return "Samler 7-dagers snitt";
  const change = Math.round(((today - average) / average) * 100);
  const direction = change >= 0 ? "over" : "under";
  return `Snitt: ${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(average)} · ${Math.abs(change)} % ${direction}`;
}

function isSameCalendarDay(value, date) {
  const eventDate = new Date(value);
  return eventDate.getFullYear() === date.getFullYear() && eventDate.getMonth() === date.getMonth() && eventDate.getDate() === date.getDate();
}

function formatEventTime(value) {
  return new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

// Døgnet er 24 timer høyt og rulles loddrett. Før dekket rutenettet bare
// 08–18, og alt utenfor ble klemt inn i kanten i stedet for å vises der det er.
const DAY_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

function eventStyle(event, column = 0, columnCount = 1) {
  if (event.allDay) return { top: 0, height: "44px" };
  const start = new Date(event.start);
  const end = new Date(event.end);
  const startMinutes = Math.max(0, Math.min(DAY_MINUTES, start.getHours() * 60 + start.getMinutes()));
  const duration = Math.max(30, Math.min(DAY_MINUTES - startMinutes, (+end - +start) / 60_000));
  const horizontal = columnCount > 1
    ? { left: `calc(${(column / columnCount) * 100}% + ${column * 2}px)`, right: "auto", width: `calc(${100 / columnCount}% - 2px)` }
    : {};
  return { top: `${(startMinutes / DAY_MINUTES) * 100}%`, height: `${(duration / DAY_MINUTES) * 100}%`, ...horizontal };
}

function blockStyle(block) {
  const duration = Math.max(30, block.endMinute - block.startMinute);
  return { top: `${(block.startMinute / DAY_MINUTES) * 100}%`, height: `${(duration / DAY_MINUTES) * 100}%` };
}

// Bolkene ligger bak avtalene og er stiplet. En avtale og en bolk er ikke samme
// slags ting, og skal ikke kunne forveksles på en vegg man ser på i forbifarten.
function DayCalendar({ date, events, now, plan = null, done = [], onDone }) {
  const dayEvents = eventsOnDay(events, date);
  const laidOutEvents = layoutDayEvents(dayEvents);
  const showNow = isSameCalendarDay(now, date);
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / DAY_MINUTES) * 100;
  // Er dagen skjøvet, deler de to lagene flaten mellom seg i stedet for å ligge
  // oppå hverandre. Full bredde til begge lot titlene skrive over hverandre, og
  // på en vegg man ser på i forbifarten er to halvlesbare spalter verre enn én.
  const shifted = Boolean(plan && plan.shift > 0 && plan.placed.length > 0);
  // Avhukingen satt bare på skyggen, og skyggen finnes bare på dager Ole sto opp
  // seint. På en dag som gikk etter planen fantes det ingenting å hake av i —
  // altså nettopp de dagene det er noe å hake av for. Den sitter på avtalen nå,
  // som er den som er der uansett.
  const doneIds = new Set((Array.isArray(done) ? done : []).flatMap((entry) => (entry?.id ? [entry.id] : [])));
  return (
    <div className={`day-calendar${shifted ? " is-shifted" : ""}`} aria-label="Dagens kalender">
      {DAY_HOURS.map((hour) => (
        <div className="time-row" key={hour}>
          <time>{hour}:00</time><span />
        </div>
      ))}
      {/* Skyggen tegnes bare når dagen faktisk har flyttet på seg. Står den der
          uansett, ligger den nøyaktig bak avtalekortene og sier ingenting — og
          da er vi tilbake til to plan for samme dag, bare usynlig. */}
      {shifted && (
        <div className="calendar-blocks" aria-label="Dagen slik den faktisk lander">
          {plan.placed.map((block) => (
            <button
              type="button"
              className={`plan-block tone-${calendarTone[block.tone] || "violet"}${block.done ? " is-done" : ""}`}
              style={blockStyle(block)}
              key={block.id}
              onClick={() => onDone?.(block.id)}
              aria-pressed={block.done}
              aria-label={block.done ? `${block.title} er gjort. Trykk for å angre` : `Hak av ${block.title} som gjort`}
            >
              <span className="event-time">{`${formatEventTime(block.start)}–${formatEventTime(block.end)}`}</span>
              <strong>{block.title}</strong>
            </button>
          ))}
        </div>
      )}
      <div className="calendar-events">
        {laidOutEvents.map(({ event, column, columnCount }) => {
          const erGjort = doneIds.has(event.id);
          return (
            <button
              type="button"
              className={`event-card tone-${calendarTone[event.tone] || "violet"}${erGjort ? " is-done" : ""}`}
              style={eventStyle(event, column, columnCount)}
              key={event.id}
              onClick={() => onDone?.(event.id)}
              aria-pressed={erGjort}
              aria-label={erGjort ? `${event.title} er gjort. Trykk for å angre` : `Hak av ${event.title} som gjort`}
            >
              <span className="event-time">{event.allDay ? "Hele dagen" : `${formatEventTime(event.start)}–${formatEventTime(event.end)}`}</span>
              <strong>{event.title}</strong>
              <small>{event.note || event.calendarName || (event.source === "sync" ? "Sync" : event.source)}</small>
            </button>
          );
        })}
      </div>
      {showNow && <div className="now-line" style={{ top: `${nowTop}%` }} aria-label={`Nå klokken ${formatEventTime(now)}`}><span />{formatEventTime(now)}</div>}
    </div>
  );
}

function WeekCalendar({ date, events }) {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  // Hele uken, ikke bare mandag–fredag. Uten lørdag og søndag forsvant dagens
  // dato fra rutenettet i helgene, selv om toppteksten talte med arrangementene.
  const days = Array.from({ length: 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
  return (
    <div className="week-calendar">
      {days.map((day) => (
        <div className={`week-day ${isSameCalendarDay(new Date(), day) ? "is-today" : ""}`} key={day.toISOString()}>
          <span>{new Intl.DateTimeFormat("nb-NO", { weekday: "short" }).format(day)}</span><strong>{day.getDate()}</strong>
          {eventsOnDay(events, day).map((event) => <div className={`week-event sync-event tone-${calendarTone[event.tone] || "violet"}`} key={event.id}><time>{event.allDay ? "Hele dagen" : formatEventTime(event.start)}</time><br /><b>{event.title}</b></div>)}
        </div>
      ))}
    </div>
  );
}

function MonthCalendar({ date, events, onSelectDay, onDropNote }) {
  const days = buildMonthDays(date.getFullYear(), date.getMonth());
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return (
    <div className="month-calendar">
      {["M", "T", "O", "T", "F", "L", "S"].map((day, index) => <span className="month-label" key={`${day}-${index}`}>{day}</span>)}
      {days.map((day, index) => {
        const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
        const count = eventsOnDay(events, cellDate).length;
        return <button
          className={`${day.currentMonth ? "" : "outside"} ${isSameCalendarDay(new Date(), cellDate) ? "today" : ""}`}
          type="button"
          onClick={() => onSelectDay(cellDate)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDropNote(event, cellDate)}
          key={cellDate.toISOString()}
        >
          {day.value}
          {count > 0 && <i title={`${count} arrangement${count === 1 ? "" : "er"}`} />}
        </button>;
      })}
    </div>
  );
}

// Sveip vannrett for å bla i kalenderen. CSS-en gir flaten `touch-action: pan-y`,
// så nettleseren beholder den loddrette rullingen mens vi tolker draget på tvers.
const SWIPE_DISTANCE = 55;

function useCalendarSwipe(onSwipe) {
  const origin = useRef(null);
  const swiped = useRef(false);

  return {
    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      swiped.current = false;
      origin.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerUp(event) {
      const start = origin.current;
      origin.current = null;
      if (!start || start.id !== event.pointerId) return;
      const across = event.clientX - start.x;
      if (Math.abs(across) < SWIPE_DISTANCE || Math.abs(across) <= Math.abs(event.clientY - start.y)) return;
      swiped.current = true;
      onSwipe(across < 0 ? 1 : -1);
    },
    onPointerCancel() { origin.current = null; },
    // Et sveip over månedsrutenettet ender med et klikk på ruten fingeren slapp
    // over. Uten denne ville man både bytte måned og åpne en tilfeldig dag.
    onClickCapture(event) {
      if (!swiped.current) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

// Fire kilder hentet på hver sin takt, med hver sin kopi av den samme løkka.
// Reparasjonen trenger å hente én av dem med én gang den er ferdig — ellers står
// raden rød i opptil et minutt etter at den er i orden — og det gikk ikke så
// lenge løkka var låst inne i en useEffect.
// `refreshUrl` skiller det manuelle trykket fra takten: kalenderen ber Mac-en
// lese Apple Kalender på nytt der, i stedet for å få det siste svaret servert om
// igjen.
function App() {
  const [view, setView] = useState("day");
  const [date, setDate] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const [dayRollovers, setDayRollovers] = useState(0);
  // Fagene som faktisk har et ChatGPT-prosjekt registrert på Mac-en. Panelet
  // henger på veggen i ukevis, så lista hentes på nytt ved døgnskiftet — legger
  // Ole inn et fag, dukker knappen opp av seg selv dagen etter.
  const [connectedSubjects, setConnectedSubjects] = useState([]);
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bridgeUrl, setBridgeUrl] = useState(() => localStorage.getItem("panel-bridge-url") || "");
  const [bridgeDraft, setBridgeDraft] = useState(bridgeUrl);
  const [bridgeState, setBridgeState] = useState(bridgeUrl ? "ready" : "demo");
  const [focusSeconds, setFocusSeconds] = useState(45 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusPhase, setFocusPhase] = useState("idle");
  const [focusSet, setFocusSet] = useState(1);
  const [focusActivity, setFocusActivity] = useState(() => localStorage.getItem("panel-focus-activity") || "");
  const [workMinutes, setWorkMinutes] = useState(() => Number(localStorage.getItem("panel-focus-work")) || 45);
  const [breakMinutes, setBreakMinutes] = useState(() => Number(localStorage.getItem("panel-focus-break")) || 10);
  const [focusSets, setFocusSets] = useState(() => Number(localStorage.getItem("panel-focus-sets")) || 2);
  const [focusModeWanted, setFocusModeWanted] = useState(() => localStorage.getItem("panel-focus-mode") === "on");
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [keepAwakeWanted, setKeepAwakeWanted] = useState(() => localStorage.getItem("panel-keep-awake") === "on");
  const [screenAwake, setScreenAwake] = useState(false);
  const wakeLockController = useRef(null);
  const [usage, refreshUsageData, setUsage] = usePolledResource("/api/usage", {
    interval: 60_000,
    parse: readUsageResponse,
    onError: (current, error) => ({
      updatedAt: new Date().toISOString(),
      codex: { ok: false, error: `Kunne ikke hente bruk (${error.message})` },
      claude: { ok: false, error: `Kunne ikke hente bruk (${error.message})` },
    }),
  });
  const [usageRefreshing, setUsageRefreshing] = useState(false);
  const usageLoading = usage === null || usageRefreshing;
  const [agentSessions, setAgentSessions] = useState(null);
  const [deviceMetrics, refreshDeviceMetrics] = usePolledResource("/api/device-metrics", {
    interval: 60_000,
    onError: (current) => current ?? { screenTime: {}, steps: {}, weather: { ok: false, label: "Mosterøy" }, syncConnected: false },
  });
  const [activeMetric, setActiveMetric] = useState(null);
  const [syncCalendar, refreshSyncCalendar, setSyncCalendar] = usePolledResource("/api/sync-calendar", {
    interval: 30_000,
    refreshUrl: "/api/sync-calendar?force=1",
    initial: { events: [], connected: false, stale: false },
    onError: (current) => ({ ...current, connected: false }),
  });
  const [syncNotes, refreshSyncNotes, setSyncNotes] = usePolledResource("/api/sync-notes", {
    interval: 3_000,
    initial: { notes: [], connected: false, stale: false, pending: 0 },
    onError: (current) => ({ ...current, connected: false }),
  });
  const [dayPlan, refreshDayPlan, setDayPlan] = usePolledResource("/api/day-plan", {
    interval: 30_000,
    initial: { template: null, wake: null, connected: false },
    onError: (current) => ({ ...current, connected: false }),
  });
  const [newNote, setNewNote] = useState("");
  const [calendarComposer, setCalendarComposer] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(fullscreenElement()));
  const [mirrorDevice, setMirrorDevice] = useState(() => localStorage.getItem("panel-mirror-device") || "iPad");
  const [mirrorDraft, setMirrorDraft] = useState(mirrorDevice);
  const [spotifyClientDraft, setSpotifyClientDraft] = useState("");

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const controller = createScreenWakeLockController({
      wakeLock: navigator.wakeLock,
      isVisible: () => document.visibilityState === "visible",
      onActiveChange: setScreenAwake,
    });
    wakeLockController.current = controller;
    const restore = () => controller.handleVisibilityChange();
    document.addEventListener("visibilitychange", restore);
    if (keepAwakeWanted) {
      controller.setWanted(true).then((active) => {
        if (!active) setToast("Skjermen kunne ikke holdes våken. Trykk på Fokus-knappen for å prøve igjen.");
      });
    }
    return () => {
      document.removeEventListener("visibilitychange", restore);
      wakeLockController.current = null;
      controller.destroy();
    };
  }, []);

  // Klokka tikker hvert halve minutt, og hvert tikk spør om døgnet har skiftet
  // under panelet. Regelen ligger i `followCalendarDay`.
  const trackedToday = useRef(now);
  useEffect(() => {
    const rollover = followCalendarDay(date, trackedToday.current, now);
    trackedToday.current = rollover.today;
    if (!rollover.rolled) return;
    setDate(rollover.date);
    setDayRollovers((count) => count + 1);
  }, [now, date]);

  useEffect(() => {
    function syncFullscreen() { setIsFullscreen(Boolean(fullscreenElement())); }
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("webkitfullscreenchange", syncFullscreen);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadAgentSessions() {
      try {
        const response = await fetch("/api/agent-sessions", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = await response.json();
        if (active) setAgentSessions(snapshot);
      } catch (error) {
        if (active) setAgentSessions({ ok: false, error: `Åpne panelet på Mac-en for å se øktene (${error.message})`, sessions: [] });
      }
    }
    loadAgentSessions();
    const interval = window.setInterval(loadAgentSessions, 10_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);


  useEffect(() => {
    if (!focusRunning) return undefined;
    const timer = window.setInterval(() => {
      setFocusSeconds((seconds) => {
        if (seconds <= 1) {
          advanceFocusPhase();
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusRunning, focusPhase, focusSet, focusSets, workMinutes, breakMinutes]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!activeMetric) return undefined;
    const timeout = window.setTimeout(() => setActiveMetric(null), 8_000);
    function closeOnEscape(event) { if (event.key === "Escape") setActiveMetric(null); }
    function closeOutside(event) {
      if (!event.target.closest("[data-metric-popover], [data-metric-trigger]")) setActiveMetric(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [activeMetric]);

  const fullscreenAction = isFullscreen
    ? { id: "fullscreen", label: "Forminsk", detail: "Avslutt fullskjerm", icon: ArrowsIn, tone: "lime" }
    : { id: "fullscreen", label: "Utvid", detail: "Fyll hele skjermen", icon: ArrowsOut, tone: "lime" };
  const focusActionActive = keepAwakeWanted && screenAwake;
  const quickActions = staticQuickActions.map((action) => action.id === "focus"
    ? { ...action, toggle: true, active: focusActionActive, detail: focusActionActive ? "Fokus er på · skjermen holdes våken" : "Slå på Fokus og hold skjermen våken" }
    : action);
  const visibleActions = isStandaloneApp() ? quickActions : [fullscreenAction, ...quickActions];

  const monthTitle = useMemo(() => new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric" }).format(date), [date]);
  const fullDate = useMemo(() => new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "numeric", month: "long" }).format(date), [date]);
  const timeLabel = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(now);
  // Kilden kan være kjent selv om verdiene er for gamle til å vises. Da skal
  // kortet si når mobilen sist sendte, ikke bare «Ikke synket».
  const hasScreenTimeSource = Number.isFinite(deviceMetrics?.screenTime?.socialMinutes);
  const hasStepsSource = Number.isFinite(deviceMetrics?.steps?.today);
  const statusChecks = useMemo(
    () => buildStatusChecks({ syncCalendar, syncNotes, deviceMetrics, usage }, now),
    [syncCalendar, syncNotes, deviceMetrics, usage, now],
  );
  const companionOutdated = needsCompanionUpdate(deviceMetrics, now);
  // Telefonens egen forklaring vinner over alderen. «Sist synket for 44 timer
  // siden» sier hva som ikke skjedde; grunnen sier hva Ole må gjøre med det.
  const screenTimeAge = deviceMetrics?.problems?.screenTime
    ?? (companionOutdated ? "Installer på nytt" : describeSyncAge(deviceMetrics?.sources?.screenTime, now, "Device Activity · iPhone + iPad"));
  const stepsAge = deviceMetrics?.problems?.steps
    ?? describeSyncAge(deviceMetrics?.sources?.steps, now, "HealthKit · Apple Helse");
  // Om posisjonen er fersk nok til å brukes, ikke om telefonen en gang sendte
  // en. Serveren faller tilbake til Mosterøy etter et døgn, og det skal kortet
  // si fra om i stedet for å påstå at været gjelder der Ole står.
  const hasLocationSource = deviceMetrics?.weather?.locationSource === "device";
  const calendarEvents = Array.isArray(syncCalendar.events) ? syncCalendar.events : [];
  const selectedDayEvents = eventsOnDay(calendarEvents, date);
  const plannedDay = useMemo(() => {
    if (!dayPlan.template) return null;
    return planCalendarDay({
      events: selectedDayEvents,
      wokeAt: dayPlan.wake?.wokeAt ?? null,
      wakeAnchor: dayPlan.template.wakeAnchor,
      dayEnd: dayPlan.template.dayEnd,
      day: date,
      done: dayPlan.wake?.done ?? [],
    });
  }, [dayPlan.template, dayPlan.wake, selectedDayEvents, date]);
  // «Akkurat nå» og «Neste aktivitet» leste den uskjøvede kalenderen, mens
  // rutenettet under viste den skjøvede. Panelet sa da to ting samtidig: kortet
  // fulgte papiret, rutenettet fulgte Ole. Kortene handler om *nå*, ikke om den
  // datoen Ole har bladd seg fram til, så dagens plan regnes ut for seg — ellers
  // ville «Akkurat nå» endre seg av å bla i kalenderen.
  const todayKey = now.toDateString();
  const activityEvents = useMemo(() => {
    if (!dayPlan.template) return calendarEvents;
    const today = new Date(todayKey);
    const plan = planCalendarDay({
      events: eventsOnDay(calendarEvents, today),
      wokeAt: dayPlan.wake?.wokeAt ?? null,
      wakeAnchor: dayPlan.template.wakeAnchor,
      dayEnd: dayPlan.template.dayEnd,
      day: today,
      done: dayPlan.wake?.done ?? [],
    });
    if (plan.shift <= 0) return calendarEvents;
    // Bare tidene flyttes. Resten av avtalen blir med som den er, ellers mister
    // kortet kalendernavnet og fagknappen sitt grunnlag.
    const original = new Map(calendarEvents.map((event) => [event.id, event]));
    const rørt = new Set([...plan.placed, ...plan.dropped].map((block) => block.id));
    const flyttet = plan.placed.map((block) => ({ ...(original.get(block.id) ?? {}), start: block.start, end: block.end }));
    // Det som ikke fikk plass før dagen er over står i «dette rakk du ikke», og
    // skal ikke også dukke opp som noe Ole er på vei til.
    return [...calendarEvents.filter((event) => !rørt.has(event.id)), ...flyttet];
  }, [dayPlan.template, dayPlan.wake, calendarEvents, todayKey]);
  const plannedMinutes = selectedDayEvents.reduce((total, event) => total + Math.max(0, (+new Date(event.end) - +new Date(event.start)) / 60_000), 0);
  const calendarStage = useRef(null);
  const calendarSwipe = useCalendarSwipe(moveDate);
  // Kalenderen henter nye arrangementer hvert halve minutt. Rullingen leser dem
  // fra en ref, ellers ville hvert svar fra Mac-en rykke flaten tilbake mens
  // Ole leser i den.
  const dayContext = useRef(null);
  dayContext.current = { date, events: calendarEvents };

  // Bare når visningen byttes — og når døgnet skifter under panelet. Sveiper
  // man selv videre til neste dag, blir man stående på samme klokkeslett, slik
  // Kalender på iPad gjør det; et midnattsskifte er ikke et sveip, og da skal
  // flaten begynne på den nye dagen i stedet for å bli hengende igjen i går
  // kveld.
  useEffect(() => {
    const stage = calendarStage.current;
    if (!stage) return;
    const grid = view === "day" ? stage.querySelector(".day-calendar") : null;
    if (!grid) {
      stage.scrollTop = 0;
      return;
    }
    const { date: day, events } = dayContext.current;
    stage.scrollTop = Math.round((calendarDayScrollMinute(day, events, new Date()) / DAY_MINUTES) * grid.offsetHeight);
  }, [view, dayRollovers]);
  // Svarer serveren ikke, blir lista stående tom, og kortene ser ut som før.
  // Det er riktigere enn en knapp som ikke vet om den fører noe sted.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/subjects")
      .then((response) => (response.ok ? response.json() : { connected: [] }))
      .then((result) => { if (!cancelled) setConnectedSubjects(Array.isArray(result?.connected) ? result.connected : []); })
      .catch(() => { if (!cancelled) setConnectedSubjects([]); });
    return () => { cancelled = true; };
  }, [dayRollovers]);
  // Slår Fokus på Mac-en av/på. Med delt fokus følger iPhone og iPad etter.
  async function setFocusMode(enabled, { quiet = false, force = false } = {}) {
    if (enabled === focusModeActive && !force) return true;
    try {
      await callMacAction({ action: "focus-mode", enabled });
      setFocusModeActive(enabled);
      if (!quiet) setToast(enabled ? "Fokus er på på alle enhetene dine" : "Fokus er slått av");
      return true;
    } catch (error) {
      setToast(`Fokusmodus: ${error.message}`);
      return false;
    }
  }

  function focusPhaseSeconds(phase) {
    return (phase === "break" ? breakMinutes : workMinutes) * 60;
  }

  function advanceFocusPhase() {
    if (focusPhase === "work" && focusSet < focusSets) {
      setFocusPhase("break");
      setFocusSeconds(breakMinutes * 60);
      setToast(`Pause i ${breakMinutes} min`);
      return;
    }
    if (focusPhase === "break") {
      setFocusPhase("work");
      setFocusSet((current) => current + 1);
      setFocusSeconds(workMinutes * 60);
      setToast(`Sett ${focusSet + 1} av ${focusSets}`);
      return;
    }
    setFocusRunning(false);
    setFocusPhase("idle");
    setFocusSet(1);
    setFocusSeconds(workMinutes * 60);
    setToast("Fokusøkten er fullført");
    if (focusModeWanted) setFocusMode(false, { quiet: true });
  }

  async function startFocusSession() {
    localStorage.setItem("panel-focus-activity", focusActivity);
    setFocusPhase("work");
    setFocusSet(1);
    setFocusSeconds(workMinutes * 60);
    setFocusRunning(true);
    if (focusModeWanted) await setFocusMode(true, { quiet: true });
  }

  function stopFocusSession() {
    setFocusRunning(false);
    setFocusPhase("idle");
    setFocusSet(1);
    setFocusSeconds(workMinutes * 60);
    if (focusModeWanted) setFocusMode(false, { quiet: true });
  }

  function updateFocusSetting(key, value) {
    localStorage.setItem(`panel-focus-${key}`, String(value));
    if (key === "work") { setWorkMinutes(value); if (focusPhase === "idle") setFocusSeconds(value * 60); }
    if (key === "break") setBreakMinutes(value);
    if (key === "sets") setFocusSets(value);
  }

  async function toggleFocusMode() {
    const enabled = !keepAwakeWanted;
    setKeepAwakeWanted(enabled);
    localStorage.setItem("panel-keep-awake", enabled ? "on" : "off");
    const wakeLockReady = await wakeLockController.current?.setWanted(enabled);
    if (enabled && !wakeLockReady) {
      setKeepAwakeWanted(false);
      localStorage.setItem("panel-keep-awake", "off");
      setToast("Safari kunne ikke holde skjermen våken. Oppdater iPadOS eller åpne panelet fra Hjem-skjermen.");
      return;
    }
    await setFocusMode(enabled, { force: true });
  }

  function toggleFocusModeWanted() {
    const next = !focusModeWanted;
    setFocusModeWanted(next);
    localStorage.setItem("panel-focus-mode", next ? "on" : "off");
    if (focusRunning) setFocusMode(next, { quiet: true });
  }

  async function toggleFullscreen() {
    const entering = !fullscreenElement();
    try {
      await setFullscreen(entering);
    } catch (error) {
      setToast(error.message === "unsupported" ? "Fullskjerm støttes ikke i denne nettleseren" : "Nettleseren blokkerte fullskjerm");
    }
    const active = Boolean(fullscreenElement());
    setIsFullscreen(active);
    // Panelet hopper ut av fullskjerm ved et sveip nedover, og det ser ut som en
    // feil i panelet. Si hvor det kommer fra der man møter det.
    if (entering && active && canSwipeOutOfFullscreen()) {
      setToast("Safari lukker fullskjerm ved sveip ned. Legg panelet på Hjem-skjermen, så er gesten borte.");
    }
  }

  // Én reparasjon per rad. Kilden hentes på nytt med én gang sekvensen er ferdig,
  // slik at raden viser den ekte statusen og ikke venter på neste polling.
  async function repairConnection(id) {
    try {
      const response = await fetch("/api/connections/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      await refreshConnection(id);
      return describeRepair(result, new Date());
    } catch (error) {
      return { ok: false, detail: `Nådde ikke Mac-en (${error.message})`, next: null };
    }
  }

  function refreshConnection(id) {
    if (id === "calendar") return refreshSyncCalendar();
    if (id === "notes") return refreshSyncNotes();
    if (id === "mobile") return refreshDeviceMetrics();
    return refreshUsageData();
  }

  // Siste steget, det panelet ikke kan gjøre ferdig alene. Svaret havner i raden
  // i stedet for i en toast, siden det er raden Ole ser på.
  async function runRepairFollowUp(action) {
    try {
      await callMacAction({ action });
      return followUpMessages[action] ?? "Åpnet på Mac-en";
    } catch (error) {
      return `Fikk det ikke åpnet på Mac-en (${error.message})`;
    }
  }

  async function runOnMac(body, { done, failed }) {
    try {
      setToast(done(await callMacAction(body)));
    } catch (error) {
      setToast(`${failed} (${error.message})`);
    }
  }

  // Kortet forteller at noe kjører; trykket skal svare på «vis meg det». Mac-en
  // eier både øktene og appene, så den finner adressen og åpner riktig app.
  async function openAgentSession(session) {
    const app = appNameFor(session.provider);
    await runOnMac({ action: "open-agent-session", provider: session.provider, id: session.id }, {
      done: () => `«${session.title}» åpnes i ${app} på Mac-en`,
      failed: `Fikk ikke åpnet «${session.title}» i ${app}`,
    });
  }

  // Ett trykk skal ta Ole helt fram: Mac-en åpner fagets ChatGPT-prosjekt og
  // fyller inn den ferdige prompten. Send-knappen blir stående urørt, slik at
  // Ole kan se over starten før samtalen begynner.
  async function startSubjectSession({ code, minutes, title }) {
    await runOnMac({ action: "subject-session", code, minutes, title }, {
      done: () => minutes
        ? `${code} er åpnet i ChatGPT — planen for ${minutes} min er fylt inn`
        : `${code} er åpnet i ChatGPT — en liten startoppgave er fylt inn`,
      failed: `Fikk ikke startet ${code}-økta på Mac-en`,
    });
  }

  async function triggerAction(action) {
    window.dispatchEvent(new CustomEvent("mac-action", { detail: { action: action.id } }));
    if (action.id === "school") {
      await runOnMac({ action: "school-session" }, {
        done: (result) => `${result.label} ble valgt — en liten startoppgave er fylt inn i ChatGPT`,
        failed: "Kunne ikke starte en skoleøkt på Mac-en",
      });
      return;
    }
    if (action.id === "fullscreen") {
      await toggleFullscreen();
      return;
    }
    if (action.id === "focus") {
      await toggleFocusMode();
      return;
    }
    if (action.id === "music") {
      await runOnMac({ action: "spotify" }, {
        done: (result) => result.target === "app" ? "Spotify åpnes på Mac-en" : "Spotify Web åpnes på Mac-en",
        failed: "Kunne ikke åpne Spotify på Mac-en",
      });
      return;
    }
    if (action.id === "screen-mirror") {
      await runOnMac({ action: "screen-mirror", device: mirrorDevice }, {
        done: (result) => result.state === "connected" ? `${result.label} er koblet til som ekstra skjerm` : `${result.label} er koblet fra`,
        failed: "Kunne ikke koble til skjermen",
      });
      return;
    }
    if (macLinkActionIds.has(action.id)) {
      await runOnMac({ action: action.id }, {
        done: () => `${action.label} åpnes i Chrome på Mac-en`,
        failed: `Kunne ikke åpne ${action.label} på Mac-en`,
      });
      return;
    }
    if (!bridgeUrl) {
      setToast(`${action.label} aktivert i demo-modus`);
      return;
    }
    setBridgeState("sending");
    try {
      const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action.id }),
      });
      if (!response.ok) throw new Error("Bridge request failed");
      setBridgeState("ready");
      setToast(`${action.label} sendt til Mac-en`);
    } catch {
      setBridgeState("error");
      setToast("Fikk ikke kontakt med Mac-broen");
    }
  }

  // Client ID lagres bare på Mac-en, aldri i nettleseren.
  async function saveSpotifyClientId() {
    const clientId = spotifyClientDraft.trim();
    if (!clientId) return true;
    try {
      const response = await fetch("/api/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "configure", clientId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setSpotifyClientDraft("");
      return true;
    } catch (error) {
      setToast(`Spotify: ${error.message}`);
      return false;
    }
  }

  async function saveBridge(event) {
    event.preventDefault();
    if (!(await saveSpotifyClientId())) return;
    const device = mirrorDraft.trim() || "iPad";
    setMirrorDevice(device);
    localStorage.setItem("panel-mirror-device", device);
    const value = bridgeDraft.trim().replace(/\/$/, "");
    setBridgeUrl(value);
    setBridgeState(value ? "ready" : "demo");
    if (value) localStorage.setItem("panel-bridge-url", value);
    else localStorage.removeItem("panel-bridge-url");
    setSettingsOpen(false);
    setToast(value ? "Mac-bro lagret" : "Demo-modus aktivert");
  }

  function moveDate(direction) {
    setDate(shiftCalendarDate(date, view, direction));
  }

  function openDay(day) {
    setDate(day);
    setView("day");
  }

  async function queueNoteCommand(command) {
    const response = await fetch("/api/sync-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "command", ...command }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setSyncNotes((current) => ({ ...current, pending: current.pending + 1 }));
  }

  async function completeSyncNote(note) {
    setSyncNotes((current) => ({ ...current, notes: current.notes.filter((candidate) => candidate.id !== note.id) }));
    try {
      await queueNoteCommand({ type: "complete", noteId: note.id });
      setToast(`«${note.title}» fullføres i Sync`);
    } catch {
      setToast("Kunne ikke sende notatet til Sync");
    }
  }

  async function addSyncNote(event) {
    event.preventDefault();
    const title = newNote.trim();
    if (!title) return;
    setNewNote("");
    try {
      await queueNoteCommand({ type: "create", title });
      setToast("Notatet sendes til Sync");
    } catch {
      setNewNote(title);
      setToast("Kunne ikke sende notatet til Sync");
    }
  }

  async function correctWake(clock) {
    const [hours, minutes] = clock.split(":").map(Number);
    const wokeAt = new Date();
    wokeAt.setHours(hours, minutes, 0, 0);
    try {
      const response = await fetch("/api/day-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "wake", source: "manual", wokeAt: wokeAt.toISOString() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setDayPlan((current) => ({ ...current, wake: result.wake }));
      setToast("Dagen er lagt ut på nytt");
    } catch (error) {
      setToast(`Kunne ikke rette tidspunktet (${error.message})`);
    }
  }

  async function markDone(id) {
    try {
      const response = await fetch("/api/day-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "done", id, at: new Date().toISOString() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setDayPlan((current) => ({ ...current, wake: result.wake }));
    } catch (error) {
      setToast(`Kunne ikke huke av bolken (${error.message})`);
    }
  }

  function openCalendarComposer(day = date, title = "", noteId = null) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const localValue = (value) => {
      const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
      return shifted.toISOString().slice(0, 16);
    };
    setCalendarComposer({ title, start: localValue(start), end: localValue(end), noteId });
  }

  function dropNoteInCalendar(event, day = date) {
    event.preventDefault();
    event.stopPropagation();
    try {
      const note = JSON.parse(event.dataTransfer.getData("application/x-sync-note"));
      if (note?.title) openCalendarComposer(day, note.title, note.id ?? null);
    } catch {
      setToast("Kunne ikke lese notatet");
    }
  }

  async function saveCalendarEvent(event) {
    event.preventDefault();
    const title = calendarComposer?.title.trim();
    if (!title) return;
    try {
      const response = await fetch("/api/sync-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "mutation",
          operation: "create",
          events: [{ title, start: new Date(calendarComposer.start).toISOString(), end: new Date(calendarComposer.end).toISOString(), noteId: calendarComposer.noteId }],
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setSyncCalendar((current) => ({ ...current, connected: true, events: [...current.events, ...(result.events ?? [])] }));
      setCalendarComposer(null);
      setToast("Lagt inn i Apple Kalender");
    } catch (error) {
      setToast(`Kunne ikke legge inn hendelsen (${error.message})`);
    }
  }

  async function refreshUsage() {
    setUsageRefreshing(true);
    try {
      const response = await fetch("/api/usage?refresh=1", { cache: "no-store" });
      setUsage(await readUsageResponse(response));
      setToast("Bruksdata er oppdatert");
    } catch {
      setToast("Kunne ikke oppdatere bruksdata");
    } finally {
      setUsageRefreshing(false);
    }
  }

  return (
    <main className={`dashboard-shell${isFullscreen ? " is-fullscreen" : ""}`}>
      <section className="dashboard-grid">
        <aside className="left-rail" aria-label="Hurtigpanel">
          <section className="quick-grid">
            {visibleActions.map((action) => <QuickAction action={action} onTrigger={triggerAction} key={action.id} />)}
          </section>

          <NowPlayingCard onToast={setToast} onConfigure={() => setSettingsOpen(true)} />

          <section className="panel-card usage-card">
            <div className="section-heading usage-heading">
              <div><h2>AI-bruk</h2></div>
              <button className={usageLoading ? "is-spinning" : ""} type="button" onClick={refreshUsage} disabled={usageLoading} aria-label="Oppdater bruksdata"><ArrowClockwise size={17} weight="bold" /></button>
            </div>
            <UsageProvider name="Codex" icon={CodexLogo} tone="code" data={usage?.codex} now={now} />
            <UsageProvider name="Claude" icon={ClaudeLogo} tone="claude" data={usage?.claude} now={now} />
          </section>

          <AgentActivityCard snapshot={agentSessions} now={now} onOpen={openAgentSession} />
        </aside>

        <section className="calendar-panel panel-card">
          <div className="calendar-toolbar">
            <div className="calendar-title-block">
              <span className="eyebrow">Kalender</span>
              <div className="calendar-title-line"><h1>{monthTitle}</h1><span className="calendar-now"><small>{fullDate}</small><strong>{timeLabel}</strong></span></div>
            </div>
            <div className="toolbar-actions">
              <div className="date-nav"><button type="button" onClick={() => moveDate(-1)} aria-label="Forrige"><CaretLeft /></button><button type="button" onClick={() => setDate(new Date())}>I dag</button><button type="button" onClick={() => moveDate(1)} aria-label="Neste"><CaretRight /></button></div>
              <div className="view-controls">
                <div className="view-tabs" role="tablist">
                  {[{ id: "month", label: "Måned" }, { id: "week", label: "Uke" }, { id: "day", label: "Dag" }].map((tab) => <button className={view === tab.id ? "active" : ""} type="button" role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)} key={tab.id}>{tab.label}</button>)}
                </div>
                <button className="calendar-settings" type="button" onClick={() => setSettingsOpen(true)} aria-label="Åpne panelinnstillinger"><span className={`connection-dot ${bridgeState}`} /><SlidersHorizontal size={17} /></button>
              </div>
            </div>
          </div>
          <div className="calendar-date-strip"><CalendarBlank size={19} weight="duotone" /><strong>{syncCalendar.connected ? `${selectedDayEvents.length} arrangement${selectedDayEvents.length === 1 ? "" : "er"}` : "Apple Kalender kobles til"}</strong><span>{syncCalendar.connected ? `${formatMinutes(plannedMinutes)} planlagt${syncCalendar.stale ? " · sist synket" : ""}` : "Venter på Kalender på Mac-en"}</span><button className="calendar-add" type="button" onClick={() => openCalendarComposer()} aria-label="Nytt arrangement"><Plus size={16} weight="bold" /> Ny</button></div>
          <div className="calendar-banner-slot">{view === "day" && dayPlan.connected && <WakeBanner wake={dayPlan.wake} template={dayPlan.template} calendarConnected={syncCalendar.connected} onCorrect={correctWake} />}</div>
          <div className="calendar-stage" ref={calendarStage} {...calendarSwipe} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropNoteInCalendar(event)}>
            {view === "day" && <DayCalendar date={date} events={calendarEvents} now={now} plan={plannedDay} done={dayPlan.wake?.done ?? []} onDone={markDone} />}
            {view === "week" && <WeekCalendar date={date} events={calendarEvents} />}
            {view === "month" && <MonthCalendar date={date} events={calendarEvents} onSelectDay={openDay} onDropNote={dropNoteInCalendar} />}
          </div>
          {view === "day" && <DroppedList dropped={plannedDay?.dropped} />}
          {view === "day" && dayPlan.connected && <SleepRhythmCard rhythm={dayPlan.rhythm} />}
          <footer className="system-strip">
            <MiniStatus icon={Laptop} label="Sosiale medier" value={hasScreenTimeSource ? formatMinutes(deviceMetrics?.screenTime?.socialMinutes) : companionOutdated ? "Utdatert app" : "Ikke synket"} detail={hasScreenTimeSource ? `I går · uke ${formatMinutes(deviceMetrics?.screenTime?.socialWeeklyAverageMinutes)}` : screenTimeAge} tone="violet" onClick={() => setActiveMetric((current) => current?.id === "screenTime" ? null : { id: "screenTime", icon: Laptop, tone: "violet", anchor: 0 })} />
            <MiniStatus icon={Footprints} label="Skritt · i dag" value={hasStepsSource ? new Intl.NumberFormat("nb-NO").format(deviceMetrics.steps.today) : "Ikke synket"} detail={hasStepsSource ? formatStepComparison(deviceMetrics?.steps?.today, deviceMetrics?.steps?.weeklyAverage) : stepsAge} tone="lime" onClick={() => setActiveMetric((current) => current?.id === "steps" ? null : { id: "steps", icon: Footprints, tone: "lime", anchor: 1 })} />
            <MiniStatus icon={CloudSun} label={`${deviceMetrics?.weather?.label || "Mosterøy"}${hasLocationSource ? "" : " · reserve"}`} value={deviceMetrics?.weather?.ok ? `${Math.round(deviceMetrics.weather.temperature)}° · ${deviceMetrics.weather.condition}` : "Vær utilgjengelig"} detail={hasLocationSource && deviceMetrics?.weather?.ok && Number.isFinite(deviceMetrics.weather.apparentTemperature) ? `Føles som ${Math.round(deviceMetrics.weather.apparentTemperature)}°` : "Koble iPhone for posisjon"} tone="orange" onClick={() => setActiveMetric((current) => current?.id === "weather" ? null : { id: "weather", icon: CloudSun, tone: "orange", anchor: 2 })} />
            {activeMetric && <MetricDetail metric={activeMetric} metrics={deviceMetrics} />}
          </footer>
        </section>

        <aside className="right-rail" aria-label="Mac-snarveier, fokus og Sync-notater">
          <section className="right-shortcuts" aria-label="Åpne på Mac-en">
            {macLinkActions.map((action) => <MacLinkAction action={action} onTrigger={triggerAction} key={action.id} />)}
          </section>

          <CurrentEventCard events={activityEvents} now={now} subjects={connectedSubjects} onStartSubject={startSubjectSession} />
          <NextEventCard events={activityEvents} connected={syncCalendar.connected} now={now} subjects={connectedSubjects} onStartSubject={startSubjectSession} />

          <section className={`panel-card focus-card ${focusPhase === "break" ? "is-break" : ""}`}>
            <div className="focus-top">
              <span className="eyebrow">{focusPhase === "break" ? "Pause" : "Fokusøkt"}</span>
              {focusPhase !== "idle" && <span className="focus-state">{`Sett ${focusSet}/${focusSets}`}</span>}
              <button
                className={`focus-chip ${focusModeWanted ? "is-on" : ""}`}
                type="button"
                role="switch"
                aria-checked={focusModeWanted}
                aria-label="Fokus på alle enheter"
                title="Fokus på alle enheter"
                onClick={toggleFocusModeWanted}
              >
                <MoonStars size={17} weight="fill" />
              </button>
            </div>

            <strong className="focus-time">{formatTimer(focusSeconds)}</strong>

            {focusPhase === "idle" ? (
              <div className="focus-setup">
                <input
                  className="focus-activity"
                  value={focusActivity}
                  onChange={(event) => setFocusActivity(event.target.value)}
                  placeholder="Hva jobber du med?"
                  aria-label="Aktivitet for fokusøkten"
                />
                <div className="focus-segment" role="group" aria-label="Lengde på økt">
                  {[25, 45, 60, 90].map((minutes) => (
                    <button className={workMinutes === minutes ? "is-picked" : ""} type="button" key={minutes} onClick={() => updateFocusSetting("work", minutes)}>{minutes} min</button>
                  ))}
                </div>
                <div className="focus-duo">
                  <FocusCycle label="Pause" value={breakMinutes} options={[5, 10, 15, 20, 30]} format={(value) => `${value} min`} onPick={(value) => updateFocusSetting("break", value)} />
                  <FocusCycle label="Sett" value={focusSets} options={[1, 2, 3, 4, 5, 6]} onPick={(value) => updateFocusSetting("sets", value)} />
                </div>
              </div>
            ) : (
              <p className="focus-now">{focusPhase === "break" ? "Reis deg og strekk på deg" : (focusActivity || "Én ting av gangen")}</p>
            )}

            <div className="focus-actions">
              {focusPhase === "idle" ? (
                <button className="focus-primary" type="button" onClick={startFocusSession}><Play weight="fill" /> Start økt</button>
              ) : (
                <>
                  <button className="focus-primary" type="button" onClick={() => setFocusRunning((running) => !running)}>{focusRunning ? <Pause weight="fill" /> : <Play weight="fill" />} {focusRunning ? "Pause" : "Fortsett"}</button>
                  <button className="icon-button" type="button" aria-label="Hopp til neste del" onClick={advanceFocusPhase}><SkipForward weight="fill" /></button>
                  <button className="icon-button" type="button" aria-label="Avslutt økten" onClick={stopFocusSession}><ArrowCounterClockwise /></button>
                </>
              )}
            </div>
          </section>

          <section className="panel-card task-card">
            <div className="section-heading"><div><span className="eyebrow">Sync</span><h2>Notater</h2></div><span className="task-count">{syncNotes.connected ? syncNotes.notes.length : "–"}</span></div>
            <ul className="task-list">
              {syncNotes.notes.map((note) => <li draggable onDragStart={(event) => event.dataTransfer.setData("application/x-sync-note", JSON.stringify(note))} key={note.id}><button type="button" onClick={() => completeSyncNote(note)} aria-label={`Fullfør ${note.title}`} /><span>{note.title}</span><button className="note-calendar" type="button" onClick={() => openCalendarComposer(date, note.title, note.id)} aria-label={`Legg ${note.title} i kalenderen`}><CalendarBlank size={16} /></button></li>)}
            </ul>
            {syncNotes.notes.length === 0 && <p className="notes-empty">{syncNotes.connected ? "Ingen aktive notater" : "Åpne Sync på Mac-en for å koble til"}</p>}
            <form className="add-task" onSubmit={addSyncNote}><Plus size={17} /><input value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Skriv et notat" aria-label="Nytt Sync-notat" /><button type="submit">Legg til</button></form>
          </section>

          <StatusStrip checks={statusChecks} onRepair={repairConnection} onFollowUp={runRepairFollowUp} />
        </aside>
      </section>

      {toast && <div className="toast" role="status"><Check size={18} weight="bold" />{toast}</div>}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="bridge-modal" role="dialog" aria-modal="true" aria-labelledby="bridgeTitle">
            <button className="modal-close" type="button" aria-label="Lukk" onClick={() => setSettingsOpen(false)}><X /></button>
            <span className="modal-icon"><Laptop size={28} weight="duotone" /></span>
            <span className="eyebrow">Tilkobling</span>
            <h2 id="bridgeTitle">Koble til Mac-en</h2>
            <p>Panelet sender handlinger som JSON til en liten lokal bro på Mac-en. Uten en URL kjører knappene trygt i demo-modus.</p>
            <form onSubmit={saveBridge}>
              <label htmlFor="bridgeUrl">Adresse til Mac-bro</label>
              <input id="bridgeUrl" type="url" value={bridgeDraft} onChange={(event) => setBridgeDraft(event.target.value)} placeholder="http://macbook.local:3030" />
              <label htmlFor="mirrorDevice">Enhet for skjermdeling</label>
              <input id="mirrorDevice" type="text" value={mirrorDraft} onChange={(event) => setMirrorDraft(event.target.value)} placeholder="iPad" />
              <label htmlFor="spotifyClientId">Spotify Client ID</label>
              <input id="spotifyClientId" type="text" value={spotifyClientDraft} onChange={(event) => setSpotifyClientDraft(event.target.value)} placeholder="Lagret på Mac-en" autoComplete="off" spellCheck="false" />
              <p className="modal-hint">Musikkortet styrer Spotify Connect, altså enheten som faktisk spiller. Lag en app på developer.spotify.com med adressen <code>http://127.0.0.1:4173/api/spotify/callback</code>, lim inn Client ID-en her og fullfør innloggingen i nettleseren på Mac-en. Feltet er tomt fordi ID-en bare ligger på Mac-en.</p>
              <p className="modal-hint">Fokusknappen kjører snarveiene «Fokus på» og «Fokus av» på Mac-en. De er allerede installert. For at iPhone og iPad skal følge etter må «Del på tvers av enheter» være på i Systeminnstillinger → Fokus.</p>
              <div className="modal-actions"><button type="button" onClick={() => { setBridgeDraft(""); }}>Bruk demo</button><button type="submit">Lagre tilkobling</button></div>
            </form>
          </section>
        </div>
      )}

      {calendarComposer && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalendarComposer(null); }}>
          <section className="bridge-modal calendar-composer" role="dialog" aria-modal="true" aria-labelledby="calendarComposerTitle">
            <div className="modal-title"><div><span className="eyebrow">Apple Kalender</span><h2 id="calendarComposerTitle">Nytt arrangement</h2></div><button type="button" onClick={() => setCalendarComposer(null)} aria-label="Lukk"><X /></button></div>
            <form className="bridge-form" onSubmit={saveCalendarEvent}>
              <label htmlFor="calendarTitle">Navn</label>
              <input id="calendarTitle" value={calendarComposer.title} onChange={(event) => setCalendarComposer((current) => ({ ...current, title: event.target.value }))} autoFocus required />
              <div className="calendar-time-fields">
                <label>Start<input type="datetime-local" value={calendarComposer.start} onChange={(event) => setCalendarComposer((current) => ({ ...current, start: event.target.value }))} required /></label>
                <label>Slutt<input type="datetime-local" value={calendarComposer.end} onChange={(event) => setCalendarComposer((current) => ({ ...current, end: event.target.value }))} required /></label>
              </div>
              <button className="save-button" type="submit">Legg inn i Apple Kalender</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export { App };
