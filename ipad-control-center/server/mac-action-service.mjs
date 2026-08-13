import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
};

let sidecarBuild = null;

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
    await exec("open", ["-a", "Google Chrome", chromeTargets["sync-projects"]]);
    return { action: "sync-projects", target: "chrome", label: "Sync-prosjekter" };
  },
  async "nhh-subjects"(exec) {
    await exec("open", ["-a", "Google Chrome", chromeTargets["nhh-subjects"]]);
    return { action: "nhh-subjects", target: "chrome", label: "NHH-fag" };
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

async function runMacAction(action, { exec = runCommand, platform = process.platform, payload } = {}) {
  if (!isMacAction(action)) throw new Error("Ukjent Mac-handling");
  if (platform !== "darwin") throw new Error("Mac-handlinger krever at panelet kjører på Mac-en");
  return macActions[action](exec, payload);
}

export { isMacAction, runMacAction };
