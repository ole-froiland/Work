import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const runCommand = promisify(execFile);
const STORE_FILE = join(homedir(), "Library", "Caches", "ipad-control-center", "spotify.json");
// Spotify godtar bare HTTPS eller en ren loopback-adresse. Innloggingen skjer
// derfor i nettleseren på Mac-en som kjører panelet, ikke på iPad-en.
const REDIRECT_URI = "http://127.0.0.1:4173/api/spotify/callback";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";
const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const AUTH_TTL_MS = 10 * 60_000;

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizeClientId(value) {
  const clientId = typeof value === "string" ? value.trim() : "";
  if (!clientId) return "";
  if (!/^[A-Za-z0-9]{16,64}$/.test(clientId)) throw new Error("Ugyldig Spotify Client ID");
  return clientId;
}

function normalizeDeviceId(value) {
  const deviceId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9]{16,120}$/.test(deviceId)) throw new Error("Ugyldig Spotify-enhet");
  return deviceId;
}

// Panelet viser et lite bilde. Minste bilde over 160 px holder seg skarpt uten
// å laste ned coveret i full oppløsning.
function pickArtwork(images) {
  const usable = (Array.isArray(images) ? images : []).filter((image) => typeof image?.url === "string");
  if (!usable.length) return null;
  const sorted = [...usable].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((image) => (image.width ?? 0) >= 160) ?? sorted.at(-1)).url;
}

function normalizeTrack(item) {
  if (!item) return null;
  const artists = Array.isArray(item.artists) ? item.artists.map((artist) => artist?.name).filter(Boolean) : [];
  return {
    id: item.id ?? null,
    title: item.name ?? "Ukjent spor",
    artist: artists.join(", ") || item.show?.name || "",
    album: item.album?.name ?? item.show?.name ?? "",
    artwork: pickArtwork(item.album?.images ?? item.images ?? item.show?.images),
    durationMs: Number(item.duration_ms) || 0,
  };
}

function normalizeDevice(device) {
  if (!device?.id) return null;
  return {
    id: device.id,
    name: device.name ?? "Ukjent enhet",
    type: device.type ?? "Unknown",
    isActive: Boolean(device.is_active),
    isRestricted: Boolean(device.is_restricted),
  };
}

function describeApiError(status, payload) {
  const reason = payload?.error?.reason;
  const message = payload?.error?.message;
  if (status === 401) return "Spotify avviste tilgangen. Koble til på nytt.";
  if (reason === "PREMIUM_REQUIRED") return "Spotify Premium kreves for å styre avspillingen";
  if (status === 404 || reason === "NO_ACTIVE_DEVICE") return "Ingen aktiv Spotify-enhet. Start musikken på en enhet først.";
  if (status === 429) return "Spotify begrenser forespørslene. Prøv igjen om litt.";
  return message ? `Spotify: ${message}` : `Spotify svarte ${status}`;
}

