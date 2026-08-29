# Søvnrytme og alarmer — implementasjonsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panelet regner ut leggetid og oppvåkningstid fra Oles egne netter, og telefonen setter fem alarmer av det.

**Architecture:** Rytmen er én ren funksjon i `src/dashboard.js`, som `planDay`. Nettene lagres ved siden av dagsmalen fordi de ikke kan utledes på nytt. `WakeDetector` sender begge endene av natta i det samme kallet den allerede gjør. Alarmene settes av companion gjennom AlarmKit.

**Tech Stack:** Node 20+ ESM, Vite 7, React 19, `node --test`, Swift 6 / SwiftUI, AlarmKit (iOS 26+).

## Global Constraints

- Norsk brukertekst, feilmeldinger inkludert.
- Ingen nye avhengigheter.
- `sleepAt` er «la fra seg telefonen», ikke «sovnet». Flaten skal aldri påstå det siste.
- Under tre netter settes ingen alarmer og vises ingen tall.
- Nettene ligger i `~/Library/Application Support/ipad-control-center/sleep-history.json`, filmodus `0o600`.
- En ny fil i `ios-companion/Sources` krever `xcodegen generate` før den er med i prosjektet.
- `npm test` fra `ipad-control-center/`. Nye testfiler må inn i `test`-skriptet i `package.json`.

---

### Task 1: `describeSleepRhythm` og `alarmTimes`

**Files:**
- Modify: `ipad-control-center/src/dashboard.js`
- Test: `ipad-control-center/tests/dashboard.test.mjs`

**Interfaces:**
- Produces:
  - `describeSleepRhythm({ nights, wakeAnchor, previousTarget, now }) -> { learning, nightCount, sleepNeed, targetWake, targetBedtime }` — `sleepNeed` i minutter, `targetWake`/`targetBedtime` som `"HH:MM"`. Ved `learning: true` er de tre siste `null`.
  - `alarmTimes({ targetBedtime, targetWake }) -> [{ id, at, label }]` — `at` som `"HH:MM"`, fem stykker i kronologisk rekkefølge fra leggetid.

- [ ] **Step 1: Skriv de fallende testene**

Legg `describeSleepRhythm` og `alarmTimes` inn i `import`-lista, og legg til:

