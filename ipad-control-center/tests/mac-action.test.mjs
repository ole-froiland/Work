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
