import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Kortet svarer på «hva holder Claude og Codex på med akkurat nå». Begge
// klientene skriver hver eneste hendelse til en samtalelogg mens de jobber, så
// loggene er den eneste kilden som vet det uten å spørre en leverandør. Vi leser
// bare slutten av hver logg: det er der svaret ligger, og filene blir megabytes.
const CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const CODEX_SESSIONS = join(homedir(), ".codex", "sessions");
const CODEX_INDEX = join(homedir(), ".codex", "session_index.jsonl");
const TAIL_BYTES = 128 * 1024;
const HEAD_BYTES = 256 * 1024;
const TITLE_CACHE_MS = 5 * 60 * 1000;

// En økt er «relevant» i åtte timer, men regnes bare som aktiv når det skjedde
// noe de siste fem minuttene. Et langt byggesteg eller en stor nedlasting kan
// gå noen minutter uten å skrive en linje, så kortere grense ville blinket
// «står stille» midt i normalt arbeid.
export const RECENT_MS = 8 * 60 * 60 * 1000;
export const WORKING_MS = 5 * 60 * 1000;
const MAX_SESSIONS = 8;

const CLAUDE_TOOL_ACTIVITY = [
  [/^Bash(Output)?$|^KillShell$/, "Kjører kommandoer"],
  [/^(Edit|Write|NotebookEdit)$/, "Endrer filer"],
  [/^(Read|NotebookRead)$/, "Leser filer"],
  [/^(Grep|Glob|ToolSearch)$/, "Søker i koden"],
  [/^(WebSearch|WebFetch)$/, "Leter på nettet"],
  [/^(Task|Agent|SendMessage)$/, "Kjører en underagent"],
  [/^(TodoWrite|Task(Create|Update|List))$/, "Planlegger"],
  [/^Skill$/, "Følger en oppskrift"],
  [/^mcp__Claude_Browser__|^mcp__claude-in-chrome__/, "Styrer nettleseren"],
  [/^mcp__/, "Bruker en kobling"],
];

const CODEX_EVENT_ACTIVITY = new Map([
  ["exec_command_begin", "Kjører kommandoer"],
  ["exec_command_end", "Kjører kommandoer"],
  ["patch_apply_begin", "Endrer filer"],
  ["patch_apply_end", "Endrer filer"],
  ["web_search_begin", "Leter på nettet"],
  ["web_search_end", "Leter på nettet"],
  ["mcp_tool_call_begin", "Bruker en kobling"],
  ["mcp_tool_call_end", "Bruker en kobling"],
  ["agent_reasoning", "Tenker"],
  ["agent_message", "Skriver svar"],
]);

export function describeClaudeActivity(toolName) {
  if (!toolName) return null;
  const match = CLAUDE_TOOL_ACTIVITY.find(([pattern]) => pattern.test(toolName));
  return match ? match[1] : "Bruker verktøy";
}

function shorten(value, limit = 68) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function projectName(directory) {
  const name = basename(String(directory ?? "")).trim();
  return name && name !== "/" ? name : "Ukjent mappe";
}

// Tilstanden er det kortet faktisk spørres om: jobber den, er den ferdig, eller
// har den stoppet opp? «pending» er sant når siste hendelse var midt i en tur —
// et verktøykall, et verktøysvar eller en ny beskjed fra Ole.
export function resolveSessionState(pending, lastActivityAt, now = Date.now()) {
  const age = Math.max(0, now - lastActivityAt);
  if (age > RECENT_MS) return "idle";
  if (!pending) return "done";
  return age <= WORKING_MS ? "working" : "stalled";
}

function contentBlocks(record) {
  const content = record?.message?.content;
  return Array.isArray(content) ? content : [];
}

