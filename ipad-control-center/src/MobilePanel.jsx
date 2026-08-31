import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  Clock,
  CaretLeft,
  CaretRight,
  Check,
  CloudSun,
  FolderOpen,
  Footprints,
  GraduationCap,
  Laptop,
  MonitorArrowUp,
  MoonStars,
  MusicNotes,
  Pause,
  Play,
  PlayCircle,
  Pulse,
  SkipBack,
  SkipForward,
  Stop,
  Sun,
  Warning,
} from "@phosphor-icons/react";
import {
  buildStatusChecks,
  describeCalendarActivity,
  describeRepair,
  describeSyncAge,
  eventsOnDay,
  followCalendarDay,
  formatMinutes,
  formatResetTime,
  formatTimer,
  needsCompanionUpdate,
  planCalendarDay,
  readUsageResponse,
  subjectSession,
  summarizeAgentSessions,
} from "./dashboard.js";
import { usePolledResource } from "./panel-data.js";
import { callMacAction } from "./mac-action.js";
import { useSpotify } from "./spotify-client.js";
import { createScreenWakeLockController } from "./wake-lock.js";
import "./mobile.css";

const PAGES = [
  { id: "na", label: "Nå", icon: Clock },
  { id: "dagen", label: "Dagen", icon: CalendarBlank },
  { id: "status", label: "Status", icon: Pulse },
];

const PAGE_KEY = "panelMobilePage";
// Safari eier sveipet i kanten av skjermen: der er det tilbake og fram i
// historikken, ikke sidebytte. En side som kjemper om den gesten taper, så
// sveipene våre begynner et stykke inn.
const EDGE_GUARD = 24;
const SWIPE_DISTANCE = 56;

function readPage(session) {
  try {
    const stored = session?.getItem(PAGE_KEY);
    return PAGES.some((page) => page.id === stored) ? stored : "na";
  } catch {
    return "na";
  }
}

