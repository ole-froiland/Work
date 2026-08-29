# Dagsplan som skyver seg — implementasjonsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bolkene i en dagsmal legger seg ut fra klokkeslettet Ole faktisk sto opp, rundt Apple-avtalene som ankre, og panelet finner ut av det klokkeslettet selv.

**Architecture:** All utlegging er én ren funksjon i `src/dashboard.js`, testbar uten server og uten nettleser. En liten tjeneste på Mac-en leser malen og lagrer oppvåkningen. Ett nytt endepunkt binder dem sammen. Telefonen melder oppvåkning inn til det samme endepunktet, fra en iOS-snarvei eller fra companion-appen.

**Tech Stack:** Node 20+ ESM, Vite 7 middleware-plugins, React 19, `node --test`, Swift/SwiftUI i `ios-companion`.

## Global Constraints

- Alt av brukertekst er på norsk. Feilmeldinger òg.
- Ingen nye avhengigheter. Alt under bruker Node-standardbiblioteket og det som allerede står i `package.json`.
- Apple Kalender skrives ikke til. `mutateMacAppleCalendar()` røres ikke i denne planen.
- Skyving går bare framover: `shift = max(0, wokeAt − wakeAnchor)`.
- Bolker komprimeres aldri. Varigheten fra malen er ukrenkelig.
- Malen ligger i `~/Library/Application Support/ipad-control-center/day-plan.json`, oppvåkningen i `~/Library/Caches/ipad-control-center/day-wake.json`. Skillet er bevisst: malen kan ikke utledes på nytt, oppvåkningen kan det.
- Filer skrives med `{ mode: 0o600 }`, som resten av tjenestene.
- Kjøres med `npm test` fra `ipad-control-center/`. Nye testfiler må legges til i `test`-skriptet i `package.json`.

---

### Task 1: `planDay` — selve utleggingen

Hele regelverket, som en ren funksjon. Ingen filer, ingen nettverk, ingen React.

**Files:**
- Modify: `ipad-control-center/src/dashboard.js` (legg til nederst, ved siden av `layoutDayEvents`)
- Test: `ipad-control-center/tests/dashboard.test.mjs`

**Interfaces:**
- Consumes: ingenting fra tidligere oppgaver.
- Produces:
  - `clockMinutes(value: string) -> number | null` — `"07:00"` til minutter etter midnatt.
  - `planDay({ template, wokeAt, anchors, day, done }) -> { placed, dropped, shift }`
    - `template`: `{ wakeAnchor: "HH:MM", dayEnd: "HH:MM", blocks: [{ id, title, minutes, tone }] }`
    - `wokeAt`: ISO-streng eller `null`
    - `anchors`: Apple-hendelser, samme form som `layoutDayEvents` tar
    - `day`: `Date` for dagen som legges ut
    - `done`: `[{ id, at }]`
    - `placed`: `[{ ...block, startMinute, endMinute, start, end, done }]` — `start`/`end` er ISO-strenger
    - `dropped`: `[block]` — malbolkene som ikke fikk plass
    - `shift`: minutter dagen ble skjøvet

- [ ] **Step 1: Skriv de fallende testene**

Legg til nederst i `ipad-control-center/tests/dashboard.test.mjs`, og legg `clockMinutes` og `planDay` inn i den eksisterende `import`-lista fra `../src/dashboard.js`:

```js
const malen = {
  wakeAnchor: "07:00",
  dayEnd: "23:00",
  blocks: [
    { id: "morgen", title: "Morgenrutine", minutes: 30, tone: "sky" },
    { id: "lese", title: "Lese BUS400N", minutes: 90, tone: "violet" },
  ],
};
const dagen = new Date(2026, 7, 28);

function tid(timer, minutter = 0) {
  return new Date(2026, 7, 28, timer, minutter).toISOString();
}

test("leser klokkeslett, og avviser det som ikke er et", () => {
  assert.equal(clockMinutes("07:00"), 420);
  assert.equal(clockMinutes("23:59"), 1439);
  assert.equal(clockMinutes("24:00"), null);
  assert.equal(clockMinutes("7:5"), null);
  assert.equal(clockMinutes(""), null);
  assert.equal(clockMinutes(undefined), null);
});

test("uten oppvåkning legges malen ut fra sitt eget ankertidspunkt", () => {
  const { placed, dropped, shift } = planDay({ template: malen, wokeAt: null, anchors: [], day: dagen });
  assert.equal(shift, 0);
  assert.deepEqual(dropped, []);
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.endMinute]), [
    ["morgen", 420, 450],
    ["lese", 450, 540],
  ]);
});

test("står Ole opp tidligere enn malen, skyves ingenting bakover", () => {
  const { placed, shift } = planDay({ template: malen, wokeAt: tid(5, 30), anchors: [], day: dagen });
  assert.equal(shift, 0);
  assert.equal(placed[0].startMinute, 420);
});

test("alle bolker skyves like langt når det ikke finnes ankre", () => {
  const { placed, shift } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [], day: dagen });
  assert.equal(shift, 160);
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.endMinute]), [
    ["morgen", 580, 610],
    ["lese", 610, 700],
  ]);
});

test("en bolk som treffer et anker legges etter ankeret, ikke oppå", () => {
  const forelesning = { id: "f1", title: "Forelesning", start: tid(10, 0), end: tid(12, 0) };
  const { placed } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [forelesning], day: dagen });
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.endMinute]), [
    ["morgen", 720, 750],
    ["lese", 750, 840],
  ]);
});

test("en heldagsavtale er ingen tidsbegrensning og teller ikke som anker", () => {
  const bursdag = { id: "b1", title: "Bursdag", allDay: true, start: tid(0, 0), end: tid(23, 59) };
  const { placed } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [bursdag], day: dagen });
  assert.equal(placed.length, 2);
  assert.equal(placed[0].startMinute, 580);
});

test("en bolk som ikke får plass før dagen er over havner i dropped", () => {
  const { placed, dropped } = planDay({ template: malen, wokeAt: tid(22, 0), anchors: [], day: dagen });
  assert.deepEqual(placed.map((block) => block.id), ["morgen"]);
  assert.deepEqual(dropped.map((block) => block.id), ["lese"]);
});

test("en kort bolk etter en droppet bolk får fortsatt plass", () => {
  const template = {
    ...malen,
    blocks: [
      { id: "lang", title: "Lang", minutes: 120 },
      { id: "kort", title: "Kort", minutes: 15 },
    ],
  };
  const { placed, dropped } = planDay({ template, wokeAt: tid(22, 0), anchors: [], day: dagen });
  assert.deepEqual(dropped.map((block) => block.id), ["lang"]);
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute]), [["kort", 1320]]);
});

test("en avhuket bolk beholder tidspunktet den faktisk ble gjort på", () => {
  const done = [{ id: "morgen", at: tid(10, 5) }];
  const { placed } = planDay({ template: malen, wokeAt: tid(9, 40), anchors: [], day: dagen, done });
  assert.deepEqual(placed.map((block) => [block.id, block.startMinute, block.done]), [
    ["morgen", 605, true],
    ["lese", 635, false],
  ]);
});

test("en mal uten bolker gir en tom plan i stedet for å kaste", () => {
  const { placed, dropped, shift } = planDay({ template: { wakeAnchor: "07:00", dayEnd: "23:00", blocks: [] }, day: dagen });
  assert.deepEqual({ placed, dropped, shift }, { placed: [], dropped: [], shift: 0 });
});
```