export function summarizeClaudeSession(records, { id, title: fallbackTitle = "", now = Date.now() } = {}) {
  let title = fallbackTitle;
  let prompt = "";
  let directory = "";
  let activity = null;
  let pending = false;
  let lastActivityAt = 0;
  let subagentAt = 0;

  for (const record of records) {
    if (record?.type === "custom-title" && record.customTitle) title = record.customTitle;
    if (record?.type === "last-prompt" && record.lastPrompt) prompt = record.lastPrompt;
    if (record?.cwd) directory = record.cwd;

    const stamp = Date.parse(record?.timestamp ?? "");
    if (!Number.isFinite(stamp)) continue;
    lastActivityAt = Math.max(lastActivityAt, stamp);
    if (record.isSidechain) subagentAt = Math.max(subagentAt, stamp);

    if (record.type === "assistant") {
      const tool = contentBlocks(record).findLast((block) => block?.type === "tool_use");
      if (tool) {
        activity = describeClaudeActivity(tool.name);
        pending = true;
      } else if (contentBlocks(record).some((block) => block?.type === "text")) {
        activity = null;
        pending = false;
      }
      continue;
    }
    if (record.type === "user") {
      const isToolResult = contentBlocks(record).some((block) => block?.type === "tool_result");
      if (!isToolResult) activity = null;
      pending = true;
    }
  }

  if (!lastActivityAt) return null;
  const project = projectName(directory);
  return {
    id,
    provider: "claude",
    title: shorten(title || prompt || project, 42) || "Uten navn",
    project,
    state: resolveSessionState(pending, lastActivityAt, now),
    activity,
    prompt: shorten(prompt),
    subagent: subagentAt > 0 && now - subagentAt <= WORKING_MS,
    lastActivityAt: new Date(lastActivityAt).toISOString(),
  };
}

export function summarizeCodexSession(records, { id, title = "", now = Date.now() } = {}) {
  let directory = "";
  let prompt = "";
  let activity = null;
  let pending = false;
  let lastActivityAt = 0;

  for (const record of records) {
    const payload = record?.payload ?? {};
    if (record?.type === "session_meta" && payload.cwd) directory = payload.cwd;
    if (record?.type === "turn_context" && payload.cwd) directory = payload.cwd;

    const stamp = Date.parse(record?.timestamp ?? "");
    if (!Number.isFinite(stamp)) continue;
    lastActivityAt = Math.max(lastActivityAt, stamp);

    if (record.type !== "event_msg") continue;
    if (payload.type === "user_message") {
      // Vedlegg sendes som en egen beskjed med maskintekst («# Files mentioned
      // by the user …»). Den skal ikke bli navnet på økta.
      const message = String(payload.message ?? "");
      if (message && !message.startsWith("#")) prompt = message;
      pending = true;
      activity = null;
      continue;
    }
    if (payload.type === "task_started") {
      pending = true;
      continue;
    }
    if (payload.type === "task_complete") {
      pending = false;
      activity = null;
      continue;
    }
    const known = CODEX_EVENT_ACTIVITY.get(payload.type);
    if (known) activity = known;
  }

  if (!lastActivityAt) return null;
  const project = projectName(directory);
  return {
    id,
    provider: "codex",
    title: shorten(title || prompt || project, 42) || "Uten navn",
    project,
    state: resolveSessionState(pending, lastActivityAt, now),
    activity,
    prompt: shorten(prompt),
    subagent: false,
    lastActivityAt: new Date(lastActivityAt).toISOString(),
  };
}

async function readTail(path, bytes = TAIL_BYTES) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    if (buffer.length) await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    // Et delvis lest første linje er ikke gyldig JSON og skal kastes.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    await handle.close();
  }
}

async function readHead(path, bytes = 8 * 1024) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function parseRecords(text) {
  const records = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Loggen skrives mens vi leser, så siste linje kan være halv.
    }
  }
  return records;
}

async function listRecentLogs(directory, cutoffMs) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listRecentLogs(path, cutoffMs));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const details = await stat(path);
      if (details.mtimeMs >= cutoffMs) files.push({ path, mtimeMs: details.mtimeMs });
    }
  }
  return files;
}