function clockText(date) {
  return new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function dateText(date) {
  const text = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "numeric", month: "long" }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function minuteClock(minute) {
  const safe = Math.max(0, Math.round(minute));
  return `${String(Math.floor(safe / 60) % 24).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function useSwipe(onSwipe) {
  const start = useRef(null);
  return {
    onTouchStart(event) {
      if (event.touches.length !== 1) return (start.current = null);
      const touch = event.touches[0];
      const width = window.innerWidth;
      if (touch.clientX < EDGE_GUARD || touch.clientX > width - EDGE_GUARD) return (start.current = null);
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd(event) {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      // Et sveip nedover i en liste er rulling, ikke sidebytte. Vannrett må
      // vinne tydelig før siden skifter.
      if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

function Card({ title, action, children, className = "" }) {
  return (
    <section className={`m-card ${className}`.trim()}>
      {(title || action) && (
        <header className="m-card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function SubjectButton({ session, onStart }) {
  if (!session) return null;
  return (
    <button className="m-subject" type="button" onClick={() => onStart(session)}>
      <GraduationCap size={17} weight="fill" />
      {session.minutes ? `Start ${session.code} · ${session.minutes} min` : `Start ${session.code}`}
    </button>
  );
}

function ActivityCard({ activity, subjects, onStartSubject }) {
  const { current, next } = activity;
  return (
    <Card className="m-activity">
      <div className="m-activity-slot">
        <span className="m-eyebrow">Akkurat nå</span>
        {current ? (
          <>
            <strong className={`m-activity-title tone-${current.tone}`}>{current.title}</strong>
            <span className="m-activity-meta">{current.when} · {current.remaining}</span>
            <SubjectButton session={subjectSession(current, subjects)} onStart={onStartSubject} />
          </>
        ) : (
          <span className="m-empty">Ingenting pågår</span>
        )}
      </div>
      <div className="m-activity-slot">
        <span className="m-eyebrow">Neste</span>
        {next ? (
          <>
            <strong className={`m-activity-title tone-${next.tone}`}>{next.title}</strong>
            <span className="m-activity-meta">{next.when} · {next.countdown}</span>
            <SubjectButton session={subjectSession(next, subjects)} onStart={onStartSubject} />
          </>
        ) : (
          <span className="m-empty">Ingen flere avtaler</span>
        )}
      </div>
    </Card>
  );
}

function MusicCard({ onToast }) {
  const { player, track, devices, busy, playing, progressPercent, closeDevices, control, openDevices, pickDevice, connect } = useSpotify({ onToast });

  if (!player) return <Card className="m-music"><p className="m-empty">Kobler til Spotify …</p></Card>;

  if (!player.configured || !player.authorized) {
    return (
      <Card className="m-music">
        <p className="m-empty">
          {player.configured
            ? player.error || "Koble panelet til Spotify-kontoen din."
            : "Legg inn en Spotify Client ID i panelet på Mac-en."}
        </p>
        {player.configured && (
          <button className="m-wide-button" type="button" onClick={connect} disabled={busy}>Koble til Spotify</button>
        )}
      </Card>
    );
  }

  return (
    <Card className="m-music">
      <div className="m-music-top">
        <span className="m-art">{track?.artwork ? <img src={track.artwork} alt="" /> : <MusicNotes size={26} weight="fill" />}</span>
        <span className="m-music-text">
          <strong>{track?.title || (player.ok ? "Ingenting spilles" : "Spotify svarte ikke")}</strong>
          <small>{player.ok ? (track?.artist || "Velg en enhet og start musikken") : player.error}</small>
        </span>
      </div>
      <div className="m-progress" role="progressbar" aria-label="Avspilt del av sporet" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}>
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="m-music-controls">
        <button type="button" onClick={() => control("previous")} disabled={busy} aria-label="Forrige spor"><SkipBack size={22} weight="fill" /></button>
        <button className="is-primary" type="button" onClick={() => control(playing ? "pause" : "play", { playing: !playing })} disabled={busy} aria-label={playing ? "Pause" : "Spill av"}>
          {playing ? <Pause size={24} weight="fill" /> : <Play size={24} weight="fill" />}
        </button>
        <button type="button" onClick={() => control("next")} disabled={busy} aria-label="Neste spor"><SkipForward size={22} weight="fill" /></button>
        <button className="m-device" type="button" onClick={openDevices} disabled={busy} aria-label="Velg hvilken enhet som spiller">
          {player.device?.name || "Velg enhet"}
        </button>
      </div>

      {devices && (
        <div className="m-sheet-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeDevices(); }}>
          <section className="m-sheet" role="dialog" aria-modal="true" aria-label="Spill på">
            <h3>Spill på</h3>
            {devices.length > 0 ? (
              <ul>
                {devices.map((device) => (
                  <li key={device.id}>
                    <button type="button" className={device.isActive ? "is-active" : ""} disabled={device.isRestricted} onClick={() => pickDevice(device)}>
                      <strong>{device.name}</strong>
                      <small>{device.isRestricted ? "Kan ikke styres herfra" : device.isActive ? "Spiller nå" : device.type}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-empty">Spotify ser ingen enheter akkurat nå. Åpne Spotify på en enhet, så dukker den opp her.</p>
            )}
            <button className="m-wide-button" type="button" onClick={closeDevices}>Lukk</button>
          </section>
        </div>
      )}
    </Card>
  );
}

function FocusCard({ state, onStart, onPause, onSkip, onStop, onActivity, onSetting }) {
  const { running, phase, seconds, set, sets, activity, workMinutes, breakMinutes } = state;
  const idle = phase === "idle";
  return (
    <Card className={`m-focus ${phase === "break" ? "is-break" : ""}`} title="Fokusøkt">
      {idle ? (
        <>
          <input
            className="m-input"
            value={activity}
            onChange={(event) => onActivity(event.target.value)}
            placeholder="Hva skal du gjøre?"
            aria-label="Aktivitet for fokusøkten"
          />
          <div className="m-pills">
            <button type="button" onClick={() => onSetting("work", workMinutes >= 60 ? 25 : workMinutes + 5)}>Økt <strong>{workMinutes} min</strong></button>
            <button type="button" onClick={() => onSetting("break", breakMinutes >= 20 ? 5 : breakMinutes + 5)}>Pause <strong>{breakMinutes} min</strong></button>
            <button type="button" onClick={() => onSetting("sets", sets >= 4 ? 1 : sets + 1)}>Sett <strong>{sets}</strong></button>
          </div>
          <button className="m-wide-button is-primary" type="button" onClick={onStart}>
            <PlayCircle size={20} weight="fill" /> Start økt
          </button>
        </>
      ) : (
        <>
          <span className="m-eyebrow">{phase === "break" ? "Pause" : activity || "Fokus"} · sett {set} av {sets}</span>
          <strong className="m-timer">{formatTimer(seconds)}</strong>
          <div className="m-focus-controls">
            <button type="button" onClick={onPause}>{running ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}<span>{running ? "Pause" : "Fortsett"}</span></button>
            <button type="button" onClick={onSkip}><SkipForward size={20} weight="fill" /><span>Hopp</span></button>
            <button type="button" onClick={onStop}><Stop size={20} weight="fill" /><span>Avslutt</span></button>
          </div>
        </>
      )}
    </Card>
  );
}

function ActionRow({ actions }) {
  return (
    <div className="m-actions">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className={`m-action tone-${action.tone} ${action.active ? "is-on" : ""}`}
            onClick={action.onPress}
            aria-pressed={action.toggle ? Boolean(action.active) : undefined}
          >
            <Icon size={24} weight="fill" />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DayPage({ date, events, plan, done, connected, onDone, onMove, onToday }) {
  const doneIds = new Set((Array.isArray(done) ? done : []).flatMap((entry) => (entry?.id ? [entry.id] : [])));
  const allDay = events.filter((event) => event.allDay);
  // Uten en dagsmal finnes ingen skyving, og da er kalenderen selv lista.
  const rows = plan
    ? plan.placed.map((block) => ({ id: block.id, title: block.title, tone: block.tone, done: block.done, time: `${minuteClock(block.startMinute)}–${minuteClock(block.endMinute)}` }))
    : events
      .filter((event) => !event.allDay)
      .sort((a, b) => +new Date(a.start) - +new Date(b.start))
      .map((event) => ({
        id: event.id,
        title: event.title,
        tone: event.tone,
        done: doneIds.has(event.id),
        time: `${clockText(new Date(event.start))}–${clockText(new Date(event.end))}`,
      }));

  return (
    <>
      <div className="m-daybar">
        <button type="button" onClick={() => onMove(-1)} aria-label="I går"><CaretLeft size={20} weight="bold" /></button>
        <button className="m-daybar-label" type="button" onClick={onToday}>{dateText(date)}</button>
        <button type="button" onClick={() => onMove(1)} aria-label="I morgen"><CaretRight size={20} weight="bold" /></button>
      </div>

      {!connected && <Card><p className="m-empty">Apple Kalender kobles til. Åpne Kalender på Mac-en.</p></Card>}

      {plan?.shift > 0 && (
        <p className="m-shift">Dagen er skjøvet {formatMinutes(plan.shift)} fra oppvåkningen.</p>
      )}

      {allDay.length > 0 && (
        <Card title="Hele dagen">
          <ul className="m-plain-list">
            {allDay.map((event) => <li key={event.id}>{event.title}</li>)}
          </ul>
        </Card>
      )}

      <Card title={rows.length ? `${rows.length} ${rows.length === 1 ? "avtale" : "avtaler"}` : "Dagen"}>
        {rows.length === 0 ? (
          <p className="m-empty">{connected ? "Ingenting står i kalenderen denne dagen." : "Venter på Kalender på Mac-en."}</p>
        ) : (
          <ul className="m-day-list">
            {rows.map((row) => (
              <li key={row.id} className={row.done ? "is-done" : ""}>
                <button type="button" onClick={() => onDone(row.id)} aria-label={row.done ? `Angre avhuking av ${row.title}` : `Huk av ${row.title}`}>
                  <span className="m-check">{row.done && <Check size={14} weight="bold" />}</span>
                  <span className="m-day-text">
                    <strong className={`tone-${row.tone}`}>{row.title}</strong>
                    <small>{row.time}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {plan?.dropped?.length > 0 && (
        <Card title="Dette rakk du ikke">
          <ul className="m-plain-list">
            {plan.dropped.map((block) => <li key={block.id}>{block.title} · {formatMinutes(block.minutes)}</li>)}
          </ul>
        </Card>
      )}
    </>
  );
}

function UsageCard({ usage, now }) {
  const providers = [
    { key: "codex", name: "Codex", data: usage?.codex },
    { key: "claude", name: "Claude", data: usage?.claude },
  ];
  return (
    <Card title="AI-bruk">
      {providers.map(({ key, name, data }) => (
        <div className="m-usage" key={key}>
          <div className="m-usage-head">
            <strong>{name}</strong>
            {!data?.ok && <small>{data?.error || "Henter data …"}</small>}
          </div>
          {data?.ok && data.windows.map((window) => {
            const reset = formatResetTime(window.resetsAt, window.active, now);
            return (
              <div className="m-usage-window" key={window.key}>
                <div className="m-usage-line">
                  <span>{window.label}</span>
                  <strong>{Number.isFinite(window.remainingPercent) ? `${Math.round(window.remainingPercent)} % igjen` : "–"}</strong>
                </div>
                <div className="m-bar"><span style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }} /></div>
                <small>{reset.countdown}</small>
              </div>
            );
          })}
        </div>
      ))}
    </Card>
  );
}

function AgentsCard({ snapshot, now }) {
  const summary = useMemo(() => {
    const read = Date.parse(snapshot?.updatedAt ?? "");
    const clock = Number.isFinite(read) && read > now.getTime() ? new Date(read) : now;
    return summarizeAgentSessions(snapshot, clock);
  }, [snapshot, now]);

  return (
    <Card title="Oppgaver">
      {!summary.sessions.length && <p className="m-empty">{summary.headline}</p>}
      <ul className="m-agent-list">
        {summary.sessions.map((session) => (
          <li key={session.id} className={`is-${session.tone}`}>
            <strong>{session.title}</strong>
            <span className="m-agent-meta">
              <small><FolderOpen size={12} weight="fill" /> {session.project || "Ukjent mappe"}</small>
              {session.tone !== "done" && <i className={`m-chip is-${session.tone}`}>{session.label}</i>}
            </span>
            <small>{session.detail}</small>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MetricsCard({ metrics, rhythm, now }) {
  const outdated = needsCompanionUpdate(metrics, now);
  const hasScreenTime = Number.isFinite(metrics?.screenTime?.socialMinutes) && !outdated;
  const hasSteps = Number.isFinite(metrics?.steps?.today);
  const hasLocation = metrics?.weather?.locationSource === "device";
  const screenTimeDetail = metrics?.problems?.screenTime
    ?? (outdated ? "Panelkobling er for gammel — installer på nytt" : describeSyncAge(metrics?.sources?.screenTime, now, "Device Activity · iPhone + iPad"));
  const stepsDetail = metrics?.problems?.steps ?? describeSyncAge(metrics?.sources?.steps, now, "HealthKit · Apple Helse");

  return (
    <Card title="Kropp og vær">
      <ul className="m-metrics">
        <li>
          <span className="m-metric-icon tone-violet"><Laptop size={19} weight="fill" /></span>
          <span className="m-metric-text">
            <strong>{hasScreenTime ? formatMinutes(metrics.screenTime.socialMinutes) : outdated ? "Utdatert app" : "Ikke synket"}</strong>
            <small>{hasScreenTime ? `Sosiale medier i går · uke ${formatMinutes(metrics.screenTime.socialWeeklyAverageMinutes)}` : screenTimeDetail}</small>
          </span>
        </li>
        <li>
          <span className="m-metric-icon tone-lime"><Footprints size={19} weight="fill" /></span>
          <span className="m-metric-text">
            <strong>{hasSteps ? new Intl.NumberFormat("nb-NO").format(metrics.steps.today) : "Ikke synket"}</strong>
            <small>{hasSteps ? "Skritt i dag" : stepsDetail}</small>
          </span>
        </li>
        <li>
          <span className="m-metric-icon tone-orange"><CloudSun size={19} weight="fill" /></span>
          <span className="m-metric-text">
            <strong>{metrics?.weather?.ok ? `${Math.round(metrics.weather.temperature)}° · ${metrics.weather.condition}` : "Vær utilgjengelig"}</strong>
            <small>{`${metrics?.weather?.label || "Mosterøy"}${hasLocation ? "" : " · reserveposisjon"}`}</small>
          </span>
        </li>
        {rhythm && !rhythm.learning && (
          <li>
            <span className="m-metric-icon tone-violet"><MoonStars size={19} weight="fill" /></span>
            <span className="m-metric-text">
              <strong>{rhythm.targetBedtime} → {rhythm.targetWake}</strong>
              <small>{`${formatMinutes(rhythm.sleepNeed)} søvn, anslått fra ${rhythm.nightCount} netter`}</small>
            </span>
          </li>
        )}
        {rhythm?.learning && (
          <li>
            <span className="m-metric-icon tone-violet"><MoonStars size={19} weight="fill" /></span>
            <span className="m-metric-text">
              <strong>Lærer rytmen</strong>
              <small>{`${rhythm.nightCount} ${rhythm.nightCount === 1 ? "natt" : "netter"} av tre`}</small>
            </span>
          </li>
        )}
      </ul>
    </Card>
  );
}

function ConnectionCard({ checks, onRepair }) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(null);

  async function repair(check) {
    setBusy(check.id);
    const result = await onRepair(check.id);
    setResults((current) => ({ ...current, [check.id]: result }));
    setBusy(null);
  }

  return (
    <Card title="Tilkobling">
      <ul className="m-connections">
        {checks.map((check) => {
          const result = results[check.id];
          return (
            <li key={check.id}>
              <button type="button" onClick={() => repair(check)} disabled={busy === check.id}>
                <span className={`m-dot ${check.ok ? "is-ok" : "is-bad"}`}>{check.ok ? <Check size={12} weight="bold" /> : <Warning size={12} weight="fill" />}</span>
                <span className="m-day-text">
                  <strong>{check.label}</strong>
                  <small>{busy === check.id ? "Reparerer …" : result?.detail || check.detail}</small>
                  {result?.next && <small className="m-next-step">{result.next}</small>}
                </span>
                <ArrowClockwise size={16} weight="bold" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function MobilePanel() {
  const [page, setPage] = useState(() => readPage(window.sessionStorage));
  const [now, setNow] = useState(() => new Date());
  const [date, setDate] = useState(() => new Date());
  const [toast, setToast] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [agentSessions, setAgentSessions] = useState(null);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [screenAwake, setScreenAwake] = useState(false);
  const wakeLock = useRef(null);

  const [usage] = usePolledResource("/api/usage", {
    interval: 60_000,
    parse: readUsageResponse,
    onError: (current, error) => ({
      updatedAt: new Date().toISOString(),
      codex: { ok: false, error: `Kunne ikke hente bruk (${error.message})` },
      claude: { ok: false, error: `Kunne ikke hente bruk (${error.message})` },
    }),
  });
  const [deviceMetrics, refreshDeviceMetrics] = usePolledResource("/api/device-metrics", {
    interval: 60_000,
    onError: (current) => current ?? { screenTime: {}, steps: {}, weather: { ok: false, label: "Mosterøy" }, syncConnected: false },
  });
  const [syncCalendar, refreshSyncCalendar] = usePolledResource("/api/sync-calendar", {
    interval: 30_000,
    refreshUrl: "/api/sync-calendar?force=1",
    initial: { events: [], connected: false, stale: false },
    onError: (current) => ({ ...current, connected: false }),
  });
  const [syncNotes, refreshSyncNotes] = usePolledResource("/api/sync-notes", {
    interval: 30_000,
    initial: { notes: [], connected: false },
    onError: (current) => ({ ...current, connected: false }),
  });
  const [dayPlan, refreshDayPlan, setDayPlan] = usePolledResource("/api/day-plan", {
    interval: 30_000,
    initial: { template: null, wake: null, connected: false },
    onError: (current) => ({ ...current, connected: false }),
  });
  const [usageRefreshing, setUsageRefreshing] = useState(false);

  // Fokusøkta deler innstillinger med iPad-panelet. Skjerm våken gjør det ikke:
  // på iPad henger den sammen med Fokus på Mac-en, og en telefon som lyser i
  // festet skal ikke slå på Fokus for alle enhetene.
  const [focus, setFocus] = useState(() => ({
    running: false,
    phase: "idle",
    set: 1,
    seconds: (Number(localStorage.getItem("panel-focus-work")) || 45) * 60,
    activity: localStorage.getItem("panel-focus-activity") || "",
    workMinutes: Number(localStorage.getItem("panel-focus-work")) || 45,
    breakMinutes: Number(localStorage.getItem("panel-focus-break")) || 10,
    sets: Number(localStorage.getItem("panel-focus-sets")) || 2,
  }));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(PAGE_KEY, page);
    } catch {
      // Privat vindu: siden huskes da bare så lenge panelet står åpent.
    }
  }, [page]);

  // Panelet står i festet døgnet rundt, så datoen må følge døgnskiftet selv.
  const trackedToday = useRef(now);
  useEffect(() => {
    const rollover = followCalendarDay(date, trackedToday.current, now);
    trackedToday.current = rollover.today;
    if (rollover.rolled) setDate(rollover.date);
  }, [now, date]);

  useEffect(() => {
    const controller = createScreenWakeLockController({
      wakeLock: navigator.wakeLock,
      isVisible: () => document.visibilityState === "visible",
      onActiveChange: setScreenAwake,
    });
    wakeLock.current = controller;
    const restore = () => controller.handleVisibilityChange();
    document.addEventListener("visibilitychange", restore);
    if (localStorage.getItem("panel-mobile-awake") === "on") controller.setWanted(true);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      wakeLock.current = null;
      controller.destroy();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/subjects")
      .then((response) => (response.ok ? response.json() : { connected: [] }))
      .then((result) => { if (!cancelled) setSubjects(Array.isArray(result?.connected) ? result.connected : []); })
      .catch(() => { if (!cancelled) setSubjects([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (page !== "status") return undefined;
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/agent-sessions", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = await response.json();
        if (active) setAgentSessions(snapshot);
      } catch (error) {
        if (active) setAgentSessions({ ok: false, error: `Åpne panelet på Mac-en for å se øktene (${error.message})`, sessions: [] });
      }
    }
    load();
    const timer = window.setInterval(load, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [page]);

  useEffect(() => {
    if (!focus.running) return undefined;
    const timer = window.setInterval(() => {
      setFocus((current) => {
        if (current.seconds > 1) return { ...current, seconds: current.seconds - 1 };
        return advanceFocus(current);
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focus.running]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function advanceFocus(current) {
    if (current.phase === "work" && current.set < current.sets) {
      setToast(`Pause i ${current.breakMinutes} min`);
      return { ...current, phase: "break", seconds: current.breakMinutes * 60 };
    }
    if (current.phase === "break") {
      setToast(`Sett ${current.set + 1} av ${current.sets}`);
      return { ...current, phase: "work", set: current.set + 1, seconds: current.workMinutes * 60 };
    }
    setToast("Fokusøkten er fullført");
    return { ...current, running: false, phase: "idle", set: 1, seconds: current.workMinutes * 60 };
  }

  async function runOnMac(body, { done, failed }) {
    try {
      setToast(done(await callMacAction(body)));
      return true;
    } catch (error) {
      setToast(`${failed} (${error.message})`);
      return false;
    }
  }

  async function toggleMacFocus() {
    const enabled = !focusModeActive;
    const ok = await runOnMac({ action: "focus-mode", enabled }, {
      done: () => (enabled ? "Fokus er på på alle enhetene dine" : "Fokus er slått av"),
      failed: "Fokusmodus",
    });
    if (ok) setFocusModeActive(enabled);
  }

  async function toggleScreenAwake() {
    const wanted = !screenAwake;
    const ready = await wakeLock.current?.setWanted(wanted);
    if (wanted && !ready) {
      setToast("Safari holdt ikke skjermen våken. Legg panelet på Hjem-skjermen og prøv igjen.");
      return;
    }
    localStorage.setItem("panel-mobile-awake", wanted ? "on" : "off");
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

  async function repairConnection(id) {
    try {
      const response = await fetch("/api/connections/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      if (id === "calendar") await refreshSyncCalendar();
      else if (id === "notes") await refreshSyncNotes();
      else if (id === "mobile") await refreshDeviceMetrics();
      else await refreshAll();
      return describeRepair(result, new Date());
    } catch (error) {
      return { ok: false, detail: `Nådde ikke Mac-en (${error.message})`, next: null };
    }
  }

  async function refreshAll() {
    setUsageRefreshing(true);
    await Promise.all([refreshSyncCalendar(), refreshDeviceMetrics(), refreshDayPlan()]);
    setUsageRefreshing(false);
  }

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

  // «Akkurat nå» og «Neste» handler om nå, ikke om den dagen man har bladd seg
  // fram til — ellers ville kortene endre seg av å bla i Dagen-siden.
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
    const original = new Map(calendarEvents.map((event) => [event.id, event]));
    const touched = new Set([...plan.placed, ...plan.dropped].map((block) => block.id));
    const moved = plan.placed.map((block) => ({ ...(original.get(block.id) ?? {}), start: block.start, end: block.end }));
    return [...calendarEvents.filter((event) => !touched.has(event.id)), ...moved];
  }, [dayPlan.template, dayPlan.wake, calendarEvents, todayKey]);

  const activity = useMemo(() => describeCalendarActivity(activityEvents, now), [activityEvents, now]);
  const checks = useMemo(
    () => buildStatusChecks({ syncCalendar, syncNotes, deviceMetrics, usage }, now),
    [syncCalendar, syncNotes, deviceMetrics, usage, now],
  );

  const index = PAGES.findIndex((entry) => entry.id === page);
  const swipe = useSwipe((direction) => {
    const next = PAGES[Math.min(PAGES.length - 1, Math.max(0, index + direction))];
    if (next) setPage(next.id);
  });

  const actions = [
    { id: "focus", label: "Fokus", icon: MoonStars, tone: "violet", toggle: true, active: focusModeActive, onPress: toggleMacFocus },
    {
      id: "screen-mirror",
      label: "Skjerm",
      icon: MonitorArrowUp,
      tone: "orange",
      onPress: () => runOnMac({ action: "screen-mirror", device: localStorage.getItem("panel-mirror-device") || "iPad" }, {
        done: (result) => (result.state === "connected" ? `${result.label} er koblet til som ekstra skjerm` : `${result.label} er koblet fra`),
        failed: "Kunne ikke koble til skjermen",
      }),
    },
    {
      id: "school",
      label: "Skole",
      icon: GraduationCap,
      tone: "blue",
      onPress: () => runOnMac({ action: "school-session" }, {
        done: (result) => `${result.label} ble valgt — en startoppgave er fylt inn i ChatGPT`,
        failed: "Kunne ikke starte en skoleøkt på Mac-en",
      }),
    },
    { id: "awake", label: "Våken", icon: Sun, tone: "lime", toggle: true, active: screenAwake, onPress: toggleScreenAwake },
  ];

  return (
    <div className="m-shell" {...swipe}>
      <main className="m-pages">
        {page === "na" && (
          <>
            <header className="m-clock">
              <strong>{clockText(now)}</strong>
              <span>{dateText(now)}</span>
            </header>
            <ActivityCard
              activity={activity}
              subjects={subjects}
              onStartSubject={({ code, minutes, title }) => runOnMac({ action: "subject-session", code, minutes, title }, {
                done: () => (minutes ? `${code} er åpnet i ChatGPT — planen for ${minutes} min er fylt inn` : `${code} er åpnet i ChatGPT`),
                failed: `Fikk ikke startet ${code}-økta på Mac-en`,
              })}
            />
            <MusicCard onToast={setToast} />
            <FocusCard
              state={focus}
              onActivity={(value) => {
                setFocus((current) => ({ ...current, activity: value }));
                localStorage.setItem("panel-focus-activity", value);
              }}
              onSetting={(key, value) => {
                localStorage.setItem(`panel-focus-${key}`, String(value));
                setFocus((current) => ({
                  ...current,
                  ...(key === "work" ? { workMinutes: value, seconds: value * 60 } : {}),
                  ...(key === "break" ? { breakMinutes: value } : {}),
                  ...(key === "sets" ? { sets: value } : {}),
                }));
              }}
              onStart={() => setFocus((current) => ({ ...current, running: true, phase: "work", set: 1, seconds: current.workMinutes * 60 }))}
              onPause={() => setFocus((current) => ({ ...current, running: !current.running }))}
              onSkip={() => setFocus((current) => advanceFocus(current))}
              onStop={() => setFocus((current) => ({ ...current, running: false, phase: "idle", set: 1, seconds: current.workMinutes * 60 }))}
            />
            <ActionRow actions={actions} />
          </>
        )}

        {page === "dagen" && (
          <DayPage
            date={date}
            events={selectedDayEvents}
            plan={plannedDay}
            done={dayPlan.wake?.done ?? []}
            connected={Boolean(syncCalendar.connected)}
            onDone={markDone}
            onMove={(direction) => setDate((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + direction))}
            onToday={() => setDate(new Date())}
          />
        )}

        {page === "status" && (
          <>
            <div className="m-refresh-row">
              <button type="button" onClick={refreshAll} disabled={usageRefreshing}>
                <ArrowClockwise size={16} weight="bold" /> {usageRefreshing ? "Oppdaterer …" : "Oppdater"}
              </button>
            </div>
            <UsageCard usage={usage} now={now} />
            <AgentsCard snapshot={agentSessions} now={now} />
            <MetricsCard metrics={deviceMetrics} rhythm={dayPlan.rhythm} now={now} />
            <ConnectionCard checks={checks} onRepair={repairConnection} />
          </>
        )}
      </main>

      {toast && <div className="m-toast" role="status">{toast}</div>}

      <nav className="m-tabs" aria-label="Sider">
        {PAGES.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              className={page === entry.id ? "is-active" : ""}
              aria-current={page === entry.id ? "page" : undefined}
              onClick={() => setPage(entry.id)}
            >
              <Icon size={21} weight={page === entry.id ? "fill" : "regular"} />
              <span>{entry.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