- [ ] **Step 2: Kjør testene og se at de faller**

```bash
cd ipad-control-center && npm test 2>&1 | grep -A3 "clockMinutes\|planDay" | head -20
```

Forventet: feiler med `SyntaxError` eller `clockMinutes is not a function` — funksjonene finnes ikke ennå.

- [ ] **Step 3: Skriv funksjonene**

Legg til nederst i `ipad-control-center/src/dashboard.js`:

```js
// Malen er skrevet i klokkeslett, ikke i datoer, fordi den gjelder alle dager.
// Alt regnestykke under gjøres derfor i minutter etter midnatt, og først
// oversettes tilbake til datoer når bolkene skal tegnes.
export function clockMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minuteDate(day, minute) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute);
}

function minuteOfDay(value) {
  const date = new Date(value ?? "");
  return Number.isFinite(+date) ? date.getHours() * 60 + date.getMinutes() : null;
}

// Skyvingen går bare framover. Symmetri hadde lagt lesingen til 05:30 fordi Ole
// våknet tidlig én gang, og det er ikke problemet dagsplanen løser.
export function planDay({ template, wokeAt = null, anchors = [], day = new Date(), done = [] } = {}) {
  const blocks = Array.isArray(template?.blocks) ? template.blocks : [];
  const anchorMinute = clockMinutes(template?.wakeAnchor);
  const endMinute = clockMinutes(template?.dayEnd);
  if (!blocks.length || anchorMinute === null || endMinute === null) return { placed: [], dropped: [], shift: 0 };

  const wokeMinute = wokeAt ? minuteOfDay(wokeAt) : null;
  const shift = wokeMinute === null ? 0 : Math.max(0, wokeMinute - anchorMinute);

  // Heldagsavtaler holdes utenfor. De sier ingenting om når på dagen noe skjer,
  // og ville ellers spist hvert eneste ledige minutt.
  const busy = (Array.isArray(anchors) ? anchors : [])
    .flatMap((event) => {
      if (!event || event.allDay) return [];
      const start = minuteOfDay(event.start);
      const end = minuteOfDay(event.end);
      if (start === null || end === null || end <= start) return [];
      return [{ start, end }];
    })
    .sort((a, b) => a.start - b.start);

  const doneById = new Map((Array.isArray(done) ? done : []).flatMap((entry) => {
    const at = minuteOfDay(entry?.at);
    return entry?.id && at !== null ? [[entry.id, at]] : [];
  }));

  const placed = [];
  const dropped = [];
  let cursor = anchorMinute + shift;

  for (const block of blocks) {
    const minutes = Number(block?.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    const doneAt = doneById.get(block.id);
    let start = cursor;
    // Ett hopp per anker holder: ankrene er sortert, og hvert hopp lander på
    // slutten av det ankeret som var i veien.
    for (let guard = 0; guard <= busy.length; guard += 1) {
      const hit = busy.find((slot) => start < slot.end && slot.start < start + minutes);
      if (!hit) break;
      start = hit.end;
    }

    // En avhuket bolk varte fra der den sto til den ble huket av. Da retter
    // planen seg hele dagen og ikke bare om morgenen. Bolken flyttes aldri
    // bakover til avhukingstidspunktet — det la den oppå den som lå der.
    if (doneAt !== undefined) {
      const end = Math.max(start + 1, doneAt);
      placed.push({ ...block, startMinute: start, endMinute: end, done: true,
        start: minuteDate(day, start).toISOString(), end: minuteDate(day, end).toISOString() });
      cursor = end;
      continue;
    }

    // Markøren står stille når en bolk faller ut, slik at en kortere bolk lenger
    // ned i malen fortsatt kan få plass i hullet.
    if (start + minutes > endMinute) {
      dropped.push(block);
      continue;
    }

    placed.push({ ...block, startMinute: start, endMinute: start + minutes, done: false,
      start: minuteDate(day, start).toISOString(), end: minuteDate(day, start + minutes).toISOString() });
    cursor = start + minutes;
  }

  return { placed, dropped, shift };
}
```

- [ ] **Step 4: Kjør testene og se at de går**

```bash
cd ipad-control-center && npm test
```

Forventet: alle tester passerer, inkludert de ni nye.

- [ ] **Step 5: Commit**

```bash
git add ipad-control-center/src/dashboard.js ipad-control-center/tests/dashboard.test.mjs
git commit -m "Lay the day out from when Ole actually got up"
```

---

### Task 2: Malen og oppvåkningen på disk

Én tjeneste, fordi de to filene alltid leses sammen og endres sammen.

