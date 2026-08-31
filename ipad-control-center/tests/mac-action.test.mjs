import assert from "node:assert/strict";
import test from "node:test";
import { isMacAction, runMacAction } from "../server/mac-action-service.mjs";

test("kjenner bare hvitelistede handlinger", () => {
  assert.equal(isMacAction("spotify"), true);
  assert.equal(isMacAction("screen-mirror"), true);
  assert.equal(isMacAction("sync-projects"), true);
  assert.equal(isMacAction("nhh-subjects"), true);
  assert.equal(isMacAction("link-site"), true);
  assert.equal(isMacAction("private-accounts"), true);
  assert.equal(isMacAction("school-session"), true);
  assert.equal(isMacAction("open-agent-session"), true);
  assert.equal(isMacAction("rm"), false);
  assert.equal(isMacAction(undefined), false);
});

function shortcutsExec(calls, names) {
  return async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "list") return { stdout: names.join("\n"), stderr: "" };
    return { stdout: "", stderr: "" };
  };
}

test("kjører snarveien som slår fokus på", async () => {
  const calls = [];
  const result = await runMacAction("focus-mode", {
    platform: "darwin",
    payload: { enabled: true },
    exec: shortcutsExec(calls, ["Netflix", "Fokus på", "Fokus av"]),
  });
  assert.deepEqual(calls.at(-1), ["open", ["-g", "shortcuts://run-shortcut?name=Fokus%20p%C3%A5"]]);
  assert.equal(result.enabled, true);
});

test("kjører snarveien som slår fokus av", async () => {
  const calls = [];
  await runMacAction("focus-mode", { platform: "darwin", payload: { enabled: false }, exec: shortcutsExec(calls, ["Fokus av"]) });
  assert.deepEqual(calls.at(-1), ["open", ["-g", "shortcuts://run-shortcut?name=Fokus%20av"]]);
});

test("sier fra når fokussnarveien mangler", async () => {
  await assert.rejects(
    () => runMacAction("focus-mode", { platform: "darwin", payload: { enabled: true }, exec: shortcutsExec([], ["Spotify"]) }),
    /Lag en snarvei som heter «Fokus på»/,
  );
});

test("avviser ukjente handlinger", async () => {
  await assert.rejects(() => runMacAction("shutdown", { platform: "darwin" }), /Ukjent Mac-handling/);
});

test("krever macOS-vert", async () => {
  await assert.rejects(() => runMacAction("spotify", { platform: "linux" }), /kjører på Mac-en/);
});

test("åpner Spotify-appen med faste argumenter", async () => {
  const calls = [];
  const result = await runMacAction("spotify", {
    platform: "darwin",
    exec: async (command, args) => { calls.push([command, args]); },
  });
  assert.deepEqual(calls, [["open", ["-a", "Spotify"]]]);
  assert.equal(result.target, "app");
});

test("åpner Sync-prosjekter i Chrome med fast adresse", async () => {
  const calls = [];
  const result = await runMacAction("sync-projects", {
    platform: "darwin",
    exec: async (command, args) => { calls.push([command, args]); },
  });
  assert.equal(calls[0][0], "osascript");
  assert.equal(calls[0][1].at(-1), "https://sync-co-op.netlify.app/projects");
  assert.ok(calls[0][1].includes("open location target"), "adressen sendes som argument, ikke som skripttekst");
  assert.equal(result.target, "chrome");
});

test("åpner den lokale NHH-siden i Chrome med fast adresse", async () => {
  const calls = [];
  const result = await runMacAction("nhh-subjects", {
    platform: "darwin",
    exec: async (command, args) => { calls.push([command, args]); },
  });
  assert.equal(calls[0][1].at(-1), "file:///Users/ole-froiland/Desktop/Prosjekter/nhh/index.html#/fag");
  assert.equal(result.target, "chrome");
});