```js
function natt(dato, leggMin, våknMin) {
  const base = new Date(2026, 7, dato);
  return {
    date: `2026-08-${String(dato).padStart(2, "0")}`,
    sleepAt: leggMin === null ? null : new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1, 0, leggMin).toISOString(),
    wokeAt: new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, våknMin).toISOString(),
  };
}

// 23:00 kvelden før til 07:00 = 8 timer.
const netter = [natt(20, 23 * 60, 7 * 60), natt(21, 23 * 60, 7 * 60), natt(22, 23 * 60, 7 * 60)];

test("under tre netter er det ingen rytme å melde", () => {
  const svar = describeSleepRhythm({ nights: netter.slice(0, 2), wakeAnchor: "07:00" });
  assert.equal(svar.learning, true);
  assert.equal(svar.nightCount, 2);
  assert.equal(svar.targetWake, null);
  assert.equal(svar.sleepNeed, null);
});

test("søvnbehovet er medianen, så én skjev natt ikke drar tallet", () => {
  const skjevt = [...netter, natt(23, 20 * 60, 14 * 60)];
  const svar = describeSleepRhythm({ nights: skjevt, wakeAnchor: "07:00" });
  assert.equal(svar.learning, false);
  assert.equal(svar.sleepNeed, 480);
});

test("søvnbehovet klemmes i begge ender", () => {
  const kort = [natt(20, 3 * 60, 7 * 60), natt(21, 3 * 60, 7 * 60), natt(22, 3 * 60, 7 * 60)];
  assert.equal(describeSleepRhythm({ nights: kort, wakeAnchor: "07:00" }).sleepNeed, 360);
  const langt = [natt(20, 18 * 60, 10 * 60), natt(21, 18 * 60, 10 * 60), natt(22, 18 * 60, 10 * 60)];
  assert.equal(describeSleepRhythm({ nights: langt, wakeAnchor: "07:00" }).sleepNeed, 570);
});

test("uten et forrige mål starter målet der Ole faktisk er", () => {
  const sent = [natt(20, 24 * 60, 9 * 60), natt(21, 24 * 60, 9 * 60), natt(22, 24 * 60, 9 * 60)];
  assert.equal(describeSleepRhythm({ nights: sent, wakeAnchor: "07:00" }).targetWake, "09:00");
});

test("målet flytter seg høyst et kvarter om dagen mot ankeret", () => {
  const sent = [natt(20, 24 * 60, 9 * 60), natt(21, 24 * 60, 9 * 60), natt(22, 24 * 60, 9 * 60)];
  const svar = describeSleepRhythm({ nights: sent, wakeAnchor: "07:00", previousTarget: "09:00" });
  assert.equal(svar.targetWake, "08:45");
});

test("målet står stille når det allerede er på ankeret", () => {
  const svar = describeSleepRhythm({ nights: netter, wakeAnchor: "07:00", previousTarget: "07:00" });
  assert.equal(svar.targetWake, "07:00");
});

test("målet hopper ikke forbi ankeret på vei mot det", () => {
  const svar = describeSleepRhythm({ nights: netter, wakeAnchor: "07:00", previousTarget: "07:10" });
  assert.equal(svar.targetWake, "07:00");
});

test("leggetiden er målet minus søvnbehovet minus kvarteret det tar å sovne", () => {
  const svar = describeSleepRhythm({ nights: netter, wakeAnchor: "07:00", previousTarget: "07:00" });
  assert.equal(svar.sleepNeed, 480);
  assert.equal(svar.targetBedtime, "22:45");
});

test("en natt uten leggetid teller ikke i medianen, men natta er der", () => {
  const hull = [...netter, natt(23, null, 7 * 60)];
  const svar = describeSleepRhythm({ nights: hull, wakeAnchor: "07:00" });
  assert.equal(svar.nightCount, 4);
  assert.equal(svar.sleepNeed, 480);
});

test("fem alarmer, i rekkefølge, med riktige avstander", () => {
  const alarmer = alarmTimes({ targetBedtime: "22:45", targetWake: "07:00" });
  assert.deepEqual(alarmer.map((a) => [a.id, a.at]), [
    ["avrunding", "22:15"],
    ["leggetid", "22:45"],
    ["snart-opp", "06:55"],
    ["stå-opp", "07:00"],
    ["opp-naa", "07:05"],
  ]);
  assert.ok(alarmer.every((a) => typeof a.label === "string" && a.label.length > 0));
});

test("alarmene tåler at leggetiden krysser midnatt", () => {
  const alarmer = alarmTimes({ targetBedtime: "00:10", targetWake: "08:00" });
  assert.equal(alarmer[0].at, "23:40");
  assert.equal(alarmer[1].at, "00:10");
});
```

- [ ] **Step 2: Kjør og se at de faller**

```bash
cd ipad-control-center && node --test tests/dashboard.test.mjs 2>&1 | grep -c "not ok"
```

Forventet: feiler med at `describeSleepRhythm` ikke er eksportert.

- [ ] **Step 3: Skriv funksjonene**

Legg til nederst i `src/dashboard.js`:

