import test from "node:test";
import assert from "node:assert/strict";

import {
  describeClaudeActivity,
  findRecordedTitle,
  orderSessions,
  parseRecords,
  readTitleFromHead,
  resolveSessionState,
  summarizeClaudeSession,
  summarizeCodexSession,
} from "../server/agent-session-service.mjs";

const NOW = Date.parse("2026-08-21T12:00:00.000Z");

function claudeToolUse(timestamp, name) {
  return { type: "assistant", timestamp, isSidechain: false, message: { content: [{ type: "tool_use", name }] } };
}

function claudeAnswer(timestamp) {
  return { type: "assistant", timestamp, isSidechain: false, message: { stop_reason: "end_turn", content: [{ type: "text", text: "Ferdig." }] } };
}

test("reads an in-progress Claude session as working, with what it is doing", () => {
  const session = summarizeClaudeSession([
    { type: "custom-title", customTitle: "Oversikt over Claude-oppgaver" },
    { type: "user", timestamp: "2026-08-21T11:58:00.000Z", cwd: "/Users/ole/Desktop/Prosjekter/Work", message: { content: "fiks dette" } },
    claudeToolUse("2026-08-21T11:59:30.000Z", "Edit"),
    { type: "user", timestamp: "2026-08-21T11:59:31.000Z", message: { content: [{ type: "tool_result" }] } },
  ], { id: "abc", now: NOW });

  assert.equal(session.state, "working");
  assert.equal(session.activity, "Endrer filer");
  assert.equal(session.title, "Oversikt over Claude-oppgaver");
  assert.equal(session.project, "Work");
  assert.equal(session.lastActivityAt, "2026-08-21T11:59:31.000Z");
});

test("reads a finished Claude turn as done, not as work in progress", () => {
  const session = summarizeClaudeSession([
    { type: "custom-title", customTitle: "Mac performance lag" },
    claudeToolUse("2026-08-21T11:40:00.000Z", "Bash"),
    claudeAnswer("2026-08-21T11:41:00.000Z"),
  ], { id: "abc", now: NOW });

  assert.equal(session.state, "done");
  assert.equal(session.activity, null);
});

test("flags a session that stopped mid-turn instead of calling it active", () => {
  const session = summarizeClaudeSession([
    { type: "custom-title", customTitle: "Venter på svar" },
    claudeToolUse("2026-08-21T11:30:00.000Z", "Bash"),
  ], { id: "abc", now: NOW });

  assert.equal(session.state, "stalled");
});

test("keeps yesterday's sessions out of the card", () => {
  const session = summarizeClaudeSession([claudeAnswer("2026-08-20T12:00:00.000Z")], { id: "abc", now: NOW });

  assert.equal(session.state, "idle");
});

test("marks a session that is running a subagent", () => {
  const session = summarizeClaudeSession([
    { ...claudeToolUse("2026-08-21T11:59:00.000Z", "Task"), isSidechain: true },
  ], { id: "abc", now: NOW });

  assert.equal(session.subagent, true);
  assert.equal(session.activity, "Kjører en underagent");
});

test("falls back to the last prompt when the session has no name", () => {
  const session = summarizeClaudeSession([
    { type: "last-prompt", lastPrompt: "legg til en oversikt" },
    claudeAnswer("2026-08-21T11:59:00.000Z"),
  ], { id: "abc", now: NOW });

  assert.equal(session.title, "legg til en oversikt");
});

test("keeps a long prompt short enough for one line in the card", () => {
  const session = summarizeClaudeSession([
    { type: "last-prompt", lastPrompt: "kan du legge til en liten oversikt her under den andre oversikten" },
    claudeAnswer("2026-08-21T11:59:00.000Z"),
  ], { id: "abc", now: NOW });

  assert.equal(session.title, "kan du legge til en liten oversikt her un…");
  assert.ok(session.title.length <= 42);
});

test("names the Claude tools in plain Norwegian", () => {
  assert.equal(describeClaudeActivity("Bash"), "Kjører kommandoer");
  assert.equal(describeClaudeActivity("Write"), "Endrer filer");
  assert.equal(describeClaudeActivity("Grep"), "Søker i koden");
  assert.equal(describeClaudeActivity("mcp__Claude_Browser__navigate"), "Styrer nettleseren");
  assert.equal(describeClaudeActivity("EtHeltNyttVerktøy"), "Bruker verktøy");
  assert.equal(describeClaudeActivity(null), null);
});