test("åpner linksiden i Chrome med fast adresse", async () => {
  const calls = [];
  const result = await runMacAction("link-site", {
    platform: "darwin",
    exec: async (command, args) => { calls.push([command, args]); },
  });
  assert.equal(calls[0][1].at(-1), "https://mine-lenker-ole-froiland.netlify.app");
  assert.equal(result.target, "chrome");
});

test("åpner privat regnskap i Chrome med fast adresse", async () => {
  const calls = [];
  const result = await runMacAction("private-accounts", {
    platform: "darwin",
    exec: async (command, args) => { calls.push([command, args]); },
  });
  assert.equal(calls[0][1].at(-1), "https://privat-regnskap-ole.netlify.app");
  assert.equal(result.label, "Privat regnskap");
});

function sidecarExec(calls, { stdout = '{"device":"iPad (7)","state":"connected"}', fail } = {}) {
  return async (command, args) => {
    calls.push([command, args]);
    if (command === "clang") return { stdout: "", stderr: "" };
    if (fail) throw fail;
    return { stdout, stderr: "" };
  };
}

test("veksler Sidecar med enhetsnavnet som eget argument", async () => {
  const calls = [];
  const result = await runMacAction("screen-mirror", {
    platform: "darwin",
    payload: { device: "iPad (7)" },
    exec: sidecarExec(calls),
  });
  const toggle = calls.at(-1);
  assert.match(toggle[0], /sidecar-tool$/);
  assert.deepEqual(toggle[1], ["toggle", "iPad (7)"]);
  assert.equal(result.label, "iPad (7)");
  assert.equal(result.state, "connected");
});

test("bruker iPad som standardenhet", async () => {
  const calls = [];
  await runMacAction("screen-mirror", { platform: "darwin", exec: sidecarExec(calls) });
  assert.deepEqual(calls.at(-1)[1], ["toggle", "iPad"]);
});

test("avviser enhetsnavn med skalltegn", async () => {
  await assert.rejects(
    () => runMacAction("screen-mirror", { platform: "darwin", payload: { device: "iPad\"; rm -rf /" }, exec: async () => {} }),
    /Ugyldig enhetsnavn/,
  );
});

test("videreformidler Sidecar-feil til panelet", async () => {
  const calls = [];
  await assert.rejects(
    () => runMacAction("screen-mirror", {
      platform: "darwin",
      exec: sidecarExec(calls, { fail: Object.assign(new Error("Command failed"), { stderr: "Fant ingen Sidecar-enhet som heter «iPad».\n" }) }),
    }),
    /Fant ingen Sidecar-enhet/,
  );
});

test("faller tilbake til Spotify Web når appen mangler", async () => {
  const calls = [];
  const result = await runMacAction("spotify", {
    platform: "darwin",
    exec: async (command, args) => {
      calls.push([command, args]);
      if (args[0] === "-a") throw new Error("not found");
    },
  });
  assert.deepEqual(calls[1], ["open", ["https://open.spotify.com"]]);
  assert.equal(result.target, "web");
});

test("kjenner de nye reparasjonshandlingene", () => {
  assert.equal(isMacAction("calendar-privacy"), true);
  assert.equal(isMacAction("claude-login"), true);
  assert.equal(isMacAction("codex-login"), true);
});

test("åpner Terminal med kommandoen som argument, aldri limt inn i skriptet", async () => {
  const calls = [];
  const result = await runMacAction("claude-login", {
    platform: "darwin",
    exec: async (...args) => { calls.push(args); return { stdout: "", stderr: "" }; },
  });
  const [command, args] = calls.at(-1);
  assert.equal(command, "osascript");
  assert.equal(args.at(-1), "claude auth login");
  assert.equal(args.includes("do script command"), true);
  assert.equal(args.some((value) => value.includes('do script "')), false);
  assert.equal(result.target, "terminal");
});

test("åpner Personvern-ruta for kalendertilgang", async () => {
  const calls = [];
  await runMacAction("calendar-privacy", {
    platform: "darwin",
    exec: async (...args) => { calls.push(args); return { stdout: "", stderr: "" }; },
  });
  assert.deepEqual(calls.at(-1), ["open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"]]);
});

