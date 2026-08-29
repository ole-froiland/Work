import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSessionPrompt, listConnectedSubjects, normalizeSessionRequest, readSubjectProjects } from "../server/subject-service.mjs";

async function withProjectFile(contents, run) {
  const directory = await mkdtemp(join(tmpdir(), "panel-subjects-"));
  const file = join(directory, "subject-projects.json");
  await writeFile(file, contents, "utf8");
  try {
    return await run(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("tar bare imot adresser som kan være et ChatGPT-prosjekt", async () => {
  const projects = await withProjectFile(JSON.stringify({
    BUS400N: "https://chatgpt.com/g/g-p-abc/project",
    BUS401E: "https://chat.openai.com/g/g-p-def/project",
    BUS446: "http://chatgpt.com/g/g-p-ghi/project",
    STR402A: "https://example.com/noe-helt-annet",
    ETI450: "https://chatgpt.com/g/g-p-jkl/project",
  }), readSubjectProjects);

  assert.deepEqual(Object.keys(projects), ["BUS400N", "BUS401E"]);
});

test("uten fil er ingen fag koblet opp, og panelet tilbyr ingen knapp", async () => {
  assert.deepEqual(await listConnectedSubjects(join(tmpdir(), "finnes-ikke", "subject-projects.json")), []);
  assert.deepEqual(await withProjectFile("{ ikke json", listConnectedSubjects), []);
});

const now = new Date(2026, 7, 31, 8, 20);
const deadlines = [
  { title: "📌 BUS400N – obligatorisk innlevering 1 (frist 23:59)", start: new Date(2026, 8, 11, 23, 59).toISOString() },
  { title: "📌 BUS401E – individual assignment (due 23:59)", start: new Date(2026, 8, 15, 23, 59).toISOString() },
  { title: "📌 BUS400N – obligatorisk innlevering 2 (frist 23:59)", start: new Date(2026, 9, 8, 23, 59).toISOString() },
];

test("prompten sier hva økta er, hvor lang den er og hva som haster", () => {
  const prompt = buildSessionPrompt({
    code: "BUS400N",
    minutes: 75,
    title: "🔵 BUS400N – oppgaver / aktiv gjenhenting",
    events: deadlines,
    now,
  });

  assert.match(prompt, /^Jeg har en økt på 75 minutter i BUS400N nå\./);
  assert.ok(prompt.includes("Kalenderen sier: «🔵 BUS400N – oppgaver / aktiv gjenhenting»."));
  assert.ok(prompt.includes("- 11.09 obligatorisk innlevering 1 (frist 23:59)"));
  assert.ok(!prompt.includes("individual assignment"));
  assert.ok(!prompt.includes("innlevering 2"));
});

// En tom fristliste er ikke det samme som ingen frister, og prompten skal ikke
// la ChatGPT tro at faget er à jour når kalenderen bare er tom.
test("sier fra når faget ikke har frister i vinduet", () => {
  const prompt = buildSessionPrompt({ code: "BUS446", minutes: 45, title: null, events: deadlines, now });
  assert.ok(prompt.includes("Kalenderen har ingen BUS446-frister de neste tre ukene."));
});

test("avviser fag panelet ikke kjenner og lengder som ikke er en økt", () => {
  assert.deepEqual(normalizeSessionRequest({ code: "bus446", minutes: 45.4, title: "  Fag  " }), {
    code: "BUS446",
    minutes: 45,
    title: "Fag",
  });
  assert.throws(() => normalizeSessionRequest({ code: "ETI450", minutes: 45 }), /Ukjent fag/);
  assert.throws(() => normalizeSessionRequest({ code: "BUS446", minutes: "lenge" }), /Ugyldig lengde/);
  assert.throws(() => normalizeSessionRequest({ code: "BUS446", minutes: 721 }), /Ugyldig lengde/);
});
