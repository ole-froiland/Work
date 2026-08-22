import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { accessSync, constants, createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_CACHE_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "claude-usage.json");
const CACHE_MS = 30_000;
const CLAUDE_MIN_REFRESH_MS = 60_000;

let cachedSnapshot = null;
let cachedAt = 0;
let inFlight = null;
let cachedClaudeUsage = null;
let nextClaudeFetchAt = 0;

function errorMessage(error) {
  return error instanceof Error ? error.message : "Ukjent feil";
}

function normalizeWindow(key, label, value, active = true) {
  if (!value) return null;
  const usedPercent = Number(value.usedPercent ?? value.used_percentage ?? value.utilization);
  const rawReset = value.resetsAt ?? value.resets_at ?? null;
  const resetsAt = typeof rawReset === "number"
    ? new Date(rawReset * 1000).toISOString()
    : rawReset ? new Date(rawReset).toISOString() : null;
  if (!Number.isFinite(usedPercent)) return null;
  return {
    key,
    label,
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    resetsAt,
    active,
  };
}

export function normalizeCodexUsage(rateResult, usageResult, dayKey = localDayKey(new Date())) {
  const limits = rateResult?.rateLimits;
  if (!limits) throw new Error("Codex returnerte ingen kvotedata");
  const windows = [
    normalizeWindow("primary", formatWindowLabel(limits.primary?.windowDurationMins), limits.primary),
    normalizeWindow("secondary", formatWindowLabel(limits.secondary?.windowDurationMins), limits.secondary),
  ].filter(Boolean);
  if (!windows.length) throw new Error("Codex returnerte ingen aktive kvotevinduer");
  return {
    ok: true,
    plan: limits.planType ?? null,
    windows,
    lifetimeTokens: usageResult?.summary?.lifetimeTokens ?? null,
    todayTokens: usageResult?.dailyUsageBuckets?.find((bucket) => bucket.startDate === dayKey)?.tokens ?? 0,
    todaySource: "account",
  };
}

export function normalizeClaudeUsage(raw, todayTokens = 0) {
  const windows = Array.isArray(raw?.limits) && raw.limits.length
    ? raw.limits.map((limit) => normalizeWindow(
      limit.kind,
      claudeLimitLabel(limit),
      { utilization: limit.percent, resets_at: limit.resets_at },
      limit.is_active !== false,
    )).filter(Boolean)
    : [
      normalizeWindow("five_hour", "5 timer", raw?.five_hour, Boolean(raw?.five_hour?.resets_at)),
      normalizeWindow("seven_day", "7 dager", raw?.seven_day, Boolean(raw?.seven_day?.resets_at)),
      normalizeWindow("seven_day_sonnet", "Sonnet · 7 dager", raw?.seven_day_sonnet, Boolean(raw?.seven_day_sonnet?.resets_at)),
      normalizeWindow("seven_day_opus", "Opus · 7 dager", raw?.seven_day_opus, Boolean(raw?.seven_day_opus?.resets_at)),
    ].filter(Boolean);
  if (!windows.length) throw new Error("Claude returnerte ingen aktive kvotevinduer");
  return { ok: true, windows, todayTokens, todaySource: "local-claude-code" };
}

function claudeLimitLabel(limit) {
  if (limit.kind === "session") return "5 timer";
  if (limit.kind === "weekly_all") return "7 dager";
  if (limit.kind?.startsWith("weekly_")) return `${limit.kind.slice(7)} · 7 dager`;
  return limit.kind ?? "Kvote";
}

function localDayKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function tokenTotal(usage) {
  return Number(usage?.input_tokens ?? 0)
    + Number(usage?.output_tokens ?? 0)
    + Number(usage?.cache_creation_input_tokens ?? 0)
    + Number(usage?.cache_read_input_tokens ?? 0);
}

export function summarizeClaudeRecords(records, dayKey) {
  const messages = new Map();
  for (const record of records) {
    if (record?.type !== "assistant" || !record?.message?.usage || !record.timestamp) continue;
    if (localDayKey(new Date(record.timestamp)) !== dayKey) continue;
    const messageId = record.message.id ?? record.requestId;
    if (!messageId || record.message.model === "<synthetic>") continue;
    messages.set(messageId, tokenTotal(record.message.usage));
  }
  return [...messages.values()].reduce((sum, tokens) => sum + tokens, 0);
}

async function listRecentClaudeLogs(directory, cutoffMs) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listRecentClaudeLogs(path, cutoffMs));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const details = await stat(path);
      if (details.mtimeMs >= cutoffMs) files.push(path);
    }
  }
  return files;
}

async function readClaudeTodayTokens(now = new Date()) {
  const projectsDirectory = join(homedir(), ".claude", "projects");
  const dayKey = localDayKey(now);
  const files = await listRecentClaudeLogs(projectsDirectory, now.getTime() - 48 * 60 * 60 * 1000);
  const messages = new Map();
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record?.type !== "assistant" || !record?.message?.usage || !record.timestamp) continue;
      if (localDayKey(new Date(record.timestamp)) !== dayKey) continue;
      const messageId = record.message.id ?? record.requestId;
      if (!messageId || record.message.model === "<synthetic>") continue;
      messages.set(messageId, tokenTotal(record.message.usage));
    }
  }
  return [...messages.values()].reduce((sum, tokens) => sum + tokens, 0);
}

