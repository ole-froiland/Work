import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Sammendragene kan ikke utledes på nytt. Posten de beskriver er arkivert og
// lest, og en mail fra i går kommer aldri tilbake gjennom vinduet sitt — så
// filene hører hjemme i Application Support sammen med dagsmalen, ikke i
// Caches der ting får lov å forsvinne.
const DIGEST_DIR = join(homedir(), "Library", "Application Support", "ipad-control-center", "mail-digests");
// Et døgn med post er små tall. Taket står der for å hindre at en jobb som går
// i loop skriver en fil telefonen ikke klarer å tegne, ikke fordi 200 mail på
// en dag er noe å forvente.
const MAX_ITEMS = 200;
const MAX_DAYS = 400;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function shortText(value, maximum) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

function isoText(value) {
  const date = new Date(typeof value === "string" ? value : "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Jobben som skriver filene er en språkmodell, og en språkmodell skriver av og
// til et felt som heter noe annet enn avtalt. Derfor leses filene defensivt:
// alt som mangler blir null, og en post uten avsender og emne er ikke en post.
function normalizeItem(input) {
  const from = shortText(input?.from, 120) ?? shortText(input?.sender, 120);
  const subject = shortText(input?.subject, 200);
  if (!from && !subject) return null;
  return {
    id: shortText(input?.id, 100),
    from: from ?? "Ukjent avsender",
    address: shortText(input?.address, 200),
    at: isoText(input?.at) ?? isoText(input?.date),
    subject: subject ?? "(uten emne)",
    summary: shortText(input?.summary, 400),
    label: shortText(input?.label, 60),
    // Oransje i panelet betyr «her må Ole gjøre noe». Alt annet er til
    // orientering, og skal ikke rope.
    action: input?.action === true,
    why: shortText(input?.why, 200),
  };
}

export function normalizeDigest(input, date) {
  const items = Array.isArray(input?.items)
    ? input.items.slice(0, MAX_ITEMS).map(normalizeItem).filter(Boolean)
    : [];
  return {
    date,
    generatedAt: isoText(input?.generatedAt),
    window: {
      from: isoText(input?.window?.from),
      to: isoText(input?.window?.to),
    },
    counts: {
      total: items.length,
      action: items.filter((item) => item.action).length,
    },
    // Nyest først. Telefonen leser ovenfra, og det som kom i natt er det
    // eneste som kan haste.
    items: items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")),
    note: shortText(input?.note, 400),
  };
}

export async function listDigestDates() {
  try {
    const files = await readdir(DIGEST_DIR);
    return files
      .filter((name) => name.endsWith(".json") && DATE_PATTERN.test(name.slice(0, -5)))
      .map((name) => name.slice(0, -5))
      .sort()
      .reverse()
      .slice(0, MAX_DAYS);
  } catch {
    return [];
  }
}

export async function readDigest(date) {
  if (!DATE_PATTERN.test(date ?? "")) return null;
  try {
    const raw = await readFile(join(DIGEST_DIR, `${date}.json`), "utf8");
    return normalizeDigest(JSON.parse(raw), date);
  } catch {
    return null;
  }
}

// Panelet spør uten å vite hvilke dager som finnes. Det får den nyeste dagen
// som faktisk er skrevet, og listen over resten, så bla-knappene kan tegnes
// uten en ekstra runde.
export async function getMailDigest(requested) {
  const dates = await listDigestDates();
  const date = DATE_PATTERN.test(requested ?? "") ? requested : dates[0] ?? null;
  const digest = date ? await readDigest(date) : null;
  return { dates, digest, date };
}

export async function saveDigest(input, date) {
  if (!DATE_PATTERN.test(date ?? "")) throw new Error("Ugyldig dato");
  const digest = normalizeDigest(input, date);
  await mkdir(DIGEST_DIR, { recursive: true });
  await writeFile(join(DIGEST_DIR, `${date}.json`), `${JSON.stringify(digest, null, 2)}\n`, "utf8");
  return digest;
}

export { DIGEST_DIR };
