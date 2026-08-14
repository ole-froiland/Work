import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSpotifyService } from "../server/spotify-service.mjs";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error("Ingen kropp");
      return body;
    },
  };
}

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "panel-spotify-"));
  try {
    return await run(join(directory, "spotify.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function playerPayload(overrides = {}) {
  return {
    is_playing: true,
    progress_ms: 42_000,
    shuffle_state: false,
    device: { id: "a".repeat(40), name: "Ole sin iPhone", type: "Smartphone", is_active: true, is_restricted: false },
    item: {
      id: "track-1",
      name: "Rondo",
      duration_ms: 214_000,
      artists: [{ name: "Sondre" }, { name: "Kari" }],
      album: {
        name: "Sommer",
        images: [
          { url: "https://i.scdn.co/large.jpg", width: 640 },
          { url: "https://i.scdn.co/medium.jpg", width: 300 },
          { url: "https://i.scdn.co/small.jpg", width: 64 },
        ],
      },
    },
    ...overrides,
  };
}

async function connectedService(storeFile, fetchImpl, options = {}) {
  const calls = [];
  const service = createSpotifyService({
    storeFile,
    envClientId: "",
    exec: async (command, args) => { calls.push([command, args]); },
    fetchImpl: async (url, init) => {
      calls.push([String(url), init?.method ?? "GET"]);
      return fetchImpl(String(url), init);
    },
    ...options,
  });
  await service.runCommand("configure", { clientId: "abc123def456ghi789jkl" });
  const authorizeUrl = await service.beginAuth();
  const state = new URL(authorizeUrl).searchParams.get("state");
  await service.completeAuth({ code: "code-1", state });
  return { service, calls, authorizeUrl };
}

test("viser at panelet mangler oppsett uten å spørre Spotify", async () => {
  await withStore(async (storeFile) => {
    const service = createSpotifyService({
      storeFile,
      envClientId: "",
      fetchImpl: async () => { throw new Error("skulle ikke kalt Spotify"); },
    });
    const state = await service.getState();
    assert.equal(state.configured, false);
    assert.equal(state.authorized, false);
    assert.equal(state.track, null);
    assert.equal(state.error, null);
  });
});

test("bygger en PKCE-innlogging og åpner den på Mac-en", async () => {
  await withStore(async (storeFile) => {
    const opened = [];
    const service = createSpotifyService({
      storeFile,
      envClientId: "",
      exec: async (command, args) => { opened.push([command, args]); },
      fetchImpl: async () => { throw new Error("skulle ikke kalt Spotify"); },
    });
    await service.runCommand("configure", { clientId: "abc123def456ghi789jkl" });
    const result = await service.runCommand("authorize");

    assert.equal(opened.length, 1);
    const [command, args] = opened[0];
    assert.equal(command, "open");
    // Samme adresse returneres, så den kan åpnes manuelt om Mac-en ikke svarer.
    assert.equal(result.url, args[0]);
    const url = new URL(args[0]);
    assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:4173/api/spotify/callback");
    assert.equal(url.searchParams.get("client_id"), "abc123def456ghi789jkl");
    assert.match(url.searchParams.get("scope"), /user-modify-playback-state/);
    assert.ok(url.searchParams.get("code_challenge"));
    assert.ok(url.searchParams.get("state"));
  });
});

test("avviser et Client ID med skalltegn", async () => {
  await withStore(async (storeFile) => {
    const service = createSpotifyService({ storeFile, envClientId: "", fetchImpl: async () => {} });
    await assert.rejects(() => service.runCommand("configure", { clientId: "abc; rm -rf /" }), /Ugyldig Spotify Client ID/);
  });
});

test("avviser en tilbakekalling med feil state", async () => {
  await withStore(async (storeFile) => {
    const service = createSpotifyService({ storeFile, envClientId: "", fetchImpl: async () => {} });
    await service.runCommand("configure", { clientId: "abc123def456ghi789jkl" });
    await service.beginAuth();
    await assert.rejects(() => service.completeAuth({ code: "kode", state: "feil" }), /kunne ikke bekreftes/);
  });
});

test("lagrer refresh-token med 0600 og normaliserer avspillingen", async () => {
  await withStore(async (storeFile) => {
    const { service } = await connectedService(storeFile, async (url) => {
      if (url.startsWith("https://accounts.spotify.com")) {
        return jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      return jsonResponse(200, playerPayload());
    });

    const saved = JSON.parse(await readFile(storeFile, "utf8"));
    assert.equal(saved.refreshToken, "refresh-1");

    const state = await service.getState();
    assert.equal(state.ok, true);
    assert.equal(state.authorized, true);
    assert.equal(state.playing, true);
    assert.equal(state.track.title, "Rondo");
    assert.equal(state.track.artist, "Sondre, Kari");
    assert.equal(state.track.durationMs, 214_000);
    assert.equal(state.track.artwork, "https://i.scdn.co/medium.jpg");
    assert.equal(state.device.name, "Ole sin iPhone");
    assert.equal(state.progressMs, 42_000);
    assert.equal(state.error, null);
  });
});

test("melder tomt spor når Spotify svarer 204", async () => {
  await withStore(async (storeFile) => {
    const { service } = await connectedService(storeFile, async (url) => {
      if (url.startsWith("https://accounts.spotify.com")) {
        return jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      return jsonResponse(204, undefined);
    });
    const state = await service.getState();
    assert.equal(state.ok, true);
    assert.equal(state.authorized, true);
    assert.equal(state.playing, false);
    assert.equal(state.track, null);
  });
});

test("styrer avspillingen på enheten Spotify er aktiv på", async () => {
  await withStore(async (storeFile) => {
    const { service, calls } = await connectedService(storeFile, async (url) => {
      if (url.startsWith("https://accounts.spotify.com")) {
        return jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      return jsonResponse(204, undefined);
    });

    await service.runCommand("next");
    assert.deepEqual(calls.at(-1), ["https://api.spotify.com/v1/me/player/next", "POST"]);
    await service.runCommand("previous");
    assert.deepEqual(calls.at(-1), ["https://api.spotify.com/v1/me/player/previous", "POST"]);
    await service.runCommand("pause");
    assert.deepEqual(calls.at(-1), ["https://api.spotify.com/v1/me/player/pause", "PUT"]);
    await service.runCommand("play");
    assert.deepEqual(calls.at(-1), ["https://api.spotify.com/v1/me/player/play", "PUT"]);
  });
});

test("flytter avspillingen til en annen enhet og avviser ugyldig enhet", async () => {
  await withStore(async (storeFile) => {
    const bodies = [];
    const { service } = await connectedService(storeFile, async (url, init) => {
      if (url.startsWith("https://accounts.spotify.com")) {
        return jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      bodies.push(init?.body);
      return jsonResponse(204, undefined);
    });

    await service.runCommand("transfer", { deviceId: "b".repeat(40) });
    assert.deepEqual(JSON.parse(bodies.at(-1)), { device_ids: ["b".repeat(40)], play: true });
    await assert.rejects(() => service.runCommand("transfer", { deviceId: "kort" }), /Ugyldig Spotify-enhet/);
  });
});

test("lister enhetene panelet kan spille på", async () => {
  await withStore(async (storeFile) => {
    const { service } = await connectedService(storeFile, async (url) => {
      if (url.startsWith("https://accounts.spotify.com")) {
        return jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      return jsonResponse(200, {
        devices: [
          { id: "a".repeat(40), name: "Ole sin iPhone", type: "Smartphone", is_active: true },
          { id: "b".repeat(40), name: "MacBook Air", type: "Computer", is_active: false },
          { name: "Uten id", type: "Speaker" },
        ],
      });
    });
    const devices = await service.listDevices();
    assert.equal(devices.length, 2);
    assert.deepEqual(devices.map((device) => device.name), ["Ole sin iPhone", "MacBook Air"]);
    assert.equal(devices[0].isActive, true);
  });
});

test("forklarer at styring krever Spotify Premium", async () => {
  await withStore(async (storeFile) => {
    const { service } = await connectedService(storeFile, async (url) => {
      if (url.startsWith("https://accounts.spotify.com")) {
        return jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      return jsonResponse(403, { error: { status: 403, message: "Player command failed", reason: "PREMIUM_REQUIRED" } });
    });
    await assert.rejects(() => service.runCommand("next"), /Spotify Premium/);
  });
});

test("forklarer at ingen enhet spiller", async () => {
  await withStore(async (storeFile) => {
    const { service } = await connectedService(storeFile, async (url) => {
      if (url.startsWith("https://accounts.spotify.com")) {
        return jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      return jsonResponse(404, { error: { status: 404, message: "Player command failed", reason: "NO_ACTIVE_DEVICE" } });
    });
    await assert.rejects(() => service.runCommand("play"), /Ingen aktiv Spotify-enhet/);
  });
});

test("beholder tilkoblingen ved nettverksfeil, men kobler fra ved avvist token", async () => {
  await withStore(async (storeFile) => {
    let tokenReply = jsonResponse(500, { error: "server_error", error_description: "Midlertidig feil" });
    const service = createSpotifyService({
      storeFile,
      envClientId: "",
      exec: async () => {},
      fetchImpl: async (url) => (String(url).startsWith("https://accounts.spotify.com") ? tokenReply : jsonResponse(204, undefined)),
      now: () => Date.now(),
    });
    await service.runCommand("configure", { clientId: "abc123def456ghi789jkl" });
    const authorizeUrl = await service.beginAuth();
    tokenReply = jsonResponse(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 0 });
    await service.completeAuth({ code: "kode", state: new URL(authorizeUrl).searchParams.get("state") });

    tokenReply = jsonResponse(500, { error: "server_error", error_description: "Midlertidig feil" });
    const flaky = await service.getState();
    assert.equal(flaky.ok, false);
    assert.equal(flaky.authorized, true);
    assert.match(flaky.error, /Kunne ikke fornye/);

    tokenReply = jsonResponse(400, { error: "invalid_grant", error_description: "Refresh token revoked" });
    const revoked = await service.getState();
    assert.equal(revoked.authorized, false);
    assert.match(revoked.error, /Koble til på nytt/);
    assert.equal(JSON.parse(await readFile(storeFile, "utf8")).refreshToken, "");
  });
});

test("avviser ukjente kommandoer", async () => {
  await withStore(async (storeFile) => {
    const service = createSpotifyService({ storeFile, envClientId: "", fetchImpl: async () => {} });
    await assert.rejects(() => service.runCommand("shutdown"), /Ukjent Spotify-kommando/);
    await assert.rejects(() => service.runCommand(undefined), /Ukjent Spotify-kommando/);
  });
});