```js
const MIN_NIGHTS = 3;
const MIN_SLEEP = 6 * 60;
const MAX_SLEEP = 9 * 60 + 30;
const FALL_ASLEEP = 15;
const MAX_DRIFT = 15;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function clockText(minute) {
  const wrapped = ((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

// Rytmen bygger på Oles egne netter. Den påstår ingenting om hva som er sunt,
// bare hva han faktisk pleier å gjøre — og trekker det sakte mot tidspunktet
// han selv har skrevet i dagsmalen.
export function describeSleepRhythm({ nights = [], wakeAnchor = null, previousTarget = null } = {}) {
  const usable = (Array.isArray(nights) ? nights : []).filter((night) => {
    const woke = new Date(night?.wokeAt ?? "");
    return Number.isFinite(+woke);
  });
  if (usable.length < MIN_NIGHTS) {
    return { learning: true, nightCount: usable.length, sleepNeed: null, targetWake: null, targetBedtime: null };
  }

  // En natt uten leggetid er fortsatt en natt. Oppvåkningen er sann selv om
  // den andre enden mangler, så den teller i medianen for oppvåkning og ikke
  // i den for lengde.
  const durations = usable.flatMap((night) => {
    const slept = new Date(night?.sleepAt ?? "");
    const woke = new Date(night.wokeAt);
    if (!Number.isFinite(+slept) || +woke <= +slept) return [];
    return [(+woke - +slept) / 60_000];
  });
  const wakeMinutes = usable.map((night) => {
    const woke = new Date(night.wokeAt);
    return woke.getHours() * 60 + woke.getMinutes();
  });

  const sleepNeed = Math.min(MAX_SLEEP, Math.max(MIN_SLEEP, median(durations) ?? MIN_SLEEP));
  const anchorMinute = clockMinutes(wakeAnchor);
  const previousMinute = clockMinutes(previousTarget);
  const start = previousMinute ?? median(wakeMinutes);

  // Uten anker er det ingenting å trekke mot, og målet blir stående der Ole er.
  let targetMinute = start;
  if (anchorMinute !== null && previousMinute !== null) {
    const gap = anchorMinute - previousMinute;
    targetMinute = previousMinute + Math.sign(gap) * Math.min(Math.abs(gap), MAX_DRIFT);
  }

  return {
    learning: false,
    nightCount: usable.length,
    sleepNeed,
    targetWake: clockText(targetMinute),
    targetBedtime: clockText(targetMinute - sleepNeed - FALL_ASLEEP),
  };
}

export function alarmTimes({ targetBedtime = null, targetWake = null } = {}) {
  const bed = clockMinutes(targetBedtime);
  const wake = clockMinutes(targetWake);
  if (bed === null || wake === null) return [];
  return [
    { id: "avrunding", at: clockText(bed - 30), label: "Begynn å runde av" },
    { id: "leggetid", at: clockText(bed), label: "Legg deg nå" },
    { id: "snart-opp", at: clockText(wake - 5), label: "Snart opp" },
    { id: "stå-opp", at: clockText(wake), label: "Stå opp" },
    { id: "opp-naa", at: clockText(wake + 5), label: "Opp nå" },
  ];
}
```

- [ ] **Step 4: Kjør og se at de går**

```bash
cd ipad-control-center && npm test
```

- [ ] **Step 5: Commit**

```bash
git add ipad-control-center/src/dashboard.js ipad-control-center/tests/dashboard.test.mjs
git commit -m "Work the rhythm out of Ole's own nights"
```

---

### Task 2: Nettene lagres, og `sleepAt` tas imot

**Files:**
- Modify: `ipad-control-center/server/day-plan-service.mjs`
- Modify: `ipad-control-center/tests/day-plan.test.mjs`

**Interfaces:**
- Consumes: `normalizeWake` fra dagsplan-tjenesten.
- Produces:
  - `normalizeWake` godtar nå et valgfritt `sleepAt`, og returnerer det som ISO eller `null`.
  - `readSleepHistory() -> Promise<{ version, targetWake, nights }>`
  - `recordNight({ date, sleepAt, wokeAt }) -> Promise<historikk>` — én oppføring per dato, de siste 60.
  - `saveTargetWake(value) -> Promise<historikk>`
  - `getDayPlan(now)` returnerer i tillegg `history`.

- [ ] **Step 1: Skriv de fallende testene**