**Files:**
- Create: `ipad-control-center/server/day-plan-service.mjs`
- Create: `ipad-control-center/tests/day-plan.test.mjs`
- Modify: `ipad-control-center/package.json` (legg `tests/day-plan.test.mjs` inn i `test`-skriptet)

**Interfaces:**
- Consumes: ingenting fra Task 1. Tjenesten kjenner ikke `planDay`; utleggingen skjer i nettleseren.
- Produces:
  - `normalizeDayPlanTemplate(input) -> { wakeAnchor, dayEnd, blocks } | null`
  - `normalizeWake(input, now) -> { wokeAt, source }` — kaster `Error` med norsk melding ved avvist tidspunkt
  - `readDayPlanTemplate() -> Promise<template | null>`
  - `readWake(now) -> Promise<{ date, wokeAt, source, confirmed, done }>`
  - `recordWake(input, now) -> Promise<wake>`
  - `markBlockDone({ id, at }, now) -> Promise<wake>`
  - `getDayPlan(now) -> Promise<{ template, wake, connected }>`

- [ ] **Step 1: Skriv de fallende testene**

Opprett `ipad-control-center/tests/day-plan.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDayPlanTemplate, normalizeWake } from "../server/day-plan-service.mjs";

const naa = new Date(2026, 7, 28, 12, 0);

test("tar imot en mal og kaster det som ikke hører hjemme i den", () => {
  const template = normalizeDayPlanTemplate({
    wakeAnchor: "07:00",
    dayEnd: "23:00",
    blocks: [
      { id: "morgen", title: "Morgenrutine", minutes: 30, tone: "sky" },
      { id: "tull", title: "Uten varighet" },
      { id: "verre", minutes: 30 },
      { id: "negativ", title: "Negativ", minutes: -5 },
      { id: "farge", title: "Ukjent tone", minutes: 20, tone: "neon" },
    ],
  });
  assert.deepEqual(template, {
    wakeAnchor: "07:00",
    dayEnd: "23:00",
    blocks: [
      { id: "morgen", title: "Morgenrutine", minutes: 30, tone: "sky" },
      { id: "farge", title: "Ukjent tone", minutes: 20, tone: "violet" },
    ],
  });
});

test("en mal uten gyldige klokkeslett er ingen mal", () => {
  assert.equal(normalizeDayPlanTemplate({ wakeAnchor: "sju", dayEnd: "23:00", blocks: [] }), null);
  assert.equal(normalizeDayPlanTemplate({ wakeAnchor: "07:00", dayEnd: "23:00" }), null);
  assert.equal(normalizeDayPlanTemplate(null), null);
});

test("en mal som slutter før den begynner er ingen mal", () => {
  assert.equal(normalizeDayPlanTemplate({ wakeAnchor: "23:00", dayEnd: "07:00", blocks: [{ id: "a", title: "A", minutes: 30 }] }), null);
});

test("tar imot en oppvåkning fra i dag", () => {
  const wake = normalizeWake({ wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(), source: "shortcut" }, naa);
  assert.equal(wake.source, "shortcut");
  assert.equal(new Date(wake.wokeAt).getHours(), 9);
});

test("avviser en oppvåkning som ligger fram i tid", () => {
  assert.throws(
    () => normalizeWake({ wokeAt: new Date(2026, 7, 28, 14, 0).toISOString(), source: "usage" }, naa),
    /fram i tid/,
  );
});

test("avviser en oppvåkning som ikke er i dag", () => {
  assert.throws(
    () => normalizeWake({ wokeAt: new Date(2026, 7, 27, 9, 0).toISOString(), source: "usage" }, naa),
    /ikke i dag/,
  );
});

test("avviser en ukjent kilde", () => {
  assert.throws(
    () => normalizeWake({ wokeAt: new Date(2026, 7, 28, 9, 0).toISOString(), source: "gjett" }, naa),
    /Ukjent kilde/,
  );
});
```

- [ ] **Step 2: Kjør testen og se at den faller**

```bash
cd ipad-control-center && node --test tests/day-plan.test.mjs
```

Forventet: `ERR_MODULE_NOT_FOUND` — `server/day-plan-service.mjs` finnes ikke.

- [ ] **Step 3: Skriv tjenesten**

Opprett `ipad-control-center/server/day-plan-service.mjs`:

```js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Malen er skrevet av Ole og kan ikke utledes på nytt hvis den forsvinner. Den
// hører derfor hjemme i Application Support, ikke i Caches der kalendercachen
// ligger. Oppvåkningen gjelder én dag og kan utledes på nytt i morgen.
const TEMPLATE_FILE = join(homedir(), "Library", "Application Support", "ipad-control-center", "day-plan.json");
const WAKE_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "day-wake.json");
const MAX_BLOCKS = 40;
const MAX_MINUTES = 12 * 60;
const TONES = new Set(["violet", "emerald", "amber", "sky"]);
const SOURCES = new Set(["shortcut", "usage", "manual"]);

function shortText(value, maximum) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

function clockText(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59 ? value : null;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function normalizeDayPlanTemplate(input) {
  const wakeAnchor = clockText(input?.wakeAnchor);
  const dayEnd = clockText(input?.dayEnd);
  if (!wakeAnchor || !dayEnd || !Array.isArray(input?.blocks)) return null;
  if (dayEnd <= wakeAnchor) return null;
  const blocks = input.blocks.slice(0, MAX_BLOCKS).flatMap((value) => {
    const id = shortText(value?.id, 100);
    const title = shortText(value?.title, 200);
    const minutes = Number(value?.minutes);
    if (!id || !title || !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) return [];
    return [{ id, title, minutes, tone: TONES.has(value?.tone) ? value.tone : "violet" }];
  });
  return { wakeAnchor, dayEnd, blocks };
}

export function normalizeWake(input, now = new Date()) {
  const wokeAt = new Date(input?.wokeAt ?? "");
  if (!Number.isFinite(+wokeAt)) throw new Error("Ugyldig tidspunkt");
  // Begge avvisningene betyr at noe er galt i kilden, ikke at Ole sto opp i går
  // eller i morgen. Da er det bedre å la gårsdagens plan stå.
  if (+wokeAt > +now) throw new Error("Tidspunktet ligger fram i tid");
  if (dateKey(wokeAt) !== dateKey(now)) throw new Error("Tidspunktet er ikke i dag");
  if (!SOURCES.has(input?.source)) throw new Error("Ukjent kilde");
  return { wokeAt: wokeAt.toISOString(), source: input.source };
}

function emptyWake(now) {
  return { date: dateKey(now), wokeAt: null, source: null, confirmed: false, done: [] };
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

export async function readDayPlanTemplate() {
  return normalizeDayPlanTemplate(await readJsonFile(TEMPLATE_FILE));
}

export async function readWake(now = new Date()) {
  const stored = await readJsonFile(WAKE_FILE);
  // En oppføring fra i går er ikke feil, den er bare gammel. Ny dag, ny start.
  if (!stored || stored.date !== dateKey(now)) return emptyWake(now);
  return {
    date: stored.date,
    wokeAt: typeof stored.wokeAt === "string" ? stored.wokeAt : null,
    source: SOURCES.has(stored.source) ? stored.source : null,
    confirmed: stored.source === "manual",
    done: Array.isArray(stored.done) ? stored.done : [],
  };
}

export async function recordWake(input, now = new Date()) {
  const { wokeAt, source } = normalizeWake(input, now);
  const current = await readWake(now);
  // En rettelse Ole har gjort for hånd skal ikke kunne overskrives av et signal
  // som kommer etterpå. Gjettet taper alltid mot mennesket.
  if (current.source === "manual" && source !== "manual") return current;
  const next = { ...current, wokeAt, source, confirmed: source === "manual" };
  await writeJsonFile(WAKE_FILE, next);
  return next;
}

export async function markBlockDone(input, now = new Date()) {
  const id = shortText(input?.id, 100);
  if (!id) throw new Error("Ugyldig bolk");
  const at = new Date(input?.at ?? now);
  if (!Number.isFinite(+at)) throw new Error("Ugyldig tidspunkt");
  const current = await readWake(now);
  const done = [...current.done.filter((entry) => entry?.id !== id), { id, at: at.toISOString() }];
  const next = { ...current, done };
  await writeJsonFile(WAKE_FILE, next);
  return next;
}

export async function getDayPlan(now = new Date()) {
  const [template, wake] = await Promise.all([readDayPlanTemplate(), readWake(now)]);
  // Fraværet av en mal er ingen feiltilstand. Da oppfører panelet seg som før.
  return { template, wake, connected: template !== null };
}
```

- [ ] **Step 4: Legg testfila inn i testskriptet**

I `ipad-control-center/package.json`, legg `tests/day-plan.test.mjs` inn i `test`-skriptet, i alfabetisk rekkefølge mellom `tests/dashboard.test.mjs` og `tests/device-metrics.test.mjs`:

```
"test": "node --test tests/agent-sessions.test.mjs tests/connection-repair.test.mjs tests/dashboard.test.mjs tests/day-plan.test.mjs tests/device-metrics.test.mjs tests/mac-action.test.mjs tests/spotify.test.mjs tests/sync-calendar.test.mjs tests/usage-service.test.mjs tests/vite-config.test.mjs"
```

- [ ] **Step 5: Kjør testene og se at de går**

```bash
cd ipad-control-center && npm test
```

Forventet: alle passerer, inkludert de sju nye i `day-plan.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add ipad-control-center/server/day-plan-service.mjs ipad-control-center/tests/day-plan.test.mjs ipad-control-center/package.json
git commit -m "Keep the template where it cannot be re-derived, the wake where it can"
```

---

### Task 3: `/api/day-plan`

**Files:**
- Modify: `ipad-control-center/vite.config.mjs` (ny `dayPlanApi()`, registrert i `plugins`-lista på linje 400)
- Test: `ipad-control-center/tests/vite-config.test.mjs`

**Interfaces:**
- Consumes: `getDayPlan`, `recordWake`, `markBlockDone` fra Task 2.
- Produces: `GET /api/day-plan` → `{ template, wake, connected }`. `POST /api/day-plan` med `{ kind: "wake", wokeAt, source }` eller `{ kind: "done", id, at }` → oppdatert `wake`.

- [ ] **Step 1: Skriv den fallende testen**

Se først hvordan `tests/vite-config.test.mjs` allerede sjekker plugin-registrering, og følg samme form. Legg til:

```js
test("dagsplanen er montert som eget endepunkt", () => {
  const source = readFileSync(new URL("../vite.config.mjs", import.meta.url), "utf8");
  assert.match(source, /server\.middlewares\.use\("\/api\/day-plan"/);
  assert.match(source, /plugins: \[[^\]]*dayPlanApi\(\)/);
});
```

Om `readFileSync` ikke allerede er importert i fila, legg til `import { readFileSync } from "node:fs";` øverst.

- [ ] **Step 2: Kjør testen og se at den faller**

```bash
cd ipad-control-center && node --test tests/vite-config.test.mjs
```

Forventet: FAIL — ingen av de to mønstrene finnes i `vite.config.mjs`.

- [ ] **Step 3: Skriv endepunktet**

I `ipad-control-center/vite.config.mjs`, legg til i importblokka øverst:

```js
import { getDayPlan, markBlockDone, recordWake } from "./server/day-plan-service.mjs";
```

Legg så inn plugin-funksjonen, rett etter `syncNotesApi()`:

```js
function dayPlanApi() {
  return {
    name: "local-day-plan-api",
    configureServer(server) {
      server.middlewares.use("/api/day-plan", async (request, response) => {
        if (!setSyncCors(request, response)) {
          sendJson(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          response.end();
          return;
        }
        try {
          if (request.method === "GET") {
            sendJson(response, 200, await getDayPlan(new Date()));
            return;
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request, 32_768);
            if (body.kind === "done") {
              sendJson(response, 200, { wake: await markBlockDone(body, new Date()) });
              return;
            }
            sendJson(response, 200, { wake: await recordWake(body, new Date()) });
            return;
          }
          sendJson(response, 405, { error: "Method not allowed" });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}
```