function formatWindowLabel(minutes) {
  if (!Number.isFinite(minutes)) return "Kvote";
  if (minutes % 10_080 === 0) return `${minutes / 10_080} uke`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} dager`;
  if (minutes % 60 === 0) return `${minutes / 60} timer`;
  return `${minutes} min`;
}

function canExecute(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCodexExecutable({
  path = process.env.PATH ?? "",
  home = homedir(),
  configuredPath = process.env.PANEL_CODEX_PATH,
  isExecutable = canExecute,
} = {}) {
  const candidates = [
    configuredPath,
    ...path.split(delimiter).filter(Boolean).map((directory) => join(directory, "codex")),
    join(home, ".npm-global", "bin", "codex"),
    join(home, ".local", "bin", "codex"),
    "/Applications/ChatGPT.app/Contents/Resources/codex",
  ].filter(Boolean);
  const executable = [...new Set(candidates)].find(isExecutable);
  if (executable) return executable;
  throw new Error("Fant ikke Codex-klienten på Mac-en. Installer eller åpne Codex og prøv igjen.");
}

function codexLaunchError(error) {
  return error?.code === "ENOENT"
    ? new Error("Fant ikke Codex-klienten på Mac-en. Installer eller åpne Codex og prøv igjen.")
    : error;
}

class CodexRpcClient {
  process = null;
  nextId = 1;
  pending = new Map();
  ready = null;

  async request(method, params = {}) {
    await this.ensureStarted();
    return this.send(method, params);
  }

  async ensureStarted() {
    if (this.process && !this.process.killed) return this.ready;
    this.process = spawn(resolveCodexExecutable(), ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
    const lines = createInterface({ input: this.process.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.process.once("error", (error) => this.rejectAll(codexLaunchError(error)));
    this.process.once("exit", () => {
      this.rejectAll(new Error("Codex app-server stoppet"));
      this.process = null;
      this.ready = null;
    });
    this.ready = this.send("initialize", {
      clientInfo: { name: "ipad-control-center", title: "iPad Control Center", version: "1.0.0" },
    }).then(() => undefined);
    return this.ready;
  }

  send(method, params) {
    if (!this.process?.stdin?.writable) return Promise.reject(new Error("Codex app-server er ikke tilgjengelig"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex svarte ikke på ${method}`));
      }, 8_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (typeof message.id !== "number") return;
    const request = this.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    this.pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? "Codex RPC-feil"));
    else request.resolve(message.result);
  }

  rejectAll(error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  stop() {
    const running = this.process;
    this.process = null;
    this.ready = null;
    this.rejectAll(new Error("Codex app-server ble startet på nytt"));
    running?.kill();
  }
}

const codexClient = new CodexRpcClient();

async function readClaudeCredentials() {
  const args = ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"];
  const { stdout } = await execFileAsync("security", args, { maxBuffer: 1024 * 1024 });
  const raw = stdout.trim();
  let root;
  try {
    root = JSON.parse(raw);
  } catch {
    // `security -w` skriver hex når verdien ikke er ren tekst. Da er det ikke
    // påloggingen som mangler, det er formatet vi ikke leser.
    throw new Error(`Nøkkelringen ga ${raw.length} tegn som ikke er JSON`);
  }
  // En avbrutt innlogging etterlater feltene på plass med tom verdi. Det ser ut
  // som en ødelagt Nøkkelring, men betyr bare at ingen er logget inn — og det er
  // den beskjeden som fører Ole til riktig handling.
  if (!root?.claudeAiOauth?.accessToken || !root?.claudeAiOauth?.refreshToken) {
    const error = new Error(root?.claudeAiOauth
      ? "Ingen er logget inn i Claude på Mac-en"
      : "Fant ikke Claude-pålogging i Nøkkelring");
    error.code = "logged_out";
    throw error;
  }
  return root;
}

async function saveClaudeCredentials(root) {
  const account = process.env.USER || "Claude Code";
  await execFileAsync("security", [
    "add-generic-password", "-U", "-a", account, "-s", CLAUDE_KEYCHAIN_SERVICE, "-w", JSON.stringify(root),
  ], { maxBuffer: 1024 * 1024 });
}

// «400» alene sender en til å lete etter feil sted. Token-endepunktet sier selv
// hva det avviste, og forskjellen betyr alt: `invalid_grant` er en pålogging som
// må fornyes for hånd, mens resten er panelets egen forespørsel som er gal.
// Bare de to feltene slippes gjennom — aldri hele svarkroppen, som kan bære
// tokenverdier.
export async function claudeTokenError(response) {
  let code = null;
  let description = null;
  try {
    const body = await response.json();
    if (typeof body?.error === "string") code = body.error.slice(0, 80);
    if (typeof body?.error_description === "string") description = body.error_description.slice(0, 200);
  } catch {
    // Et svar uten JSON er like gyldig; da er statuskoden alt vi har.
  }
  const reason = description || code;
  const error = new Error(`Claude-pålogging kunne ikke fornyes (${response.status}${reason ? `: ${reason}` : ""})`);
  error.status = response.status;
  error.code = code;
  return error;
}