```js
test("en oppvåkning kan ha med når telefonen ble lagt fra seg", () => {
  const wake = normalizeWake({
    wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(),
    sleepAt: new Date(2026, 7, 27, 23, 30).toISOString(),
    source: "usage",
  }, naa);
  assert.equal(new Date(wake.sleepAt).getHours(), 23);
});

test("en leggetid som ikke er en tid blir bare borte, oppvåkningen står", () => {
  const wake = normalizeWake({ wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(), sleepAt: "i går", source: "usage" }, naa);
  assert.equal(wake.sleepAt, null);
  assert.ok(wake.wokeAt);
});

test("en leggetid etter oppvåkningen er ikke en leggetid", () => {
  const wake = normalizeWake({
    wokeAt: new Date(2026, 7, 28, 9, 40).toISOString(),
    sleepAt: new Date(2026, 7, 28, 10, 0).toISOString(),
    source: "usage",
  }, naa);
  assert.equal(wake.sleepAt, null);
});
```

- [ ] **Step 2: Kjør og se at de faller**

```bash
cd ipad-control-center && node --test tests/day-plan.test.mjs 2>&1 | grep -c "not ok"
```

- [ ] **Step 3: Utvid `normalizeWake` og legg til historikken**

I `server/day-plan-service.mjs`, rett etter `WAKE_FILE`:

```js
const HISTORY_FILE = join(homedir(), "Library", "Application Support", "ipad-control-center", "sleep-history.json");
const MAX_NIGHTS = 60;
```

Utvid `normalizeWake` slik at den, rett før `return`, regner ut leggetiden:

```js
  // Leggetiden er et tillegg, ikke et krav. En natt der den mangler er fortsatt
  // en natt, og oppvåkningen skal ikke avvises fordi den andre enden er borte.
  const slept = new Date(input?.sleepAt ?? "");
  const sleepAt = Number.isFinite(+slept) && +slept < +wokeAt ? slept.toISOString() : null;
  return { wokeAt: wokeAt.toISOString(), source: input.source, sleepAt };
```

Og legg til nederst i fila:

```js
export async function readSleepHistory() {
  const stored = await readJsonFile(HISTORY_FILE);
  return {
    version: 1,
    targetWake: clockText(stored?.targetWake) ?? null,
    nights: Array.isArray(stored?.nights) ? stored.nights.slice(-MAX_NIGHTS) : [],
  };
}

export async function recordNight(input) {
  const date = shortText(input?.date, 10);
  const woke = new Date(input?.wokeAt ?? "");
  if (!date || !Number.isFinite(+woke)) throw new Error("Ugyldig natt");
  const slept = new Date(input?.sleepAt ?? "");
  const night = {
    date,
    wokeAt: woke.toISOString(),
    sleepAt: Number.isFinite(+slept) && +slept < +woke ? slept.toISOString() : null,
  };
  const history = await readSleepHistory();
  // Én oppføring per dato. Retter Ole oppvåkningen sin, skal natta oppdateres
  // og ikke legges til en gang til.
  const nights = [...history.nights.filter((entry) => entry?.date !== date), night]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-MAX_NIGHTS);
  const next = { ...history, nights };
  await writeJsonFile(HISTORY_FILE, next);
  return next;
}

export async function saveTargetWake(value) {
  const targetWake = clockText(value);
  if (!targetWake) throw new Error("Ugyldig klokkeslett");
  const history = await readSleepHistory();
  const next = { ...history, targetWake };
  await writeJsonFile(HISTORY_FILE, next);
  return next;
}
```

Kall `recordNight` fra `recordWake`, rett før `return next`:

```js
  await recordNight({ date: next.date, wokeAt: next.wokeAt, sleepAt: next.sleepAt ?? null });
```

Ta `sleepAt` med i `next` i `recordWake`, og i `emptyWake` som `null`. La `getDayPlan` returnere historikken:

```js
export async function getDayPlan(now = new Date()) {
  const [template, wake, history] = await Promise.all([readDayPlanTemplate(), readWake(now), readSleepHistory()]);
  return { template, wake, history, connected: template !== null };
}
```