// Fristene ligger i dager fra nå, ikke på faste datoer: en test som slutter å
// virke i oktober tester noe annet enn det den ser ut til å teste.
const inDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const subjectCalendar = () => ({
  events: [
    { title: "📌 BUS400N – obligatorisk innlevering 1 (frist 23:59)", start: inDays(13) },
    { title: "📌 BUS401E – individual assignment (due 23:59)", start: inDays(17) },
    { title: "📌 BUS400N – obligatorisk innlevering 2 (frist 23:59)", start: inDays(40) },
    { title: "🔵 BUS400N – oppgaver / aktiv gjenhenting", start: inDays(11) },
  ],
});

const subjectDeps = {
  readProjects: async () => ({ BUS400N: "https://chatgpt.com/g/g-p-test/project" }),
  readCalendar: subjectCalendar,
};

test("erstatter en gammel usendt prompt etter at prosjektet er lastet", async () => {
  const calls = [];
  const result = await runMacAction("subject-session", {
    platform: "darwin",
    payload: { code: "bus400n", minutes: 75, title: "🔵 BUS400N – oppgaver / aktiv gjenhenting" },
    deps: subjectDeps,
    exec: async (command, args) => { calls.push([command, args]); return { stdout: "", stderr: "" }; },
  });

  assert.equal(result.label, "BUS400N");
  assert.equal(calls.length, 2);
  // Rekkefølgen er hele poenget: står ikke teksten klar når Chrome kommer fram,
  // har knappen spart Ole for ingenting.
  const [clipboard, chrome] = calls;
  assert.ok(clipboard[1].some((value) => value.includes("set the clipboard to")));
  assert.ok(chrome[1].includes("https://chatgpt.com/g/g-p-test/project"));
  assert.ok(chrome[1].includes("set URL of tab chosenTabIndex of chosenWindow to target"));
  assert.ok(chrome[1].includes('if currentUrl starts with "https://chatgpt.com/" or currentUrl starts with "https://chat.openai.com/" then'));
  assert.ok(chrome[1].includes("open location target"), "en ny fane er bare reserve når ingen ChatGPT-fane finnes");
  assert.ok(chrome[1].includes("if loading of tab chosenTabIndex of chosenWindow is false then exit repeat"));
  const selectAll = chrome[1].indexOf('tell application "System Events" to keystroke "a" using command down');
  const paste = chrome[1].indexOf('tell application "System Events" to keystroke "v" using command down');
  assert.ok(selectAll >= 0, "gammel tekst må markeres før den nye prompten limes inn");
  assert.ok(selectAll < paste, "⌘A må kjøres før ⌘V");
  const prompt = clipboard[1].at(-1);
  assert.ok(prompt.includes("75 minutter i BUS400N"));
  assert.ok(prompt.includes("🔵 BUS400N – oppgaver / aktiv gjenhenting"));
  assert.ok(prompt.includes("obligatorisk innlevering 1"));
  // Fristen til et annet fag hører ikke hjemme i denne økta, og en frist som
  // ligger seks uker fram hjelper ikke på de neste 75 minuttene.
  assert.ok(!prompt.includes("individual assignment"));
  assert.ok(!prompt.includes("obligatorisk innlevering 2"));
  // Bare frister, ikke øktene til samme fag.
  assert.ok(!prompt.includes("aktiv gjenhenting\n"));
});

test("åpner ingenting når faget mangler et prosjekt", async () => {
  const calls = [];
  await assert.rejects(
    runMacAction("subject-session", {
      platform: "darwin",
      payload: { code: "BUS446", minutes: 45 },
      deps: subjectDeps,
      exec: async (...args) => { calls.push(args); return { stdout: "", stderr: "" }; },
    }),
    /BUS446 har ingen ChatGPT-prosjekt/,
  );
  assert.equal(calls.length, 0);
});

