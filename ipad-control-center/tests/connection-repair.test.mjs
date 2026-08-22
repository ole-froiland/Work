import assert from "node:assert/strict";
import test from "node:test";

import { isRepairableConnection, repairConnection } from "../server/connection-repair-service.mjs";

// Ingen av testene skal røre Mac-en eller vente på ekte sekunder.
function tools(overrides = {}) {
  return {
    exec: async () => ({ stdout: "", stderr: "" }),
    wait: async () => {},
    runMacAction: async () => ({ ok: true }),
    ...overrides,
  };
}

test("kjenner bare tilkoblingene panelet faktisk viser", () => {
  assert.equal(isRepairableConnection("calendar"), true);
  assert.equal(isRepairableConnection("claude"), true);
  assert.equal(isRepairableConnection("mobile"), true);
  assert.equal(isRepairableConnection("rm -rf"), false);
  assert.equal(isRepairableConnection(undefined), false);
});

test("avviser ukjent tilkobling i stedet for å gjøre noe tilfeldig", async () => {
  await assert.rejects(() => repairConnection("spotify"), /Ukjent tilkobling/);
});

test("kalenderen er reparert når lesingen går gjennom", async () => {
  const result = await repairConnection("calendar", tools({
    readAppleCalendarNow: async () => [{ id: "a" }, { id: "b" }],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.detail, "2 hendelser hentet");
  assert.equal(result.next, null);
});

test("manglende kalendertilgang sender deg til Personvern, ikke til å starte Kalender", async () => {
  const calls = [];
  const result = await repairConnection("calendar", tools({
    exec: async (...args) => { calls.push(args); return { stdout: "" }; },
    readAppleCalendarNow: async () => { throw new Error("Panelet mangler tilgang til Apple Kalender"); },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Panelet mangler tilgang til Apple Kalender");
  assert.equal(result.next.action, "calendar-privacy");
  assert.deepEqual(calls, []);
});

test("starter Kalender og leser på nytt når appen ikke kjørte", async () => {
  const calls = [];
  let attempts = 0;
  const result = await repairConnection("calendar", tools({
    exec: async (...args) => { calls.push(args); return { stdout: "" }; },
    readAppleCalendarNow: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Kalender kjører ikke");
      return [{ id: "a" }];
    },
  }));
  assert.deepEqual(calls[0], ["open", ["-g", "-a", "Kalender"]]);
  assert.equal(result.ok, true);
  assert.equal(result.detail, "1 hendelse hentet");
});

test("gir opp kalenderen med den ekte årsaken, ikke en generisk", async () => {
  const result = await repairConnection("calendar", tools({
    readAppleCalendarNow: async () => { throw new Error("Kalenderlesingen brøt sammen"); },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Kalenderlesingen brøt sammen");
  assert.equal(result.next, null);
});

test("notater som allerede er inne trenger ingen Chrome-fane", async () => {
  let opened = 0;
  const result = await repairConnection("notes", tools({
    getSyncNotes: async () => ({ connected: true, notes: [{ id: "n" }] }),
    runMacAction: async () => { opened += 1; return { ok: true }; },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.detail, "1 notat hentet");
  assert.equal(opened, 0);
});

test("åpner Sync og venter til nettsida sender notatene", async () => {
  const actions = [];
  let polls = 0;
  const result = await repairConnection("notes", tools({
    getSyncNotes: async () => {
      polls += 1;
      return polls > 2 ? { connected: true, notes: [{ id: "a" }, { id: "b" }] } : { connected: false, notes: [] };
    },
    runMacAction: async (action) => { actions.push(action); return { ok: true }; },
  }));
  assert.deepEqual(actions, ["sync-projects"]);
  assert.equal(result.ok, true);
  assert.equal(result.detail, "2 notater hentet");
});

test("sier at Sync-fanen må stå åpen når det aldri kommer noe", async () => {
  const result = await repairConnection("notes", tools({
    getSyncNotes: async () => ({ connected: false, notes: [] }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Sync-fanen må stå åpen på Mac-en");
  assert.equal(result.next, null);
});

test("skiller en iPhone som aldri har sendt fra en som har sendt for lenge siden", async () => {
  const never = await repairConnection("mobile", tools({
    getDeviceMetrics: async () => ({ syncConnected: false, sources: {} }),
  }));
  assert.equal(never.reason, "never");
  assert.match(never.detail, /aldri sendt/);

  const stale = await repairConnection("mobile", tools({
    getDeviceMetrics: async () => ({
      syncConnected: false,
      sources: { steps: { provider: "HealthKit", observedAt: "2026-08-20T09:00:00+02:00" } },
    }),
  }));
  assert.equal(stale.reason, "stale");
  assert.match(stale.detail, /for gamle/);
});

test("tilbyr aldri en knapp for iPhonen, som ingen knapp kan nå", async () => {
  const result = await repairConnection("mobile", tools({
    getDeviceMetrics: async () => ({ syncConnected: false, sources: {} }),
  }));
  assert.equal(result.next, null);
});

test("starter Codex app-server på nytt når den har stoppet opp", async () => {
  let restarted = 0;
  let calls = 0;
  const result = await repairConnection("codex", tools({
    restartCodexClient: () => { restarted += 1; },
    getUsageSnapshot: async () => {
      calls += 1;
      return calls === 1
        ? { codex: { ok: false, error: "Codex svarte ikke på account/rateLimits/read" } }
        : { codex: { ok: true } };
    },
  }));
  assert.equal(restarted, 1);
  assert.equal(result.ok, true);
  assert.equal(result.detail, "Kvoten er hentet");
});

test("sender deg til codex login når Codex ikke er logget inn", async () => {
  const result = await repairConnection("codex", tools({
    restartCodexClient: () => {},
    getUsageSnapshot: async () => ({ codex: { ok: false, error: "Codex er ikke logget inn" } }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.next.action, "codex-login");
});

test("en ny lesing av Nøkkelringen er ofte hele Claude-fiksen", async () => {
  let throttleReset = 0;
  const result = await repairConnection("claude", tools({
    resetClaudeThrottle: () => { throttleReset += 1; },
    getUsageSnapshot: async () => ({ claude: { ok: true } }),
  }));
  assert.equal(throttleReset, 1);
  assert.equal(result.ok, true);
  assert.equal(result.next, null);
});

test("invalid_grant er det ene tilfellet som krever ny innlogging", async () => {
  const result = await repairConnection("claude", tools({
    resetClaudeThrottle: () => {},
    getUsageSnapshot: async () => ({
      claude: { ok: false, code: "invalid_grant", error: "Claude-pålogging kunne ikke fornyes (400: refresh token expired)" },
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Påloggingen må fornyes på Mac-en");
  assert.equal(result.next.action, "claude-login");
});

test("andre Claude-feil vises ordrett i stedet for å skylde på påloggingen", async () => {
  const result = await repairConnection("claude", tools({
    resetClaudeThrottle: () => {},
    getUsageSnapshot: async () => ({
      claude: { ok: false, code: "invalid_client", error: "Claude-pålogging kunne ikke fornyes (400: unknown client)" },
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Claude-pålogging kunne ikke fornyes (400: unknown client)");
  assert.equal(result.next, null);
});

test("svaret bærer aldri med seg tokenverdier", async () => {
  const result = await repairConnection("claude", tools({
    resetClaudeThrottle: () => {},
    getUsageSnapshot: async () => ({
      claude: { ok: false, code: "invalid_grant", error: "Claude-pålogging kunne ikke fornyes (400)", accessToken: "sk-ant-hemmelig" },
    }),
  }));
  assert.equal(JSON.stringify(result).includes("sk-ant-hemmelig"), false);
});

test("utålmodige trykk starter ikke en reparasjon til oppå den som kjører", async () => {
  let started = 0;
  const options = tools({
    resetClaudeThrottle: () => {},
    getUsageSnapshot: async () => {
      started += 1;
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      return { claude: { ok: true } };
    },
  });
  const [first, second] = await Promise.all([repairConnection("claude", options), repairConnection("claude", options)]);
  assert.equal(started, 1);
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
});

test("en sekvens som henger gir opp i stedet for å bli stående", async () => {
  const result = await repairConnection("claude", tools({
    deadlineMs: 20,
    resetClaudeThrottle: () => {},
    getUsageSnapshot: () => new Promise(() => {}),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Tok for lang tid");
});

test("en sekvens som kaster blir til en lesbar rad, ikke en 500", async () => {
  const result = await repairConnection("codex", tools({
    getUsageSnapshot: async () => { throw new Error("Kvotetjenesten falt ned"); },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Kvotetjenesten falt ned");
  assert.equal(result.id, "codex");
});

test("en avbrutt innlogging får samme knapp som et utløpt token", async () => {
  const result = await repairConnection("claude", tools({
    resetClaudeThrottle: () => {},
    getUsageSnapshot: async () => ({
      claude: { ok: false, code: "logged_out", error: "Ingen er logget inn i Claude på Mac-en" },
    }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.detail, "Ingen er logget inn i Claude på Mac-en");
  assert.equal(result.next.action, "claude-login");
});

test("ber om kalendertilgang før den sender deg inn i Personvern", async () => {
  const order = [];
  let reads = 0;
  const result = await repairConnection("calendar", tools({
    readAppleCalendarNow: async () => {
      reads += 1;
      order.push("les");
      if (reads === 1) throw new Error("Panelet mangler tilgang til Apple Kalender (status 4)");
      return [{ id: "a" }, { id: "b" }];
    },
    requestAppleCalendarAccess: async () => { order.push("spør"); return { asked: true, granted: true }; },
  }));
  assert.deepEqual(order, ["les", "spør", "les"]);
  assert.equal(result.ok, true);
  assert.equal(result.detail, "2 hendelser hentet");
});

test("faller tilbake til Personvern når macOS ikke spør", async () => {
  const result = await repairConnection("calendar", tools({
    readAppleCalendarNow: async () => { throw new Error("Panelet mangler tilgang til Apple Kalender (status 4)"); },
    requestAppleCalendarAccess: async () => ({ asked: false, granted: false }),
  }));
  assert.equal(result.ok, false);
  assert.match(result.detail, /bare skrivetilgang/);
  assert.equal(result.next.action, "calendar-privacy");
  assert.equal(result.steps.at(-1).detail, "macOS spurte ikke");
});

test("en dialog som blir avvist ender også i Personvern", async () => {
  const result = await repairConnection("calendar", tools({
    readAppleCalendarNow: async () => { throw new Error("Panelet mangler tilgang til Apple Kalender (status 2)"); },
    requestAppleCalendarAccess: async () => ({ asked: true, granted: false }),
  }));
  assert.equal(result.next.action, "calendar-privacy");
  assert.equal(result.steps.at(-1).detail, "Tilgang ble ikke gitt");
});
