import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getSyncCalendar } from "./sync-calendar-service.mjs";
import { buildSessionPrompt, normalizeSessionRequest, readSubjectProjects } from "./subject-service.mjs";

const runCommand = promisify(execFile);
const sidecarSource = fileURLToPath(new URL("./sidecar-tool.m", import.meta.url));
const sidecarBinary = fileURLToPath(new URL("./.cache/sidecar-tool", import.meta.url));
const defaultMirrorDevice = process.env.PANEL_MIRROR_DEVICE || "iPad";
const focusShortcuts = {
  on: process.env.PANEL_FOCUS_ON_SHORTCUT || "Fokus på",
  off: process.env.PANEL_FOCUS_OFF_SHORTCUT || "Fokus av",
};
const chromeTargets = {
  "sync-projects": "https://sync-co-op.netlify.app/projects",
  "nhh-subjects": "file:///Users/ole-froiland/Desktop/Prosjekter/nhh/index.html#/fag",
  "link-site": "https://mine-lenker-ole-froiland.netlify.app",
  "private-accounts": "https://privat-regnskap-ole.netlify.app",
};

let sidecarBuild = null;

// `open -a "Google Chrome" <url>` avslutter med 0 uten å åpne fanen, så knappene
// så ut til å virke mens ingenting skjedde. Apple-hendelsen gjør jobben. Adressen
// sendes som argument til skriptet, ikke som tekst i det, slik at den aldri tolkes.
async function openInChrome(exec, action, url, label) {
  try {
    await exec("osascript", [
      "-e", "on run {target}",
      "-e", 'tell application "Google Chrome"',
      "-e", "open location target",
      "-e", "activate",
      "-e", "end tell",
      "-e", "end run",
      url,
    ]);
  } catch (error) {
    throw new Error(`Fikk ikke åpnet ${label} i Chrome (${firstErrorLine(error, "Chrome svarte ikke")})`);
  }
  return { action, target: "chrome", label };
}

// Siste steget i en reparasjon som panelet ikke kan fullføre alene: Terminal
// åpnes med kommandoen kjørende, slik at Ole bare må fullføre innloggingen i
// nettleseren som spretter opp. Kommandoen er en fast tekst herfra og sendes
// som argument til skriptet, aldri limt inn i det.
async function openInTerminal(exec, action, command, label) {
  try {
    await exec("osascript", [
      "-e", "on run {command}",
      "-e", 'tell application "Terminal"',
      "-e", "activate",
      "-e", "do script command",
      "-e", "end tell",
      "-e", "end run",
      command,
    ]);
  } catch (error) {
    throw new Error(`Fikk ikke åpnet Terminal for ${label} (${firstErrorLine(error, "Terminal svarte ikke")})`);
  }
  return { action, target: "terminal", label, command };
}

// ChatGPT tar ikke imot en ferdig melding i adressen, så prompten legges på
// utklippstavla i stedet: ett ⌘V er hele forskjellen fra å skrive den selv.
// Teksten sendes som argument til skriptet, aldri limt inn i det.
async function copyToClipboard(exec, text) {
  try {
    await exec("osascript", [
      "-e", "on run {payload}",
      "-e", "set the clipboard to payload",
      "-e", "end run",
      text,
    ]);
  } catch (error) {
    throw new Error(`Fikk ikke lagt teksten på utklippstavla (${firstErrorLine(error, "osascript svarte ikke")})`);
  }
}