- [ ] **Step 4: Kjør testene**

```bash
cd ipad-control-center && npm test
```

- [ ] **Step 5: Commit**

```bash
git add ipad-control-center/server/day-plan-service.mjs ipad-control-center/tests/day-plan.test.mjs
git commit -m "Keep both ends of the night, and let one end be missing"
```

---

### Task 3: Rytmekortet i panelet

**Files:**
- Modify: `ipad-control-center/src/App.jsx`
- Modify: `ipad-control-center/src/styles.css`

**Interfaces:**
- Consumes: `describeSleepRhythm`, `alarmTimes` fra Task 1; `dayPlan.history` fra Task 2.
- Produces: `SleepRhythmCard` — vises bare når det finnes en dagsmal.

- [ ] **Step 1: Regn ut rytmen ved siden av dagsplanen**

```jsx
  const rhythm = useMemo(() => describeSleepRhythm({
    nights: dayPlan.history?.nights ?? [],
    wakeAnchor: dayPlan.template?.wakeAnchor ?? null,
    previousTarget: dayPlan.history?.targetWake ?? null,
  }), [dayPlan.history, dayPlan.template]);
```

- [ ] **Step 2: Skriv kortet**

Tallet skal alltid stå som et anslag. `sleepAt` er når telefonen ble lagt fra
seg, ikke når Ole sovnet, og kortet skal ikke la det se ut som en måling.

```jsx
function SleepRhythmCard({ rhythm }) {
  if (!rhythm) return null;
  if (rhythm.learning) {
    return (
      <section className="panel-card sleep-card is-learning" aria-label="Søvnrytme">
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
      <small>{`${formatMinutes(rhythm.sleepNeed)} søvn, anslått fra ${rhythm.nightCount} netter`}</small>
    </section>
  );
}
```

- [ ] **Step 3: Sett kortet inn under `DroppedList`**

```jsx
{view === "day" && dayPlan.connected && <SleepRhythmCard rhythm={rhythm} />}
```

- [ ] **Step 4: Gi kortet form**

```css
.sleep-card { margin-top: 8px; padding: 10px 12px; }
.sleep-times { display: flex; gap: 18px; margin: 6px 0 4px; }
.sleep-times span { display: flex; flex-direction: column; gap: 1px; }
.sleep-times em { color: var(--muted); font-size: 11px; font-style: normal; }
.sleep-times strong { font-size: 17px; font-variant-numeric: tabular-nums; }
.sleep-card small, .sleep-card p { color: var(--muted); font-size: 11px; }
.sleep-card p { margin: 4px 0 0; }
```

- [ ] **Step 5: Se på det**

Start panelet, legg tre netter i `sleep-history.json` for hånd, og se at kortet
går fra «Lærer fortsatt» til to klokkeslett.

- [ ] **Step 6: Commit**

```bash
git add ipad-control-center/src/App.jsx ipad-control-center/src/styles.css
git commit -m "Say the bedtime as the estimate it is"
```

---

### Task 4: Companion sender begge endene av natta

**Files:**
- Modify: `ipad-control-center/ios-companion/Sources/WakeDetector.swift`

**Interfaces:**
- Produces: kroppen til `POST /api/day-plan` får med `sleepAt`.

- [ ] **Step 1: Ta vare på leggetiden når oppvåkningen oppdages**

`lastActive` er allerede lest i `detect`. Den samme verdien er den siste
aktiviteten før stillheten, altså omtrent da telefonen ble lagt fra seg. Lagre
den ved siden av `pendingKey`:

```swift
    private let pendingSleepKey = "wakePendingSleepAt"
```

I `noteActivity`, rett etter at `pendingKey` settes:

```swift
        if let lastActive = defaults.object(forKey: lastActiveKey) as? Date {
            defaults.set(lastActive, forKey: pendingSleepKey)
        }
```

I `flushPending`, ta den med i kroppen:

```swift
        var body: [String: Any] = [
            "kind": "wake",
            "source": "usage",
            "wokeAt": formatter.string(from: pending),
        ]
        if let slept = defaults.object(forKey: pendingSleepKey) as? Date {
            body["sleepAt"] = formatter.string(from: slept)
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
```

Og rydd den bort sammen med `pendingKey` når kallet gikk gjennom:

```swift
        defaults.removeObject(forKey: pendingKey)
        defaults.removeObject(forKey: pendingSleepKey)
```

- [ ] **Step 2: Bygg**

```bash
cd ipad-control-center/ios-companion && xcodebuild -project PanelCompanion.xcodeproj -scheme PanelCompanion -destination 'generic/platform=iOS' build 2>&1 | grep -E "error:|BUILD"
```

- [ ] **Step 3: Commit**

```bash
git add ipad-control-center/ios-companion
git commit -m "Send both ends of the night, not just the morning"
```

---

### Task 5: Fem alarmer gjennom AlarmKit

AlarmKit finnes fra iOS 26 og er tilgjengelig på Oles 26.4. Alarmene lever i
Panelkobling, ikke i Klokke, og bryter gjennom stillemodus og Fokus.

**Files:**
- Create: `ipad-control-center/ios-companion/Sources/SleepAlarms.swift`
- Modify: `ipad-control-center/ios-companion/project.yml` (`NSAlarmKitUsageDescription`)
- Modify: `ipad-control-center/ios-companion/Sources/PanelCompanionApp.swift`
- Modify: `ipad-control-center/ios-companion/Sources/SyncView.swift` (tillatelse og status)

**Interfaces:**
- Consumes: `/api/day-plan`, feltet `history` og malens `wakeAnchor`.
- Produces: `SleepAlarms.shared.refresh()` — henter rytmen, husker den, og setter de fem alarmene.

- [ ] **Step 1: Legg tillatelsesteksten i prosjektfila**

Under `info.properties` i `project.yml`:

```yaml
        NSAlarmKitUsageDescription: Panelkobling setter alarmene for leggetid og oppvåkning fra din egen døgnrytme.
```

Kjør så `xcodegen generate`.

- [ ] **Step 2: Skriv alarmtjenesten**

Rytmen regnes ut på Mac-en, men alarmene må kunne settes når Mac-en sover.
Derfor huskes den siste rytmen companion fikk. Målet flytter seg høyst et
kvarter om dagen, så en rytme fra i går er fortsatt riktig nok til å vekke på.

```swift
import AlarmKit
import Foundation
import SwiftUI

struct SleepAlarmMetadata: AlarmMetadata {
    let label: String
}

@MainActor
final class SleepAlarms {
    static let shared = SleepAlarms()

    private let defaults = UserDefaults.standard
    private let cachedKey = "sleepAlarmTimes"
    private let scheduledKey = "sleepAlarmIds"
    private let manager = AlarmManager.shared

    private init() {}

    func authorize() async -> Bool {
        do {
            return try await manager.requestAuthorization() == .authorized
        } catch {
            return false
        }
    }

    func refresh() async {
        if let fetched = await fetchTimes() {
            defaults.set(fetched, forKey: cachedKey)
        }
        guard let times = defaults.array(forKey: cachedKey) as? [[String: String]], !times.isEmpty else { return }
        await cancelScheduled()
        var ids: [String] = []
        for entry in times {
            guard let at = entry["at"], let label = entry["label"], let fireDate = nextDate(for: at) else { continue }
            let id = UUID()
            let presentation = AlarmPresentation(alert: .init(
                title: LocalizedStringResource(stringLiteral: label),
                stopButton: .stopButton
            ))
            let attributes = AlarmAttributes(
                presentation: presentation,
                metadata: SleepAlarmMetadata(label: label),
                tintColor: Color.orange
            )
            let configuration = AlarmManager.AlarmConfiguration.alarm(
                schedule: .fixed(fireDate),
                attributes: attributes
            )
            if (try? await manager.schedule(id: id, configuration: configuration)) != nil {
                ids.append(id.uuidString)
            }
        }
        defaults.set(ids, forKey: scheduledKey)
    }

    // Alarmene settes på nytt hver dag, så gårsdagens må bort først. Uten dette
    // ville de hope seg opp, én per døgn, til telefonen ringte fem ganger om
    // gangen.
    private func cancelScheduled() async {
        guard let ids = defaults.stringArray(forKey: scheduledKey) else { return }
        for value in ids {
            if let id = UUID(uuidString: value) { try? manager.cancel(id: id) }
        }
        defaults.removeObject(forKey: scheduledKey)
    }

    private func nextDate(for clock: String) -> Date? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        var components = DateComponents()
        components.hour = parts[0]
        components.minute = parts[1]
        return Calendar.current.nextDate(after: .now, matching: components, matchingPolicy: .nextTime)
    }

    private func fetchTimes() async -> [[String: String]]? {
        guard let url = WakeDetector.shared.dayPlanURL() else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let alarms = payload["alarms"] as? [[String: String]] else { return nil }
        return alarms
    }
}
```

