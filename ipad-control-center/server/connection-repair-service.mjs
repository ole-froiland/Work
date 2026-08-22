import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getDeviceMetrics } from "./device-metrics-service.mjs";
import { runMacAction } from "./mac-action-service.mjs";
import { appleCalendarAccessMissing, describeCalendarAccess, readAppleCalendarNow, requestAppleCalendarAccess } from "./sync-calendar-service.mjs";
import { getSyncNotes } from "./sync-notes-service.mjs";
import { getUsageSnapshot, resetClaudeThrottle, restartCodexClient } from "./usage-service.mjs";

const DEADLINE_MS = 20_000;
// Kalenderen kan bli stående og vente på at Ole svarer på en systemdialog. De
// sekundene er ikke panelet som henger, så den får sitt eget tak.
const DEADLINE_OVERRIDES = { calendar: 60_000 };
const NOTES_ATTEMPTS = 10;
const CALENDAR_ATTEMPTS = 3;
const running = new Map();

const defaults = {
  exec: promisify(execFile),
  readAppleCalendarNow,
  requestAppleCalendarAccess,
  getSyncNotes,
  getDeviceMetrics,
  getUsageSnapshot,
  resetClaudeThrottle,
  restartCodexClient,
  runMacAction,
  wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
};

function step(label, ok, detail = null) {
  return detail ? { label, ok, detail } : { label, ok };
}

function eventCount(events) {
  return `${events.length} ${events.length === 1 ? "hendelse" : "hendelser"} hentet`;
}

const sequences = {
  // Kalenderen leses fra EventKit gjennom osascript. Feiler den, er det nesten
  // alltid én av to ting: Kalender kjører ikke, eller panelet mangler tilgang.
  // De to krever motsatt behandling, så sekvensen skiller dem før den gir opp.
  async calendar(tools) {
    const steps = [];
    try {
      const events = await tools.readAppleCalendarNow();
      return { ok: true, detail: eventCount(events), steps: [step("Leste Apple Kalender på nytt", true)] };
    } catch (error) {
      steps.push(step("Leste Apple Kalender på nytt", false, error.message));
      if (appleCalendarAccessMissing(error.message)) return askForCalendarAccess(tools, steps, error.message);
    }

    try {
      await tools.exec("open", ["-g", "-a", "Kalender"]);
      steps.push(step("Startet Kalender på Mac-en", true));
    } catch (error) {
      steps.push(step("Startet Kalender på Mac-en", false, firstLine(error)));
    }

    let lastMessage = "Kalenderlesingen svarte ikke";
    for (let attempt = 0; attempt < CALENDAR_ATTEMPTS; attempt += 1) {
      await tools.wait(1_000);
      try {
        const events = await tools.readAppleCalendarNow();
        steps.push(step("Leste Apple Kalender på nytt", true));
        return { ok: true, detail: eventCount(events), steps };
      } catch (error) {
        lastMessage = error.message;
      }
    }
    steps.push(step("Leste Apple Kalender på nytt", false, lastMessage));
    return {
      ok: false,
      detail: appleCalendarAccessMissing(lastMessage) ? describeCalendarAccess(lastMessage) : lastMessage,
      steps,
      next: appleCalendarAccessMissing(lastMessage)
        ? { action: "calendar-privacy", label: "Åpne Personvern → Kalendere" }
        : null,
    };
  },

  // Notatene kommer fra Sync-nettsida, som poster dem selv. Panelet kan ikke
  // hente dem — det kan bare sørge for at sida er åpen og vente på at den melder
  // seg.
  async notes(tools) {
    const steps = [];
    const first = await tools.getSyncNotes();
    if (first.connected) {
      return { ok: true, detail: noteCount(first.notes), steps: [step("Hentet notatene på nytt", true)] };
    }
    steps.push(step("Hentet notatene på nytt", false, "Ingen notater har kommet inn"));

    try {
      await tools.runMacAction("sync-projects", { exec: tools.exec });
      steps.push(step("Åpnet Sync på Mac-en", true));
    } catch (error) {
      steps.push(step("Åpnet Sync på Mac-en", false, firstLine(error)));
      return { ok: false, detail: firstLine(error), steps, next: null };
    }

    for (let attempt = 0; attempt < NOTES_ATTEMPTS; attempt += 1) {
      await tools.wait(1_000);
      const snapshot = await tools.getSyncNotes();
      if (snapshot.connected) {
        steps.push(step("Ventet på at Sync sendte notatene", true));
        return { ok: true, detail: noteCount(snapshot.notes), steps };
      }
    }
    steps.push(step("Ventet på at Sync sendte notatene", false, "Sync sendte ingenting"));
    return { ok: false, detail: "Sync-fanen må stå åpen på Mac-en", steps, next: null };
  },

  // Telefonen pusher når den selv vil, og har ingen kanal andre veien. Alt denne
  // sekvensen kan gjøre er å se etter ferske verdier og si presist hva som
  // mangler — ingen knapp herfra får iPhonen til å sende.
  async mobile(tools) {
    const metrics = await tools.getDeviceMetrics();
    if (metrics.syncConnected) {
      return {
        ok: true,
        detail: "Sosial tid, skritt og posisjon er ferske",
        steps: [step("Hentet iPhone-verdiene på nytt", true)],
        metrics,
      };
    }
    const everSent = Object.values(metrics.sources ?? {}).some((source) => source?.observedAt);
    return {
      ok: false,
      reason: everSent ? "stale" : "never",
      detail: everSent
        ? "Siste verdier er for gamle. Åpne Panelkobling på iPhonen."
        : "iPhonen har aldri sendt verdier. Åpne Panelkobling på iPhonen.",
      steps: [step("Hentet iPhone-verdiene på nytt", false, everSent ? "Verdiene er for gamle" : "Har aldri fått verdier")],
      next: null,
      metrics,
    };
  },

  async codex(tools) {
    const steps = [];
    const first = await tools.getUsageSnapshot({ force: true });
    if (first.codex?.ok) {
      return { ok: true, detail: "Kvoten er hentet", steps: [step("Hentet kvoten på nytt", true)] };
    }
    steps.push(step("Hentet kvoten på nytt", false, first.codex?.error ?? "Codex svarte ikke"));

    tools.restartCodexClient();
    steps.push(step("Startet Codex app-server på nytt", true));
    const second = await tools.getUsageSnapshot({ force: true });
    if (second.codex?.ok) {
      return { ok: true, detail: "Kvoten er hentet", steps };
    }
    const message = second.codex?.error ?? "Codex svarte ikke";
    steps.push(step("Hentet kvoten på nytt", false, message));
    return {
      ok: false,
      detail: message,
      steps,
      next: needsCodexLogin(message) ? { action: "codex-login", label: "Åpne Terminal med codex login" } : null,
    };
  },

  // Claude Code roterer tokenet sitt selv, så en ny lesing av Nøkkelringen er
  // ofte hele fiksen. Er den ikke det, avgjør feilkoden hva som gjenstår:
  // `invalid_grant` er en pålogging Ole må fornye, alt annet er vår egen bug.
  async claude(tools) {
    tools.resetClaudeThrottle();
    const snapshot = await tools.getUsageSnapshot({ force: true });
    if (snapshot.claude?.ok) {
      return {
        ok: true,
        detail: "Kvoten er hentet",
        steps: [step("Leste Nøkkelringen og fornyet påloggingen", true)],
      };
    }
    const message = snapshot.claude?.error ?? "Claude svarte ikke";
    // Et utløpt token og en avbrutt innlogging ser ulike ut i loggen, men krever
    // nøyaktig det samme av Ole.
    const code = snapshot.claude?.code;
    const expired = code === "invalid_grant" || code === "logged_out";
    return {
      ok: false,
      detail: code === "logged_out" ? message : expired ? "Påloggingen må fornyes på Mac-en" : message,
      steps: [step("Leste Nøkkelringen og fornyet påloggingen", false, message)],
      next: expired ? { action: "claude-login", label: "Logg inn i Claude på Mac-en" } : null,
    };
  },
};