Legg `dayPlanApi()` inn i `plugins`-lista, etter `syncNotesApi()`:

```js
plugins: [usageApi(), agentSessionsApi(), deviceMetricsApi(), syncCalendarApi(), syncNotesApi(), dayPlanApi(), spotifyApi(), panelHelloApi(), macActionApi(), connectionRepairApi(), react()],
```

- [ ] **Step 4: Kjør testene og se at de går**

```bash
cd ipad-control-center && npm test
```

Forventet: alle passerer.

- [ ] **Step 5: Sjekk endepunktet med ekte mal**

```bash
cd ipad-control-center && mkdir -p ~/Library/Application\ Support/ipad-control-center && printf '%s' '{"wakeAnchor":"07:00","dayEnd":"23:00","blocks":[{"id":"morgen","title":"Morgenrutine","minutes":30,"tone":"sky"},{"id":"lese","title":"Lese BUS400N","minutes":90,"tone":"violet"}]}' > ~/Library/Application\ Support/ipad-control-center/day-plan.json && curl -s localhost:4173/api/day-plan | head -c 400```

Forventet: `{"template":{"wakeAnchor":"07:00",...},"wake":{"date":"...","wokeAt":null,...},"connected":true}`.

Om `curl` ikke svarer, kjører ikke dev-serveren. Start den med `npm run dev` i et eget skall først.

- [ ] **Step 6: Sjekk at et tidspunkt fram i tid blir avvist**

```bash
curl -s -X POST localhost:4173/api/day-plan -H 'Content-Type: application/json' -d "{\"kind\":\"wake\",\"source\":\"manual\",\"wokeAt\":\"$(date -v+2H -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Forventet: `{"error":"Tidspunktet ligger fram i tid"}`.

- [ ] **Step 7: Commit**

```bash
git add ipad-control-center/vite.config.mjs ipad-control-center/tests/vite-config.test.mjs
git commit -m "Let the phone and the panel reach the day plan over one endpoint"
```

---

### Task 4: Bolkene på dagsflaten

**Files:**
- Modify: `ipad-control-center/src/App.jsx` (`DayCalendar`, og `usePolledResource`-oppsettet rundt linje 857)
- Modify: `ipad-control-center/src/styles.css`

**Interfaces:**
- Consumes: `planDay` fra Task 1, `GET /api/day-plan` fra Task 3.
- Produces: `DayCalendar` tar to nye props, `plan` (`{ placed, dropped, shift }`) og `onDone` (`(id: string) => void`). Begge kan være `undefined`; da tegner den nøyaktig som før.

- [ ] **Step 1: Hent dagsplanen ved siden av kalenderen**

I `src/App.jsx`, rett etter `syncNotes`-oppsettet (rundt linje 867), legg til:

```jsx
  const [dayPlan, refreshDayPlan, setDayPlan] = usePolledResource("/api/day-plan", {
    interval: 30_000,
    initial: { template: null, wake: null, connected: false },
    onError: (current) => ({ ...current, connected: false }),
  });
```

- [ ] **Step 2: Regn ut planen der dagen tegnes**

I samme komponent, ved siden av de andre `useMemo`-kallene:

```jsx
  const plannedDay = useMemo(() => {
    if (!dayPlan.template) return null;
    return planDay({
      template: dayPlan.template,
      wokeAt: dayPlan.wake?.wokeAt ?? null,
      anchors: selectedDayEvents,
      day: date,
      done: dayPlan.wake?.done ?? [],
    });
  }, [dayPlan.template, dayPlan.wake, selectedDayEvents, date]);
```

`selectedDayEvents` finnes allerede på linje 1007 og er nøyaktig avtalene for den
valgte dagen. Legg `plannedDay` rett under den, og legg `planDay` til i
`import`-lista fra `./dashboard.js` på linje 51.

- [ ] **Step 3: Send planen inn i DayCalendar**

Linje 1424, der dagsvisningen velges:

```jsx
{view === "day" && <DayCalendar date={date} events={calendarEvents} now={now} plan={plannedDay} onDone={markDone} />}
```

- [ ] **Step 4: Skriv handleren som huker av en bolk**

Ved siden av den eksisterende kalenderhandleren (rundt linje 1350):

```jsx
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
```

- [ ] **Step 5: Tegn bolkene i DayCalendar**

Erstatt `DayCalendar` med denne. En bolk og en avtale er ikke samme slags ting og skal ikke kunne forveksles på en vegg man ser på i forbifarten — derfor egen klasse, ikke `event-card`:

```jsx
function blockStyle(block) {
  const duration = Math.max(30, block.endMinute - block.startMinute);
  return { top: `${(block.startMinute / DAY_MINUTES) * 100}%`, height: `${(duration / DAY_MINUTES) * 100}%` };
}