- [ ] **Step 3: La endepunktet svare med alarmtidene**

Panelet eier utregningen, og telefonen skal ikke ha en egen kopi av reglene. I
`server/day-plan-service.mjs` kan ikke `dashboard.js` importeres, så `getDayPlan`
utvides i `vite.config.mjs` i stedet — der begge er tilgjengelige:

```js
import { alarmTimes, describeSleepRhythm } from "./src/dashboard.js";
```

I `dayPlanApi`, bytt GET-grenen med:

```js
          if (request.method === "GET") {
            const plan = await getDayPlan(new Date());
            const rhythm = describeSleepRhythm({
              nights: plan.history?.nights ?? [],
              wakeAnchor: plan.template?.wakeAnchor ?? null,
              previousTarget: plan.history?.targetWake ?? null,
            });
            const alarms = rhythm.learning ? [] : alarmTimes(rhythm);
            // Målet lagres når det har flyttet seg, slik at rampen på et kvarter
            // per dag husker hvor den var i går.
            if (!rhythm.learning && rhythm.targetWake !== plan.history?.targetWake) {
              await saveTargetWake(rhythm.targetWake);
            }
            sendJson(response, 200, { ...plan, rhythm, alarms });
            return;
          }
```

Legg `saveTargetWake` til i importen fra `day-plan-service.mjs`.

- [ ] **Step 4: Koble alarmene til appens livssyklus**

I `PanelCompanionApp.swift`, i `.backgroundTask`, etter `flushPending`:

```swift
            await SleepAlarms.shared.refresh()
```

Og i `.onChange(of: scenePhase)`:

```swift
                    Task { await SleepAlarms.shared.refresh() }
```

- [ ] **Step 5: Be om tillatelse i grensesnittet**

En alarm som stille lot være å bli satt er det verste utfallet. Legg en rad i
`SyncView` som ber om AlarmKit-tillatelse og viser status, ved siden av de
eksisterende tillatelsesradene. Følg formen som allerede er der for skritt og
posisjon.

- [ ] **Step 6: Bygg**

```bash
cd ipad-control-center/ios-companion && xcodegen generate && xcodebuild -project PanelCompanion.xcodeproj -scheme PanelCompanion -destination 'generic/platform=iOS' build 2>&1 | grep -E "error:|BUILD"
```

Forventet: `BUILD SUCCEEDED`. AlarmKit er nytt, og API-et her er skrevet mot
Apples dokumentasjon — feiler kompileringen, er det signaturene som skal rettes
mot feilmeldingen, ikke designet.

- [ ] **Step 7: Kjør hele testsuiten og bygg panelet**

```bash
cd ipad-control-center && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add ipad-control-center
git commit -m "Set the five alarms from Ole's own rhythm"
```