// Dialogen kommer bare når macOS mener det er noe å spørre om. Svarer den nei
// uten å ha spurt, er valget allerede tatt og må endres i Personvern.
async function askForCalendarAccess(tools, steps, message) {
  const stuck = {
    ok: false,
    detail: describeCalendarAccess(message),
    steps,
    next: { action: "calendar-privacy", label: "Åpne Personvern → Kalendere" },
  };
  let answer;
  try {
    answer = await tools.requestAppleCalendarAccess();
  } catch (error) {
    steps.push(step("Ba om kalendertilgang", false, firstLine(error)));
    return stuck;
  }
  if (!answer?.granted) {
    steps.push(step("Ba om kalendertilgang", false, answer?.asked ? "Tilgang ble ikke gitt" : "macOS spurte ikke"));
    return stuck;
  }
  steps.push(step("Ba om kalendertilgang", true));
  try {
    const events = await tools.readAppleCalendarNow();
    steps.push(step("Leste Apple Kalender på nytt", true));
    return { ok: true, detail: eventCount(events), steps };
  } catch (error) {
    steps.push(step("Leste Apple Kalender på nytt", false, error.message));
    return { ...stuck, detail: describeCalendarAccess(error.message) };
  }
}

function noteCount(notes) {
  const count = Array.isArray(notes) ? notes.length : 0;
  return `${count} ${count === 1 ? "notat" : "notater"} hentet`;
}

function firstLine(error) {
  const message = String(error?.stderr || error?.message || "");
  return message.split("\n").map((line) => line.trim()).find(Boolean) || "Handlingen svarte ikke";
}

function needsCodexLogin(message) {
  return /logg|login|auth|unauthorized|401/i.test(String(message ?? ""));
}

export function isRepairableConnection(id) {
  return typeof id === "string" && Object.hasOwn(sequences, id);
}

// Sekvensene rører Mac-en. Uten et tak kan et trykk bli stående og vente for
// alltid, og uten enkeltkjøring kan utålmodige trykk starte flere osascript- og
// Codex-omstarter oppå hverandre.
export async function repairConnection(id, overrides = {}) {
  if (!isRepairableConnection(id)) throw new Error("Ukjent tilkobling");
  const existing = running.get(id);
  if (existing) return existing;

  const tools = { ...defaults, ...overrides };
  const deadline = tools.deadlineMs ?? DEADLINE_OVERRIDES[id] ?? DEADLINE_MS;
  let timer;
  const attempt = Promise.race([
    sequences[id](tools),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({
        ok: false,
        detail: "Tok for lang tid",
        steps: [step("Reparerte tilkoblingen", false, "Tok for lang tid")],
        next: null,
      }), deadline);
    }),
  ])
    .then((result) => ({ id, next: null, ...result }))
    .catch((error) => ({
      id,
      ok: false,
      detail: firstLine(error),
      steps: [step("Reparerte tilkoblingen", false, firstLine(error))],
      next: null,
    }))
    .finally(() => {
      clearTimeout(timer);
      running.delete(id);
    });

  running.set(id, attempt);
  return attempt;
}