function newestFirst(files) {
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSIONS);
}

// Claude døper økta tidlig og gjør det sjelden om igjen, mens halen fylles av
// verktøykall. I en lang samtale ligger navnet derfor i starten av loggen og
// ikke i slutten – uten dette står det en avkuttet beskjed i kortet i stedet.
export function findRecordedTitle(text) {
  const marker = '"type":"custom-title"';
  const at = String(text ?? "").lastIndexOf(marker);
  if (at < 0) return "";
  const start = text.lastIndexOf("\n", at) + 1;
  const end = text.indexOf("\n", at);
  try {
    return JSON.parse(text.slice(start, end < 0 ? undefined : end))?.customTitle ?? "";
  } catch {
    return "";
  }
}

// Navnet ligger stille i starten av en logg som vokser til flere megabyte, så
// det hentes én gang i kvarteret i stedet for hvert tiende sekund. Et nytt navn
// i halen slår uansett igjennom med en gang.
const titleCache = new Map();

export async function readTitleFromHead(path, now = Date.now()) {
  const cached = titleCache.get(path);
  if (cached && now - cached.readAt < TITLE_CACHE_MS) return cached.title;
  const title = findRecordedTitle(await readHead(path, HEAD_BYTES));
  titleCache.set(path, { title, readAt: now });
  if (titleCache.size > 64) {
    for (const [key, value] of titleCache) if (now - value.readAt >= TITLE_CACHE_MS) titleCache.delete(key);
  }
  return title;
}

async function loadClaudeSessions(now) {
  const files = newestFirst(await listRecentLogs(CLAUDE_PROJECTS, now - RECENT_MS));
  const sessions = await Promise.all(files.map(async ({ path }) => {
    const tail = await readTail(path);
    const title = findRecordedTitle(tail) || await readTitleFromHead(path, now);
    return summarizeClaudeSession(parseRecords(tail), { id: basename(path, ".jsonl"), title, now });
  }));
  return sessions.filter(Boolean);
}

async function readCodexTitles() {
  try {
    const records = parseRecords(await readTail(CODEX_INDEX));
    return new Map(records.filter((record) => record?.id).map((record) => [record.id, record.thread_name ?? ""]));
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
}

async function loadCodexSessions(now) {
  const files = newestFirst(await listRecentLogs(CODEX_SESSIONS, now - RECENT_MS));
  if (!files.length) return [];
  const titles = await readCodexTitles();
  const sessions = await Promise.all(files.map(async ({ path }) => {
    // Mappa ligger i første linje, tilstanden i de siste.
    const records = [...parseRecords(await readHead(path)), ...parseRecords(await readTail(path))];
    const id = basename(path, ".jsonl").split("-").slice(-5).join("-");
    return summarizeCodexSession(records, { id, title: titles.get(id) ?? "", now });
  }));
  return sessions.filter(Boolean);
}

const STATE_ORDER = { working: 0, stalled: 1, done: 2, idle: 3 };

export function orderSessions(sessions) {
  return [...sessions].sort((first, second) => {
    const byState = STATE_ORDER[first.state] - STATE_ORDER[second.state];
    if (byState) return byState;
    return Date.parse(second.lastActivityAt) - Date.parse(first.lastActivityAt);
  });
}

async function captureProvider(load) {
  try {
    return { sessions: await load(), error: null };
  } catch (error) {
    return { sessions: [], error: error instanceof Error ? error.message : "Ukjent feil" };
  }
}

export async function getAgentSessions({ now = Date.now() } = {}) {
  const [claude, codex] = await Promise.all([
    captureProvider(() => loadClaudeSessions(now)),
    captureProvider(() => loadCodexSessions(now)),
  ]);
  const sessions = orderSessions([...claude.sessions, ...codex.sessions].filter((session) => session.state !== "idle"));
  return {
    updatedAt: new Date(now).toISOString(),
    ok: !claude.error && !codex.error,
    error: claude.error ?? codex.error,
    sessions,
  };
}