async function refreshClaudeCredentials(root) {
  const oauth = root.claudeAiOauth;
  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: oauth.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    }),
  });
  if (!response.ok) throw await claudeTokenError(response);
  const refreshed = await response.json();
  if (!refreshed.access_token) throw new Error("Claude returnerte ikke et nytt tilgangstoken");
  root.claudeAiOauth = {
    ...oauth,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? oauth.refreshToken,
    expiresAt: Date.now() + Number(refreshed.expires_in ?? 3600) * 1000,
    refreshTokenExpiresAt: refreshed.refresh_token_expires_in
      ? Date.now() + Number(refreshed.refresh_token_expires_in) * 1000
      : oauth.refreshTokenExpiresAt,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : oauth.scopes,
  };
  await saveClaudeCredentials(root);
  return root;
}

async function fetchClaudeUsage() {
  if (!cachedClaudeUsage) cachedClaudeUsage = await readCachedClaudeUsage();
  if (cachedClaudeUsage && Date.now() < nextClaudeFetchAt) return cachedClaudeUsage;
  let credentials = await readClaudeCredentials();
  if (Number(credentials.claudeAiOauth.expiresAt ?? 0) <= Date.now() + 30_000) {
    credentials = await refreshClaudeCredentials(credentials);
  }
  let response = await requestClaudeUsage(credentials.claudeAiOauth.accessToken);
  if (response.status === 401) {
    credentials = await refreshClaudeCredentials(credentials);
    response = await requestClaudeUsage(credentials.claudeAiOauth.accessToken);
  }
  if (response.status === 429) {
    nextClaudeFetchAt = Date.now() + retryDelayMs(response.headers.get("retry-after"));
    if (cachedClaudeUsage) return {
      ...cachedClaudeUsage,
      stale: true,
      warning: "Claude begrenset oppdateringsfrekvensen; viser siste bekreftede verdi",
    };
  }
  if (!response.ok) throw new Error(`Claude-bruk kunne ikke hentes (${response.status})`);
  const [rawUsage, todayTokens] = await Promise.all([response.json(), readClaudeTodayTokens()]);
  cachedClaudeUsage = {
    ...normalizeClaudeUsage(rawUsage, todayTokens),
    providerUpdatedAt: new Date().toISOString(),
    stale: false,
  };
  nextClaudeFetchAt = Date.now() + CLAUDE_MIN_REFRESH_MS;
  await saveCachedClaudeUsage(cachedClaudeUsage);
  return cachedClaudeUsage;
}

async function readCachedClaudeUsage() {
  try {
    const value = JSON.parse(await readFile(CLAUDE_CACHE_FILE, "utf8"));
    return value?.ok && Array.isArray(value.windows) ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function saveCachedClaudeUsage(value) {
  await mkdir(join(homedir(), "Library", "Caches", "ipad-control-center"), { recursive: true });
  await writeFile(CLAUDE_CACHE_FILE, JSON.stringify(value), { mode: 0o600 });
}

function retryDelayMs(value) {
  if (!value) return CLAUDE_MIN_REFRESH_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(CLAUDE_MIN_REFRESH_MS, seconds * 1000);
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return Math.max(CLAUDE_MIN_REFRESH_MS, date.getTime() - Date.now());
  return CLAUDE_MIN_REFRESH_MS;
}

function requestClaudeUsage(accessToken) {
  return fetch(CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "ipad-control-center/1.0",
    },
  });
}

async function captureProvider(load) {
  try { return await load(); }
  catch (error) { return { ok: false, error: errorMessage(error), code: error?.code ?? null }; }
}

// Reparasjonen må få lov til å gå forbi minuttsperren; den kjører bare når Ole
// selv har bedt om det, ikke på polling.
export function resetClaudeThrottle() {
  nextClaudeFetchAt = 0;
}

// En RPC-forbindelse som har stoppet opp blir stående død helt til noe river den
// ned: `ensureStarted()` ser bare på om prosessen lever, ikke om den svarer.
export function restartCodexClient() {
  codexClient.stop();
}

async function loadSnapshot() {
  const [codex, claude] = await Promise.all([
    captureProvider(async () => {
      const [rateLimits, usage] = await Promise.all([
        codexClient.request("account/rateLimits/read"),
        codexClient.request("account/usage/read"),
      ]);
      return normalizeCodexUsage(rateLimits, usage);
    }),
    captureProvider(fetchClaudeUsage),
  ]);
  return { updatedAt: new Date().toISOString(), codex, claude };
}

export async function getUsageSnapshot({ force = false } = {}) {
  if (!force && cachedSnapshot && Date.now() - cachedAt < CACHE_MS) return cachedSnapshot;
  if (inFlight) return inFlight;
  inFlight = loadSnapshot().then((snapshot) => {
    cachedSnapshot = snapshot;
    cachedAt = Date.now();
    return snapshot;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
