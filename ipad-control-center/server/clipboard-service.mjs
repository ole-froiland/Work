import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const runCommand = promisify(execFile);

// Tekst går til `pbcopy` over stdin, ikke gjennom AppleScript. `set the
// clipboard to (read … as «class utf8»)` la teksten på tavla i Mac Roman:
// en em-dash kom ut som ett byte i stedet for tre, og «—» ble til «Ñ». Stdin
// har ingen tegnsettoversettelse, ingen grense på argumentlista, og innholdet
// står fortsatt aldri på kommandolinja.
function pipeToCommand(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`${command} avsluttet med ${code}`), { stderr }));
    });
    child.stdin.on("error", reject);
    child.stdin.end(input, "utf8");
  });
}

// Et skjermbilde fra en iPhone 17 Pro Max ligger rundt 3 MB som PNG, og base64
// legger på en tredel. Grensen er satt over det med margin, men ikke så høyt at
// et vilkårlig stort svelg kan sendes inn.
export const MAX_CLIPBOARD_BYTES = 12 * 1024 * 1024;

const acceptedImages = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);

function parseImageDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg));base64,([\s\S]+)$/.exec(String(value ?? "").trim());
  if (!match) throw new Error("Bildet må være PNG eller JPEG");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("Bildet var tomt");
  if (bytes.length > MAX_CLIPBOARD_BYTES) throw new Error("Bildet er for stort til å sendes");
  return { mediaType: match[1], extension: acceptedImages.get(match[1]), bytes };
}

// Ren funksjon, slik at formatkravene kan prøves uten en Mac i den andre enden.
export function normalizeClipboardPayload(body = {}) {
  const kind = String(body?.kind ?? "").trim();
  if (kind === "text") {
    const text = typeof body.text === "string" ? body.text : "";
    if (!text) throw new Error("Utklippstavla på telefonen var tom");
    if (Buffer.byteLength(text, "utf8") > MAX_CLIPBOARD_BYTES) throw new Error("Teksten er for stor til å sendes");
    return { kind: "text", text };
  }
  if (kind === "image") {
    return { kind: "image", ...parseImageDataUrl(body.dataUrl) };
  }
  throw new Error("Ukjent type på utklippet");
}

async function withTempDir(job) {
  const dir = await mkdtemp(join(tmpdir(), "panel-clipboard-"));
  try {
    return await job(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function firstErrorLine(error, fallback) {
  const text = String(error?.stderr || error?.message || "").split("\n").map((line) => line.trim()).find(Boolean);
  return text || fallback;
}

// Innholdet går gjennom en fil og aldri gjennom kommandolinja. Det er både
// fordi argumentlista på macOS tar slutt rundt én megabyte, og fordi et utklipp
// er tekst vi ikke kjenner: som argument til et skript kunne den blitt tolket.
export async function writeMacClipboard(payload, { exec = runCommand, pipe = pipeToCommand } = {}) {
  if (payload.kind === "text") {
    try {
      await pipe("pbcopy", [], payload.text);
    } catch (error) {
      throw new Error(`Fikk ikke lagt teksten på Mac-ens utklippstavle (${firstErrorLine(error, "pbcopy svarte ikke")})`);
    }
    return { kind: "text", characters: payload.text.length };
  }

  return withTempDir(async (dir) => {
    let file = join(dir, `clipboard.${payload.extension}`);
    await writeFile(file, payload.bytes);
    // Utklippstavla på macOS vil ha PNG. Et JPEG konverteres først, slik at
    // Mac-siden bare har én vei å gå.
    if (payload.mediaType !== "image/png") {
      const converted = join(dir, "clipboard-converted.png");
      try {
        await exec("sips", ["-s", "format", "png", file, "--out", converted]);
      } catch (error) {
        throw new Error(`Fikk ikke gjort om bildet til PNG (${firstErrorLine(error, "sips svarte ikke")})`);
      }
      file = converted;
    }
    await runOsascript(exec, "«class PNGf»", file, "Fikk ikke lagt bildet på Mac-ens utklippstavle");
    return { kind: "image", bytes: payload.bytes.length };
  });
}

async function runOsascript(exec, appleClass, file, failure) {
  try {
    await exec("osascript", [
      "-e", "on run {target}",
      "-e", `set the clipboard to (read (POSIX file target) as ${appleClass})`,
      "-e", "end run",
      file,
    ]);
  } catch (error) {
    throw new Error(`${failure} (${firstErrorLine(error, "osascript svarte ikke")})`);
  }
}

// Tekst først: `pbpaste` svarer tomt når utklippet er et bilde, og da er det
// bildet som er der. Rekkefølgen betyr at et kopiert bilde aldri kommer tilbake
// som en tom streng.
export async function readMacClipboard({ exec = runCommand } = {}) {
  let text = "";
  try {
    const result = await exec("pbpaste", [], { maxBuffer: MAX_CLIPBOARD_BYTES });
    text = String(result?.stdout ?? "");
  } catch (error) {
    return { ok: false, kind: "empty", error: `Fikk ikke lest Mac-ens utklippstavle (${firstErrorLine(error, "pbpaste svarte ikke")})` };
  }
  if (text) return { ok: true, kind: "text", text };

  return withTempDir(async (dir) => {
    const file = join(dir, "clipboard.png");
    try {
      await exec("osascript", [
        "-e", "on run {target}",
        "-e", "set png to (the clipboard as «class PNGf»)",
        "-e", "set handle to open for access (POSIX file target) with write permission",
        "-e", "set eof handle to 0",
        "-e", "write png to handle",
        "-e", "close access handle",
        "-e", "end run",
        file,
      ]);
    } catch {
      // Ikke en feil: utklippstavla er tom, eller inneholder noe som verken er
      // tekst eller et bilde. Da er det ingenting å hente, og det er et svar.
      return { ok: true, kind: "empty" };
    }
    // Skriptet kan gå gjennom uten å legge igjen noe — utklippstavla svarte,
    // men hadde ikke et bilde å gi. Det er «ingenting å hente», ikke en feil,
    // og en tom utklippstavle skal aldri se ut som at Mac-en er nede.
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      return { ok: true, kind: "empty" };
    }
    if (!bytes.length) return { ok: true, kind: "empty" };
    if (bytes.length > MAX_CLIPBOARD_BYTES) {
      return { ok: false, kind: "empty", error: "Bildet på Mac-en er for stort til å hentes hit" };
    }
    return { ok: true, kind: "image", mediaType: "image/png", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
  });
}