function createSpotifyService({
  fetchImpl = (...args) => fetch(...args),
  exec = runCommand,
  storeFile = STORE_FILE,
  redirectUri = REDIRECT_URI,
  envClientId = process.env.PANEL_SPOTIFY_CLIENT_ID ?? "",
  now = () => Date.now(),
} = {}) {
  let store = null;
  let accessToken = "";
  let accessExpiresAt = 0;
  let pendingAuth = null;

  async function loadStore() {
    if (store) return store;
    let saved = {};
    try {
      saved = JSON.parse(await readFile(storeFile, "utf8"));
    } catch {
      saved = {};
    }
    store = {
      clientId: typeof saved.clientId === "string" && saved.clientId ? saved.clientId : envClientId.trim(),
      refreshToken: typeof saved.refreshToken === "string" ? saved.refreshToken : "",
    };
    return store;
  }

  async function saveStore(changes) {
    const next = { ...(await loadStore()), ...changes };
    await mkdir(dirname(storeFile), { recursive: true });
    await writeFile(storeFile, JSON.stringify(next), { mode: 0o600 });
    store = next;
    return store;
  }

  async function requestTokens(params) {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error_description || payload?.error || `Spotify svarte ${response.status}`);
      error.code = payload?.error ?? String(response.status);
      throw error;
    }
    return payload;
  }

  async function applyTokens(payload) {
    const lifetime = Number(payload.expires_in);
    accessToken = payload.access_token ?? "";
    // Fornyer et minutt før utløp, slik at en kommando ikke treffer et dødt token.
    accessExpiresAt = now() + Math.max(0, (Number.isFinite(lifetime) ? lifetime : 3600) - 60) * 1000;
    if (payload.refresh_token) await saveStore({ refreshToken: payload.refresh_token });
  }

  async function ensureAccessToken() {
    const current = await loadStore();
    if (!current.clientId) throw new Error("Legg inn Spotify Client ID i panelinnstillingene");
    if (accessToken && accessExpiresAt > now()) return accessToken;
    if (!current.refreshToken) throw new Error("Koble panelet til Spotify");
    try {
      await applyTokens(await requestTokens({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: current.clientId,
      }));
    } catch (error) {
      accessToken = "";
      accessExpiresAt = 0;
      // Bare et avvist refresh-token betyr at brukeren må logge inn igjen.
      // Nettverksfeil skal ikke kaste bort en gyldig tilkobling.
      if (error.code === "invalid_grant") {
        await saveStore({ refreshToken: "" });
        throw new Error("Spotify-tilgangen er utløpt. Koble til på nytt.");
      }
      throw new Error(`Kunne ikke fornye Spotify-tilgangen (${error.message})`);
    }
    return accessToken;
  }

  async function api(path, { method = "GET", query, body } = {}) {
    const token = await ensureAccessToken();
    const url = new URL(`${API_URL}${path}`);
    if (query) url.search = new URLSearchParams(query).toString();
    const response = await fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 204 || response.status === 202) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        accessToken = "";
        accessExpiresAt = 0;
      }
      throw new Error(describeApiError(response.status, payload));
    }
    return payload;
  }

  async function beginAuth() {
    const current = await loadStore();
    if (!current.clientId) throw new Error("Legg inn Spotify Client ID i panelinnstillingene");
    const verifier = base64Url(randomBytes(64));
    const state = base64Url(randomBytes(16));
    pendingAuth = { verifier, state, createdAt: now() };
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: current.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: base64Url(createHash("sha256").update(verifier).digest()),
      scope: SCOPES,
      state,
    }).toString();
    return url.toString();
  }

  // Innloggingen må åpnes på Mac-en fordi callback-adressen er loopback der.
  // URL-en returneres også, slik at den kan åpnes manuelt hvis Mac-nettleseren
  // ikke kommer fram — den inneholder ingen hemmeligheter, bare Client ID,
  // state og PKCE-utfordringen. Verifikatoren blir igjen på Mac-en.
  async function authorizeOnMac() {
    const url = await beginAuth();
    await exec("open", [url]);
    return { command: "authorize", redirectUri, url };
  }

  async function completeAuth({ code, state, error } = {}) {
    if (error) {
      pendingAuth = null;
      throw new Error(`Spotify avbrøt innloggingen (${error})`);
    }
    if (!pendingAuth || !state || pendingAuth.state !== state) throw new Error("Innloggingen kunne ikke bekreftes. Start den på nytt fra panelet.");
    if (now() - pendingAuth.createdAt > AUTH_TTL_MS) {
      pendingAuth = null;
      throw new Error("Innloggingen tok for lang tid. Start den på nytt fra panelet.");
    }
    if (!code) throw new Error("Spotify sendte ingen kode");
    const { verifier } = pendingAuth;
    pendingAuth = null;
    const current = await loadStore();
    await applyTokens(await requestTokens({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: current.clientId,
    }));
    return { ok: true };
  }

  async function setClientId(value) {
    const clientId = normalizeClientId(value);
    const current = await loadStore();
    if (clientId === current.clientId) return { command: "configure", configured: Boolean(clientId) };
    accessToken = "";
    accessExpiresAt = 0;
    pendingAuth = null;
    // Et nytt Client ID gjør det gamle refresh-tokenet ubrukelig.
    await saveStore({ clientId, refreshToken: "" });
    return { command: "configure", configured: Boolean(clientId) };
  }

  async function disconnect() {
    accessToken = "";
    accessExpiresAt = 0;
    pendingAuth = null;
    await saveStore({ refreshToken: "" });
    return { command: "disconnect" };
  }

  async function getState() {
    const current = await loadStore();
    const base = {
      ok: true,
      configured: Boolean(current.clientId),
      authorized: Boolean(current.refreshToken),
      playing: false,
      track: null,
      device: null,
      progressMs: 0,
      shuffle: false,
      fetchedAt: new Date(now()).toISOString(),
      error: null,
    };
    if (!base.configured || !base.authorized) return base;
    try {
      const player = await api("/me/player", { query: { additional_types: "track,episode" } });
      if (!player) return base;
      return {
        ...base,
        playing: Boolean(player.is_playing),
        track: normalizeTrack(player.item),
        device: normalizeDevice(player.device),
        progressMs: Number(player.progress_ms) || 0,
        shuffle: Boolean(player.shuffle_state),
      };
    } catch (error) {
      const after = await loadStore();
      return { ...base, ok: false, authorized: Boolean(after.refreshToken), error: error.message };
    }
  }

  async function listDevices() {
    const payload = await api("/me/player/devices");
    return (payload?.devices ?? []).map(normalizeDevice).filter(Boolean);
  }

  const commands = {
    async play() {
      await api("/me/player/play", { method: "PUT" });
      return { command: "play" };
    },
    async pause() {
      await api("/me/player/pause", { method: "PUT" });
      return { command: "pause" };
    },
    async next() {
      await api("/me/player/next", { method: "POST" });
      return { command: "next" };
    },
    async previous() {
      await api("/me/player/previous", { method: "POST" });
      return { command: "previous" };
    },
    async transfer(payload) {
      const deviceId = normalizeDeviceId(payload?.deviceId);
      await api("/me/player", { method: "PUT", body: { device_ids: [deviceId], play: true } });
      return { command: "transfer", deviceId };
    },
    configure(payload) {
      return setClientId(payload?.clientId);
    },
    authorize() {
      return authorizeOnMac();
    },
    disconnect() {
      return disconnect();
    },
  };

  async function runCommandByName(command, payload) {
    if (typeof command !== "string" || !Object.hasOwn(commands, command)) throw new Error("Ukjent Spotify-kommando");
    return commands[command](payload);
  }

  return { getState, listDevices, runCommand: runCommandByName, completeAuth, beginAuth, redirectUri };
}

const service = createSpotifyService();

const getSpotifyState = () => service.getState();
const listSpotifyDevices = () => service.listDevices();
const runSpotifyCommand = (command, payload) => service.runCommand(command, payload);
const completeSpotifyAuth = (query) => service.completeAuth(query);
const spotifyRedirectUri = service.redirectUri;

export {
  createSpotifyService,
  getSpotifyState,
  listSpotifyDevices,
  runSpotifyCommand,
  completeSpotifyAuth,
  spotifyRedirectUri,
};