function normalizeDeviceName(value) {
  const name = typeof value === "string" && value.trim() ? value.trim() : defaultMirrorDevice;
  if (name.length > 64 || !/^[\p{L}\p{N} ()'’·._-]+$/u.test(name)) throw new Error("Ugyldig enhetsnavn");
  return name;
}

async function isBinaryFresh() {
  try {
    const [binary, source] = await Promise.all([stat(sidecarBinary), stat(sidecarSource)]);
    return binary.mtimeMs >= source.mtimeMs;
  } catch {
    return false;
  }
}

// Bygger Sidecar-verktøyet ved første bruk, og bare hvis kilden er nyere enn binæren.
async function ensureSidecarBinary(exec) {
  if (await isBinaryFresh()) return sidecarBinary;
  if (!sidecarBuild) {
    sidecarBuild = (async () => {
      await mkdir(dirname(sidecarBinary), { recursive: true });
      await exec("clang", ["-fobjc-arc", "-framework", "Foundation", "-o", sidecarBinary, sidecarSource]);
      return sidecarBinary;
    })().finally(() => { sidecarBuild = null; });
  }
  return sidecarBuild;
}

function firstErrorLine(error, fallback) {
  const message = String(error?.stderr || error?.message || "");
  return message.split("\n").map((line) => line.trim()).find(Boolean) || fallback;
}

// Fokus settes via Snarveier på Mac-en. Med «Del på tvers av enheter» slått på
// i Fokus-innstillingene følger iPhone og iPad automatisk etter.
async function findShortcut(exec, wanted) {
  const { stdout } = await exec("shortcuts", ["list"]);
  const names = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return names.find((name) => name.localeCompare(wanted, "nb", { sensitivity: "base" }) === 0);
}

const macActions = {
  async "focus-mode"(exec, payload) {
    const enabled = Boolean(payload?.enabled);
    const wanted = enabled ? focusShortcuts.on : focusShortcuts.off;
    let match;
    try {
      match = await findShortcut(exec, wanted);
    } catch (error) {
      throw new Error(`Fikk ikke lest snarveiene (${firstErrorLine(error, "shortcuts svarte ikke")})`);
    }
    if (!match) throw new Error(`Lag en snarvei som heter «${wanted}» med handlingen «Angi fokus»`);
    // `shortcuts run` henger når den startes fra serverprosessen, så snarveien
    // kjøres via URL-skjemaet i stedet. -g lar fokus bli der brukeren er.
    try {
      await exec("open", ["-g", `shortcuts://run-shortcut?name=${encodeURIComponent(match)}`]);
    } catch (error) {
      throw new Error(firstErrorLine(error, `Snarveien «${match}» feilet`));
    }
    return { action: "focus-mode", enabled, label: match };
  },
  async spotify(exec) {
    try {
      await exec("open", ["-a", "Spotify"]);
      return { action: "spotify", target: "app", label: "Spotify" };
    } catch {
      await exec("open", ["https://open.spotify.com"]);
      return { action: "spotify", target: "web", label: "open.spotify.com" };
    }
  },
  async "sync-projects"(exec) {
    return openInChrome(exec, "sync-projects", chromeTargets["sync-projects"], "Sync-prosjekter");
  },
  async "nhh-subjects"(exec) {
    return openInChrome(exec, "nhh-subjects", chromeTargets["nhh-subjects"], "NHH-fag");
  },
  async "link-site"(exec) {
    return openInChrome(exec, "link-site", chromeTargets["link-site"], "Linksiden");
  },
  async "private-accounts"(exec) {
    return openInChrome(exec, "private-accounts", chromeTargets["private-accounts"], "Privat regnskap");
  },
  // Én knapp skal ta Ole fra «BUS400N om 5 min» til en ChatGPT som allerede vet
  // hvor lang økta er og hvilke frister som nærmer seg. Utklippstavla settes før
  // Chrome åpnes, slik at teksten står klar i det vinduet kommer fram.
  async "subject-session"(exec, payload, deps = {}) {
    const readProjects = deps.readProjects ?? readSubjectProjects;
    const readCalendar = deps.readCalendar ?? getSyncCalendar;
    const { code, minutes, title } = normalizeSessionRequest(payload);
    const projects = await readProjects();
    const url = projects[code];
    if (!url) throw new Error(`${code} har ingen ChatGPT-prosjekt registrert på Mac-en`);
    // Kalenderen leses her framfor å komme fra nettleseren, slik at fristene i
    // prompten er de samme som Apple Kalender faktisk har.
    let events = [];
    try {
      ({ events } = await readCalendar());
    } catch {
      // En prompt uten fristliste er fortsatt en brukbar prompt. At kalenderen
      // ikke svarte skal ikke stoppe økta.
      events = [];
    }
    await copyToClipboard(exec, buildSessionPrompt({ code, minutes, title, events }));
    await openInChrome(exec, "subject-session", url, `${code} i ChatGPT`);
    return { action: "subject-session", target: "chrome", label: code, minutes };
  },
  async "calendar-privacy"(exec) {
    await exec("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"]);
    return { action: "calendar-privacy", target: "settings", label: "Personvern → Kalendere" };
  },
  async "claude-login"(exec) {
    return openInTerminal(exec, "claude-login", "claude auth login", "Claude");
  },
  async "codex-login"(exec) {
    return openInTerminal(exec, "codex-login", "codex login", "Codex");
  },
  async "screen-mirror"(exec, payload) {
    const device = normalizeDeviceName(payload?.device);
    let binary;
    try {
      binary = await ensureSidecarBinary(exec);
    } catch (error) {
      throw new Error(`Klarte ikke å bygge Sidecar-verktøyet (${firstErrorLine(error, "clang mangler")})`);
    }
    try {
      const { stdout } = await exec(binary, ["toggle", device]);
      const result = JSON.parse(stdout);
      return { action: "screen-mirror", target: "display", label: result.device, state: result.state };
    } catch (error) {
      throw new Error(firstErrorLine(error, "Sidecar svarte ikke"));
    }
  },
};

function isMacAction(action) {
  return typeof action === "string" && Object.hasOwn(macActions, action);
}

async function runMacAction(action, { exec = runCommand, platform = process.platform, payload, deps } = {}) {
  if (!isMacAction(action)) throw new Error("Ukjent Mac-handling");
  if (platform !== "darwin") throw new Error("Mac-handlinger krever at panelet kjører på Mac-en");
  return macActions[action](exec, payload, deps);
}

export { isMacAction, runMacAction };