function DayCalendar({ date, events, now, plan = null, onDone }) {
  const dayEvents = eventsOnDay(events, date);
  const laidOutEvents = layoutDayEvents(dayEvents);
  const showNow = isSameCalendarDay(now, date);
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / DAY_MINUTES) * 100;
  return (
    <div className="day-calendar" aria-label="Dagens kalender">
      {DAY_HOURS.map((hour) => (
        <div className="time-row" key={hour}>
          <time>{hour}:00</time><span />
        </div>
      ))}
      {plan && plan.placed.length > 0 && (
        <div className="calendar-blocks" aria-label="Dagens bolker">
          {plan.placed.map((block) => (
            <button
              type="button"
              className={`plan-block tone-${calendarTone[block.tone] || "violet"}${block.done ? " is-done" : ""}`}
              style={blockStyle(block)}
              key={block.id}
              onClick={() => onDone?.(block.id)}
            >
              <span className="event-time">{`${formatEventTime(block.start)}–${formatEventTime(block.end)}`}</span>
              <strong>{block.title}</strong>
            </button>
          ))}
        </div>
      )}
      <div className="calendar-events">
        {laidOutEvents.map(({ event, column, columnCount }) => (
          <article className={`event-card tone-${calendarTone[event.tone] || "violet"}`} style={eventStyle(event, column, columnCount)} key={event.id}>
            <span className="event-time">{event.allDay ? "Hele dagen" : `${formatEventTime(event.start)}–${formatEventTime(event.end)}`}</span>
            <strong>{event.title}</strong>
            <small>{event.note || event.calendarName || (event.source === "sync" ? "Sync" : event.source)}</small>
          </article>
        ))}
      </div>
      {showNow && <div className="now-line" style={{ top: `${nowTop}%` }} aria-label={`Nå klokken ${formatEventTime(now)}`}><span />{formatEventTime(now)}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Gi bolkene en egen form**

Legg til i `src/styles.css`, ved siden av `.event-card`. Bolkene ligger bak avtalene og er stiplet, slik at en avtale alltid vinner visuelt:

```css
.calendar-blocks {
  position: absolute;
  inset: 0;
  margin-left: 56px;
  pointer-events: none;
}

.plan-block {
  position: absolute;
  left: 0;
  right: 40%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px dashed currentColor;
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  color: inherit;
  font: inherit;
  text-align: left;
  overflow: hidden;
  pointer-events: auto;
}

.plan-block.is-done {
  opacity: 0.45;
  border-style: solid;
}

.plan-block.is-done strong {
  text-decoration: line-through;
}
```

- [ ] **Step 7: Se på det i nettleseren**

```bash
cd ipad-control-center && npm run dev
```

Åpne panelet, gå til dagsvisningen. Forventet: bolkene fra malen står stiplet bak avtalene, fra 07:00 siden ingen oppvåkning er registrert. Trykk på en bolk; den skal bli gjennomstreket og bli stående der du trykket.

- [ ] **Step 8: Se at skyvingen slår inn**

```bash
curl -s -X POST localhost:4173/api/day-plan -H 'Content-Type: application/json' -d "{\"kind\":\"wake\",\"source\":\"manual\",\"wokeAt\":\"$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Forventet: innen 30 sekunder flytter bolkene seg i panelet, og en bolk som ville kollidert med en avtale ligger etter avtalen.

- [ ] **Step 9: Commit**

```bash
git add ipad-control-center/src/App.jsx ipad-control-center/src/styles.css
git commit -m "Draw the blocks behind the appointments, never on top of them"
```

---

### Task 5: Stripa som viser gjettet, og lista over det som røk

Panelet skal aldri stokke om dagen på et gjett uten at det er synlig at gjettet er tatt.

**Files:**
- Modify: `ipad-control-center/src/App.jsx` (ny `WakeBanner`, ny `DroppedList`)
- Modify: `ipad-control-center/src/styles.css`
- Test: `ipad-control-center/tests/dashboard.test.mjs`

**Interfaces:**
- Consumes: `plan.dropped` og `plan.shift` fra Task 1, `dayPlan.wake` fra Task 3.
- Produces: `describeWake(wake, template) -> { text, tone, needsConfirmation } | null` i `src/dashboard.js`.

- [ ] **Step 1: Skriv den fallende testen**

Legg til i `ipad-control-center/tests/dashboard.test.mjs`, og legg `describeWake` inn i `import`-lista:

```js
test("sier ingenting når ingen oppvåkning er registrert", () => {
  assert.equal(describeWake({ wokeAt: null, source: null }, malen), null);
  assert.equal(describeWake(null, malen), null);
});

test("ber om bekreftelse på et gjett, men ikke på en rettelse", () => {
  const gjettet = describeWake({ wokeAt: tid(9, 40), source: "usage" }, malen);
  assert.equal(gjettet.needsConfirmation, true);
  assert.match(gjettet.text, /09:40/);

  const rettet = describeWake({ wokeAt: tid(9, 40), source: "manual" }, malen);
  assert.equal(rettet.needsConfirmation, false);
});

test("en alarm er et presist signal og trenger ingen bekreftelse", () => {
  const alarmen = describeWake({ wokeAt: tid(9, 40), source: "shortcut" }, malen);
  assert.equal(alarmen.needsConfirmation, false);
  assert.match(alarmen.text, /09:40/);
});

test("sto Ole opp til normal tid, sies det uten å nevne skyving", () => {
  const presis = describeWake({ wokeAt: tid(7, 0), source: "shortcut" }, malen);
  assert.doesNotMatch(presis.text, /skjøvet/);
});
```

- [ ] **Step 2: Kjør testen og se at den faller**

```bash
cd ipad-control-center && node --test tests/dashboard.test.mjs 2>&1 | tail -20
```

Forventet: FAIL — `describeWake is not a function`.

- [ ] **Step 3: Skriv funksjonen**

Legg til i `src/dashboard.js`, rett etter `planDay`:

```js
// Et gjett skal se ut som et gjett. En alarm Ole selv slo av, og en rettelse han
// selv skrev, er derimot fakta og skal ikke mase om bekreftelse.
export function describeWake(wake, template) {
  if (!wake?.wokeAt || !wake?.source) return null;
  const woke = new Date(wake.wokeAt);
  if (!Number.isFinite(+woke)) return null;
  const klokke = `${String(woke.getHours()).padStart(2, "0")}:${String(woke.getMinutes()).padStart(2, "0")}`;
  const anchorMinute = clockMinutes(template?.wakeAnchor);
  const shift = anchorMinute === null ? 0 : Math.max(0, woke.getHours() * 60 + woke.getMinutes() - anchorMinute);
  const skjøvet = shift > 0 ? ` Dagen er skjøvet ${formatMinutes(shift)}.` : "";
  if (wake.source === "usage") {
    return { text: `Regnet med at du sto opp ${klokke}.${skjøvet}`, tone: "amber", needsConfirmation: true };
  }
  if (wake.source === "shortcut") {
    return { text: `Du sto opp ${klokke}.${skjøvet}`, tone: "sky", needsConfirmation: false };
  }
  return { text: `Du sto opp ${klokke}.${skjøvet}`, tone: "emerald", needsConfirmation: false };
}
```

`formatMinutes` finnes allerede i fila og brukes av bruksrapportene. Sjekk hva den gir for `160` før du stoler på formuleringen, og juster teksten om den leser rart.

- [ ] **Step 4: Kjør testen og se at den går**

```bash
cd ipad-control-center && npm test
```

Forventet: alle passerer.

- [ ] **Step 5: Skriv stripa og lista**

Legg til i `src/App.jsx`, ved siden av `CurrentEventCard`:

```jsx
function WakeBanner({ wake, template, onCorrect }) {
  const described = useMemo(() => describeWake(wake, template), [wake, template]);
  const [draft, setDraft] = useState("");
  if (!described) return null;
  return (
    <div className={`wake-banner tone-${described.tone}`} role="status">
      <span>{described.text}</span>
      {described.needsConfirmation && (
        <span className="wake-correct">
          <label htmlFor="wake-time">Ikke riktig?</label>
          <input id="wake-time" type="time" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="button" disabled={!draft} onClick={() => { onCorrect(draft); setDraft(""); }}>Rett</button>
        </span>
      )}
    </div>
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
```

- [ ] **Step 6: Skriv rettelsen**

Ved siden av `markDone` fra Task 4:

```jsx
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
```

Sett `DroppedList` inn under kalenderen der dagsvisningen tegnes:

```jsx
<DroppedList dropped={plannedDay?.dropped} />
```

Stripa settes inn i steg 8, når den har fått sin siste prop.

Legg `describeWake` til i `import`-lista fra `./dashboard.js`.

- [ ] **Step 7: Gi stripa og lista form**

Legg til i `src/styles.css`:

```css
.wake-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.wake-correct {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dropped-list ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dropped-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  opacity: 0.75;
}
```

- [ ] **Step 8: Si fra når ankrene mangler**

En plan uten ankre er verre enn ingen plan hvis den presenteres som fullstendig.
Er Apple Kalender nede, er `anchors` tom, og bolkene legger seg like glatt over
en forelesning som ingen vet om. Utvid `WakeBanner` med en linje til:

```jsx
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
```

Send `syncCalendar.connected` inn der stripa settes:

```jsx
<WakeBanner wake={dayPlan.wake} template={dayPlan.template} calendarConnected={syncCalendar.connected} onCorrect={correctWake} />
```

- [ ] **Step 9: Se på det**

```bash
curl -s -X POST localhost:4173/api/day-plan -H 'Content-Type: application/json' -d "{\"kind\":\"wake\",\"source\":\"usage\",\"wokeAt\":\"$(date -u -v-2H +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Forventet: stripa dukker opp i gul tone med «Regnet med at du sto opp …» og et felt for å rette. Retter du tidspunktet, bytter stripa til grønn og slutter å spørre. Bolker som ikke får plass står i lista under dagen.

- [ ] **Step 10: Commit**

```bash
git add ipad-control-center/src/App.jsx ipad-control-center/src/dashboard.js ipad-control-center/src/styles.css ipad-control-center/tests/dashboard.test.mjs
git commit -m "Show the guess as a guess, and say what fell out of the day"
```

---

### Task 6: Telefonen melder fra

To signaler inn til `/api/day-plan`. Snarveien treffer riktig minutt, companion-appen krever ingenting av Ole.

`project.yml` globber hele `Sources`-katalogen, så en ny Swift-fil plukkes opp uten endringer i prosjektfila. `NSAllowsLocalNetworking` er allerede satt, og `.local`-adressen er derfor nåbar.

**Files:**
- Create: `ipad-control-center/ios-companion/Sources/WakeDetector.swift`
- Modify: `ipad-control-center/ios-companion/Sources/PanelCompanionApp.swift` (`scenePhase`-hooken, rundt linje 30)
- Modify: `ipad-control-center/README.md`

**Interfaces:**
- Consumes: `POST /api/day-plan` fra Task 3, `UserDefaults`-nøkkelen `panelEndpoint` som `MetricsSyncModel.upload(...)` allerede skriver.
- Produces: `WakeDetector.shared.noteActivity()` — kalles når appen blir aktiv. `WakeDetector.shared.flushPending()` — prøver et lagret tidspunkt på nytt.

- [ ] **Step 1: Skriv detektoren**

Opprett `ios-companion/Sources/WakeDetector.swift`:

```swift
import Foundation

// Mac-en sover om morgenen, og det er nettopp da signalet oppstår. Tidspunktet
// skrives derfor til disk med én gang og sendes på nytt ved hver senere
// anledning, til panelet tar imot det. Planen er en ren funksjon av
// oppvåkningstidspunktet, så et signal som kommer fram tre timer for sent gir
// nøyaktig samme dag som ett som kom fram med det samme.
@MainActor
final class WakeDetector {
    static let shared = WakeDetector()

    private let defaults = UserDefaults.standard
    private let lastActiveKey = "wakeLastActiveAt"
    private let reportedDayKey = "wakeReportedDay"
    private let pendingKey = "wakePendingAt"

    // Fire timer stille er ikke en pause, det er en natt. Vinduet 04–13 holder
    // en lang ettermiddagslur utenfor.
    private let quietGap: TimeInterval = 4 * 60 * 60
    private let window = 4...13

    private init() {}

    func noteActivity(now: Date = .now) {
        defer { defaults.set(now, forKey: lastActiveKey) }
        guard let candidate = detect(now: now) else { return }
        defaults.set(dayKey(candidate), forKey: reportedDayKey)
        defaults.set(candidate, forKey: pendingKey)
        Task { await flushPending() }
    }

    func detect(now: Date = .now) -> Date? {
        let hour = Calendar.current.component(.hour, from: now)
        guard window.contains(hour) else { return nil }
        guard defaults.string(forKey: reportedDayKey) != dayKey(now) else { return nil }
        guard let lastActive = defaults.object(forKey: lastActiveKey) as? Date else { return nil }
        guard now.timeIntervalSince(lastActive) >= quietGap else { return nil }
        return now
    }

    func flushPending() async {
        guard let pending = defaults.object(forKey: pendingKey) as? Date else { return }
        // Et tidspunkt fra i går avvises av panelet uansett. Da er det bedre å
        // kaste det her enn å prøve det hver gang appen åpnes resten av uka.
        guard Calendar.current.isDateInToday(pending) else {
            defaults.removeObject(forKey: pendingKey)
            return
        }
        guard let endpoint = defaults.string(forKey: "panelEndpoint"),
              let url = URL(string: endpoint),
              let base = url.host.map({ _ in url }) else { return }
        var request = URLRequest(url: base.deletingLastPathComponent().appendingPathComponent("day-plan"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 8
        let formatter = ISO8601DateFormatter()
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "kind": "wake",
            "source": "usage",
            "wokeAt": formatter.string(from: pending),
        ])
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
        defaults.removeObject(forKey: pendingKey)
    }

    private func dayKey(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year ?? 0)-\(parts.month ?? 0)-\(parts.day ?? 0)"
    }
}
```

`panelEndpoint` står som `http://Ole-sin-MacBook-Air.local:4173/api/device-metrics`
(`MetricsSyncModel.swift:34`), så `deletingLastPathComponent()` gir `/api/` og
`appendingPathComponent("day-plan")` lander riktig.

- [ ] **Step 2: Koble den til der appen blir aktiv**

I `ios-companion/Sources/PanelCompanionApp.swift`, utvid `onChange(of: scenePhase)`:

```swift
                .onChange(of: scenePhase) { _, newPhase in
                    guard newPhase == .active else { return }
                    WakeDetector.shared.noteActivity()
                    Task { await syncModel.refreshAll(requestPermissions: false) }
                }
```

Og i `.backgroundTask`-blokka, rett før `refreshAll`:

```swift
            await WakeDetector.shared.flushPending()
```

- [ ] **Step 3: Bygg appen**

```bash
cd ipad-control-center/ios-companion && xcodebuild -project PanelCompanion.xcodeproj -scheme PanelCompanion -destination 'generic/platform=iOS' build 2>&1 | tail -20
```

Forventet: `BUILD SUCCEEDED`. Feiler signeringen, er det ikke denne endringen — kjør `./install-on-iphone.sh` slik det allerede gjøres.

- [ ] **Step 4: Skriv ned snarveien**

Legg til i `ipad-control-center/README.md`, etter avsnittet om companion-appen:

```markdown
## Oppvåkning

Panelet legger dagsmalen i `~/Library/Application Support/ipad-control-center/day-plan.json`
ut fra klokkeslettet Ole faktisk sto opp. To kilder melder fra om det.

Companion-appen gjør det av seg selv: første gang appen blir aktiv etter mer enn
fire timer stille, i vinduet 04–13, sender den tidspunktet som et gjett. Panelet
viser det som et gjett og lar det rettes med ett trykk.

Snarveien treffer riktig minutt og er den som bør brukes. Den settes opp én gang
i Snarveier på iPhone:

1. **Automasjon → Ny → Vekking** (eventuelt **Alarm → Stoppes**).
2. Slå på **Kjør umiddelbart** og slå av **Spør før kjøring**. Uten dette må
   varselet trykkes bort, og da er signalet verdiløst på en morgen.
3. Handling: **Hent innhold fra URL**.
   - URL: `http://Ole-sin-MacBook-Air.local:4173/api/day-plan`
   - Metode: `POST`, forespørselstekst `JSON`
   - `kind` (tekst): `wake`
   - `source` (tekst): `shortcut`
   - `wokeAt` (tekst): variabelen **Gjeldende dato**, formatert som ISO 8601

Sover Mac-en når alarmen går, feiler snarveien i stillhet. Da tar companion-appen
det samme signalet senere på morgenen, ett gjett i stedet for et presist tall.
```

- [ ] **Step 5: Prøv snarveien for hånd**

```bash
curl -s -X POST http://localhost:4173/api/day-plan -H 'Content-Type: application/json' -d "{\"kind\":\"wake\",\"source\":\"shortcut\",\"wokeAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Forventet: `{"wake":{"date":"...","wokeAt":"...","source":"shortcut","confirmed":false,...}}`, og stripa i panelet bytter til «Du sto opp …» uten spørsmål om bekreftelse.

- [ ] **Step 6: Se at en rettelse ikke blir overkjørt**

```bash
curl -s -X POST localhost:4173/api/day-plan -H 'Content-Type: application/json' -d "{\"kind\":\"wake\",\"source\":\"manual\",\"wokeAt\":\"$(date -u -v-3H +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null
curl -s -X POST localhost:4173/api/day-plan -H 'Content-Type: application/json' -d "{\"kind\":\"wake\",\"source\":\"usage\",\"wokeAt\":\"$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Forventet: det andre kallet svarer med `"source":"manual"` og det første tidspunktet. Gjettet taper mot mennesket.

- [ ] **Step 7: Kjør hele testsuiten**

```bash
cd ipad-control-center && npm test
```

Forventet: alt grønt.

- [ ] **Step 8: Commit**

```bash
git add ipad-control-center/ios-companion ipad-control-center/README.md
git commit -m "Let the phone say when the day started, twice over"
```

---

## Etterpå

Det som bevisst ikke er med, og hvorfor:

- **Ingen editor for malen.** `day-plan.json` skrives for hånd. En bolkeditor på
  iPad-flata er større arbeid enn skyvingen, og skyvingen var det Ole ba om.
  Formen på malen bør få stå en uke eller to før den låses i et grensesnitt.
- **Ingen plan utenfor Mac-en.** `pmset` melder `sleep 1` og `womp 0`. Ligger Ole
  i senga, når han ikke panelet før Mac-en er oppe. Oppvåkningen går ikke tapt,
  men planen er ikke synlig. Å fikse det krever at planen bor et annet sted, og
  det er et eget prosjekt med sin egen spec.
- **Ingen skriving til Apple Kalender.** Se spec-en.