test("starter en åpen skoleøkt uten å kreve minutter", async () => {
  const calls = [];
  const result = await runMacAction("subject-session", {
    platform: "darwin",
    payload: { code: "BUS400N" },
    deps: subjectDeps,
    exec: async (command, args) => { calls.push([command, args]); return { stdout: "", stderr: "" }; },
  });

  assert.equal(result.minutes, null);
  assert.ok(calls[0][1].at(-1).includes("Bruk filene, tidligere samtaler og resten av konteksten"));
  assert.equal(calls[1][1].at(-1), "https://chatgpt.com/g/g-p-test/project");
});

test("skoleknappen velger og registrerer faget med minst nylig arbeid", async () => {
  const calls = [];
  const recorded = [];
  const result = await runMacAction("school-session", {
    platform: "darwin",
    deps: {
      readProjects: async () => ({
        BUS400N: "https://chatgpt.com/g/g-p-one/project",
        BUS401E: "https://chatgpt.com/g/g-p-two/project",
      }),
      readCalendar: async () => ({ events: [{
        title: "🔵 BUS400N – oppgaver",
        start: new Date(Date.now() - 7_200_000).toISOString(),
        end: new Date(Date.now() - 3_600_000).toISOString(),
      }] }),
      readHistory: async () => [],
      recordSession: async (code) => { recorded.push(code); },
    },
    exec: async (command, args) => { calls.push([command, args]); return { stdout: "", stderr: "" }; },
  });

  assert.equal(result.label, "BUS401E");
  assert.deepEqual(recorded, ["BUS401E"]);
  assert.equal(calls[1][1].at(-1), "https://chatgpt.com/g/g-p-two/project");
  assert.ok(calls[1][1].includes("set active tab index of chosenWindow to chosenTabIndex"));
  assert.ok(calls[1][1].includes('tell application "System Events" to keystroke "v" using command down'));
});

test("skoleknappen åpner ingenting når ingen fag er koblet opp", async () => {
  const calls = [];
  await assert.rejects(
    runMacAction("school-session", {
      platform: "darwin",
      deps: {
        readProjects: async () => ({}),
        readCalendar: async () => ({ events: [] }),
        readHistory: async () => [],
      },
      exec: async (...args) => { calls.push(args); return { stdout: "", stderr: "" }; },
    }),
    /Ingen fag har et ChatGPT-prosjekt/,
  );
  assert.equal(calls.length, 0);
});

test("avviser fag og lengder som ikke er Oles", async () => {
  for (const payload of [{ code: "ETI450", minutes: 45 }, { code: "BUS400N", minutes: 0 }, { code: "BUS400N", minutes: 5000 }]) {
    await assert.rejects(runMacAction("subject-session", { platform: "darwin", payload, deps: subjectDeps, exec: async () => ({ stdout: "" }) }));
  }
});


test("åpner en økt i appen som eier den", async () => {
  const calls = [];
  const result = await runMacAction("open-agent-session", {
    platform: "darwin",
    payload: { provider: "codex", id: "01a0531d-e3f6-7620-a1bc-79632c4a1a08" },
    exec: async (command, args) => { calls.push([command, args]); return { stdout: "", stderr: "" }; },
  });
  assert.deepEqual(calls, [["open", ["codex://threads/01a0531d-e3f6-7620-a1bc-79632c4a1a08"]]]);
  assert.deepEqual(result, { action: "open-agent-session", target: "codex", label: "ChatGPT" });
});

test("sier fra når appen ikke svarer på adressen", async () => {
  await assert.rejects(
    () => runMacAction("open-agent-session", {
      platform: "darwin",
      payload: { provider: "codex", id: "01a0531d-e3f6-7620-a1bc-79632c4a1a08" },
      exec: async () => { throw new Error("LSOpenURLsWithRole() failed"); },
    }),
    /Fikk ikke åpnet økta i ChatGPT/,
  );
});

test("bygger ingen adresse av en ukjent økt", async () => {
  await assert.rejects(
    () => runMacAction("open-agent-session", { platform: "darwin", payload: { provider: "codex", id: "noe-annet" }, exec: async () => ({ stdout: "", stderr: "" }) }),
    /Ukjent oppgave/,
  );
});