test("reads Codex turn events as working and done", () => {
  const records = [
    { type: "session_meta", timestamp: "2026-08-21T11:00:00.000Z", payload: { cwd: "/Users/ole/Desktop/Prosjekter/Work" } },
    { type: "event_msg", timestamp: "2026-08-21T11:58:00.000Z", payload: { type: "user_message", message: "push til main" } },
    { type: "event_msg", timestamp: "2026-08-21T11:58:01.000Z", payload: { type: "task_started" } },
    { type: "event_msg", timestamp: "2026-08-21T11:59:00.000Z", payload: { type: "exec_command_begin" } },
  ];

  const working = summarizeCodexSession(records, { id: "x", title: "Push changes to main", now: NOW });
  assert.equal(working.state, "working");
  assert.equal(working.activity, "Kjører kommandoer");
  assert.equal(working.title, "Push changes to main");
  assert.equal(working.provider, "codex");

  const finished = summarizeCodexSession([
    ...records,
    { type: "event_msg", timestamp: "2026-08-21T11:59:30.000Z", payload: { type: "task_complete" } },
  ], { id: "x", now: NOW });
  assert.equal(finished.state, "done");
  assert.equal(finished.activity, null);
});

test("does not turn a Codex attachment message into the session name", () => {
  const session = summarizeCodexSession([
    { type: "session_meta", timestamp: "2026-08-21T11:50:00.000Z", payload: { cwd: "/Users/ole/Desktop/Prosjekter/Work" } },
    { type: "event_msg", timestamp: "2026-08-21T11:58:00.000Z", payload: { type: "user_message", message: "fiks kortet" } },
    { type: "event_msg", timestamp: "2026-08-21T11:58:02.000Z", payload: { type: "user_message", message: "# Files mentioned by the user: ## codex-clipboard-1" } },
  ], { id: "x", now: NOW });

  assert.equal(session.title, "fiks kortet");
});

test("shows running sessions before finished ones, newest first", () => {
  const ordered = orderSessions([
    { id: "done", state: "done", lastActivityAt: "2026-08-21T11:59:00.000Z" },
    { id: "old-working", state: "working", lastActivityAt: "2026-08-21T11:57:00.000Z" },
    { id: "new-working", state: "working", lastActivityAt: "2026-08-21T11:58:00.000Z" },
    { id: "stalled", state: "stalled", lastActivityAt: "2026-08-21T11:40:00.000Z" },
  ]);

  assert.deepEqual(ordered.map((session) => session.id), ["new-working", "old-working", "stalled", "done"]);
});

test("survives the half-written last line of a log that is still being appended", () => {
  const records = parseRecords('{"type":"assistant"}\n{"type":"user","mess');

  assert.deepEqual(records, [{ type: "assistant" }]);
});

test("finds the session name further back when a long turn fills the tail", () => {
  const text = [
    '{"type":"custom-title","customTitle":"Første navn"}',
    '{"type":"custom-title","customTitle":"Siste navn"}',
    '{"type":"assistant"}',
  ].join("\n");

  assert.equal(findRecordedTitle(text), "Siste navn");
  assert.equal(findRecordedTitle('{"type":"assistant"}'), "");
});

test("treats an unfinished turn as active only while it is fresh", () => {
  assert.equal(resolveSessionState(true, NOW - 30_000, NOW), "working");
  assert.equal(resolveSessionState(true, NOW - 20 * 60_000, NOW), "stalled");
  assert.equal(resolveSessionState(false, NOW - 20 * 60_000, NOW), "done");
  assert.equal(resolveSessionState(false, NOW - 20 * 60 * 60_000, NOW), "idle");
});

test("finds the name of a session whose log has grown past the tail window", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "panel-agent-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "session.jsonl");
  // Navnet skrives tidlig; halen er verktøykall fra en lang tur.
  const filler = `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } })}\n`;
  await writeFile(path, `${JSON.stringify({ type: "custom-title", customTitle: "Lang økt" })}\n${filler.repeat(3_000)}`);

  assert.equal(await readTitleFromHead(path, Date.now()), "Lang økt");

  // Navnet leses én gang i kvarteret, ikke ved hver oppdatering.
  await rm(path);
  assert.equal(await readTitleFromHead(path, Date.now()), "Lang økt");
});
