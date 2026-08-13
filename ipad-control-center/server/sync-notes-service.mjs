import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const NOTES_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "sync-notes.json");
const MAX_NOTES = 200;
const MAX_COMMANDS = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 30_000;

function shortText(value, maximum) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

export function normalizeSyncNotes(input = {}) {
  const userId = shortText(input.userId, 200);
  const notes = (Array.isArray(input.notes) ? input.notes : []).slice(0, MAX_NOTES).flatMap((value) => {
    const id = shortText(value?.id, 200);
    const title = shortText(value?.title, 500);
    const createdAt = new Date(value?.createdAt ?? value?.created_at ?? "");
    if (!id || !title || !Number.isFinite(+createdAt)) return [];
    return [{ id, title, createdAt: createdAt.toISOString() }];
  }).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return { userId, notes };
}

export function normalizeSyncNoteCommand(input = {}) {
  if (input.type === "create") {
    const title = shortText(input.title, 500);
    return title ? { type: "create", title } : null;
  }
  if (input.type === "complete") {
    const noteId = shortText(input.noteId, 200);
    return noteId ? { type: "complete", noteId } : null;
  }
  return null;
}

async function readState() {
  try {
    const value = JSON.parse(await readFile(NOTES_FILE, "utf8"));
    return {
      updatedAt: value.updatedAt ?? null,
      userId: value.userId ?? null,
      notes: Array.isArray(value.notes) ? value.notes : [],
      commands: Array.isArray(value.commands) ? value.commands : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return { updatedAt: null, userId: null, notes: [], commands: [] };
    }
    throw error;
  }
}

async function writeState(state) {
  await mkdir(dirname(NOTES_FILE), { recursive: true });
  await writeFile(NOTES_FILE, JSON.stringify(state), { mode: 0o600 });
}

export async function updateSyncNotes(input) {
  const current = await readState();
  const normalized = normalizeSyncNotes(input);
  if (!normalized.userId) throw new Error("Sync-bruker mangler");
  const next = { ...current, ...normalized, updatedAt: new Date().toISOString() };
  await writeState(next);
  return getSyncNotes();
}

export async function getSyncNotes() {
  const state = await readState();
  const age = Date.now() - new Date(state.updatedAt ?? "").getTime();
  const connected = Number.isFinite(age);
  return {
    updatedAt: state.updatedAt,
    notes: state.notes,
    connected,
    stale: !connected || age > MAX_AGE_MS,
    pending: state.commands.length,
  };
}

export async function enqueueSyncNoteCommand(input) {
  const command = normalizeSyncNoteCommand(input);
  if (!command) throw new Error("Ugyldig notathandling");
  const state = await readState();
  const queued = { id: randomUUID(), createdAt: new Date().toISOString(), claimedAt: null, ...command };
  state.commands = [...state.commands.slice(-(MAX_COMMANDS - 1)), queued];
  await writeState(state);
  return queued;
}

export async function leaseSyncNoteCommands() {
  const state = await readState();
  const now = Date.now();
  const leased = [];
  state.commands = state.commands.filter((command) => now - new Date(command.createdAt ?? "").getTime() <= MAX_AGE_MS);
  for (const command of state.commands) {
    const claimedAt = new Date(command.claimedAt ?? "").getTime();
    if (Number.isFinite(claimedAt) && now - claimedAt < LEASE_MS) continue;
    command.claimedAt = new Date(now).toISOString();
    leased.push(command);
  }
  await writeState(state);
  return leased;
}

export async function acknowledgeSyncNoteCommand(commandId) {
  const id = shortText(commandId, 200);
  if (!id) throw new Error("Kommando-ID mangler");
  const state = await readState();
  state.commands = state.commands.filter((command) => command.id !== id);
  await writeState(state);
  return { ok: true };
}
