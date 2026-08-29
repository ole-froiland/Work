import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { isRepairableConnection, repairConnection } from "./server/connection-repair-service.mjs";
import { describeSyncPayload, getDeviceMetrics, updateDeviceMetrics } from "./server/device-metrics-service.mjs";
import { runMacAction } from "./server/mac-action-service.mjs";
import { getUsageSnapshot } from "./server/usage-service.mjs";
import { getAgentSessions } from "./server/agent-session-service.mjs";
import { getSyncCalendar, mutateMacAppleCalendar, updateSyncCalendar } from "./server/sync-calendar-service.mjs";
import { getDayPlan, markBlockDone, recordWake, saveTargetWake } from "./server/day-plan-service.mjs";
// Reglene for rytmen bor i dashboard.js sammen med resten av utregningene.
// Telefonen skal hente alarmtidene herfra og ikke ha sin egen kopi av dem.
import { alarmTimes, describeSleepRhythm } from "./src/dashboard.js";
import { completeSpotifyAuth, getSpotifyState, listSpotifyDevices, runSpotifyCommand } from "./server/spotify-service.mjs";
import {
  acknowledgeSyncNoteCommand,
  enqueueSyncNoteCommand,
  getSyncNotes,
  leaseSyncNoteCommands,
  updateSyncNotes,
} from "./server/sync-notes-service.mjs";

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function readJsonBody(request, maximumBytes = 32_768) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > maximumBytes) {
        settled = true;
        reject(new Error("Payload er for stor"));
      }
    });
    request.on("end", () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(body || "{}"));
      } catch {
        settled = true;
        reject(new Error("Ugyldig JSON"));
      }
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function setSyncCors(request, response) {
  const origin = request.headers.origin;
  const allowed = origin === "https://sync-co-op.netlify.app"
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? "")
    || /^http:\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin ?? "");
  if (allowed) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  return !origin || allowed;
}

function isSyncOrigin(request) {
  return request.headers.origin === "https://sync-co-op.netlify.app";
}

function usageApi() {
  return {
    name: "local-usage-api",
    configureServer(server) {
      server.middlewares.use("/api/usage", async (request, response) => {
        if (request.method !== "GET") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }
        try {
          const url = new URL(request.url ?? "/", "http://localhost");
          const snapshot = await getUsageSnapshot({ force: url.searchParams.get("refresh") === "1" });
          sendJson(response, 200, snapshot);
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

function agentSessionsApi() {
  return {
    name: "local-agent-sessions-api",
    configureServer(server) {
      server.middlewares.use("/api/agent-sessions", async (request, response) => {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        try {
          sendJson(response, 200, await getAgentSessions());
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

function deviceMetricsApi() {
  return {
    name: "local-device-metrics-api",
    configureServer(server) {
      server.middlewares.use("/api/device-metrics", async (request, response) => {
        try {
          if (request.method === "GET") {
            sendJson(response, 200, await getDeviceMetrics());
            return;
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request);
            // Uten denne linja er det ingen forskjell å se på «telefonen ringte
            // aldri» og «telefonen ringte og ble avvist». Verdiene logges ikke,
            // bare hvilke kilder som kom og hvor de kom fra.
            console.log(`[panel] synk fra ${request.socket.remoteAddress ?? "ukjent"}: ${describeSyncPayload(body)}`);
            sendJson(response, 200, await updateDeviceMetrics(body));
            return;
          }
          sendJson(response, 405, { error: "Method not allowed" });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Ukjent feil";
          if (request.method === "POST") console.log(`[panel] synk avvist fra ${request.socket.remoteAddress ?? "ukjent"}: ${reason}`);
          sendJson(response, 400, { error: reason });
        }
      });
    },
  };
}

function syncCalendarApi() {
  return {
    name: "local-sync-calendar-api",
    configureServer(server) {
      server.middlewares.use("/api/sync-calendar", async (request, response) => {
        if (!setSyncCors(request, response)) {
          sendJson(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          response.end();
          return;
        }
        try {
          if (request.method === "GET") {
            const url = new URL(request.url ?? "/", "http://localhost");
            sendJson(response, 200, await getSyncCalendar({ force: url.searchParams.get("force") === "1" }));
            return;
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request, 512_000);
            if (body.kind === "mutation") {
              sendJson(response, 200, await mutateMacAppleCalendar(body));
              return;
            }
            sendJson(response, 200, await updateSyncCalendar(body));
            return;
          }
          sendJson(response, 405, { error: "Method not allowed" });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

function dayPlanApi() {
  return {
    name: "local-day-plan-api",
    configureServer(server) {
      server.middlewares.use("/api/day-plan", async (request, response) => {
        if (!setSyncCors(request, response)) {
          sendJson(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          response.end();
          return;
        }
        try {
          if (request.method === "GET") {
            const now = new Date();
            const plan = await getDayPlan(now);
            const today = now.toISOString().slice(0, 10);
            const advance = plan.history?.targetWakeDate !== today;
            const rhythm = describeSleepRhythm({
              nights: plan.history?.nights ?? [],
              wakeAnchor: plan.template?.wakeAnchor ?? null,
              previousTarget: plan.history?.targetWake ?? null,
              advance,
            });
            if (!rhythm.learning && advance) await saveTargetWake(rhythm.targetWake, now);
            sendJson(response, 200, { ...plan, rhythm, alarms: rhythm.learning ? [] : alarmTimes(rhythm) });
            return;
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request, 32_768);
            if (body.kind === "done") {
              sendJson(response, 200, { wake: await markBlockDone(body, new Date()) });
              return;
            }
            sendJson(response, 200, { wake: await recordWake(body, new Date()) });
            return;
          }
          sendJson(response, 405, { error: "Method not allowed" });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

function syncNotesApi() {
  return {
    name: "local-sync-notes-api",
    configureServer(server) {
      server.middlewares.use("/api/sync-notes", async (request, response) => {
        if (!setSyncCors(request, response)) {
          sendJson(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          response.end();
          return;
        }
        try {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (request.method === "GET") {
            if (url.searchParams.get("commands") === "1") {
              if (!isSyncOrigin(request)) {
                sendJson(response, 403, { error: "Sync origin required" });
                return;
              }
              sendJson(response, 200, { commands: await leaseSyncNoteCommands() });
              return;
            }
            sendJson(response, 200, await getSyncNotes());
            return;
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request, 256_000);
            if (body.kind === "snapshot") {
              if (!isSyncOrigin(request)) {
                sendJson(response, 403, { error: "Sync origin required" });
                return;
              }
              sendJson(response, 200, await updateSyncNotes(body));
              return;
            }
            if (body.kind === "ack") {
              if (!isSyncOrigin(request)) {
                sendJson(response, 403, { error: "Sync origin required" });
                return;
              }
              sendJson(response, 200, await acknowledgeSyncNoteCommand(body.commandId));
              return;
            }
            if (body.kind === "command") {
              sendJson(response, 202, { command: await enqueueSyncNoteCommand(body) });
              return;
            }
            sendJson(response, 400, { error: "Ukjent notatmelding" });
            return;
          }
          sendJson(response, 405, { error: "Method not allowed" });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function sendAuthPage(response, status, title, message) {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e12;color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center}main{max-width:32rem;padding:2rem}h1{font-size:1.5rem;margin:0 0 .75rem}p{color:#8d97a3;line-height:1.6;margin:0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`);
}

function spotifyApi() {
  return {
    name: "local-spotify-api",
    configureServer(server) {
      server.middlewares.use("/api/spotify", async (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/callback") {
          try {
            await completeSpotifyAuth({
              code: url.searchParams.get("code"),
              state: url.searchParams.get("state"),
              error: url.searchParams.get("error"),
            });
            sendAuthPage(response, 200, "Spotify er koblet til", "Du kan lukke dette vinduet. Panelet viser nå avspillingen på alle enhetene dine.");
          } catch (error) {
            sendAuthPage(response, 400, "Innloggingen feilet", error instanceof Error ? error.message : "Ukjent feil");
          }
          return;
        }
        try {
          if (request.method === "GET") {
            if (url.searchParams.get("devices") === "1") {
              sendJson(response, 200, { ok: true, devices: await listSpotifyDevices() });
              return;
            }
            sendJson(response, 200, await getSpotifyState());
            return;
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request);
            sendJson(response, 200, { ok: true, ...(await runSpotifyCommand(body.command, body)) });
            return;
          }
          sendJson(response, 405, { ok: false, error: "Method not allowed" });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

function panelHelloApi() {
  return {
    name: "local-panel-hello-api",
    configureServer(server) {
      server.middlewares.use("/api/panel-hello", (request, response) => {
        // Netlify-siden må kunne spørre «kjører panelet her?» før den forlater
        // seg selv. Svaret er bare et ja — ingen data ligger i det — og derfor
        // kan hvilken som helst opprinnelse stille spørsmålet. Chrome regner
        // dette som en forespørsel inn i et privat nett og krever både en
        // preflight og «Allow-Private-Network» før den slipper den gjennom.
        response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Allow-Private-Network", "true");
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          response.end();
          return;
        }
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        sendJson(response, 200, { panel: true });
      });
    },
  };
}

function macActionApi() {
  return {
    name: "local-mac-action-api",
    configureServer(server) {
      server.middlewares.use("/api/mac-action", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          sendJson(response, 200, { ok: true, ...(await runMacAction(body.action, { payload: body })) });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

function connectionRepairApi() {
  return {
    name: "local-connection-repair-api",
    configureServer(server) {
      server.middlewares.use("/api/connections/repair", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          if (!isRepairableConnection(body.id)) {
            sendJson(response, 400, { ok: false, error: "Ukjent tilkobling" });
            return;
          }
          sendJson(response, 200, await repairConnection(body.id));
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "Ukjent feil" });
        }
      });
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    // «::» tar både IPv6 og IPv4. Med «0.0.0.0» lyttet serveren bare på IPv4,
    // mens Mac-en annonserer Ole-sin-MacBook-Air.local med IPv6-adresser i
    // tillegg — og iPad-en velger IPv6 først. Da traff den en port ingen satt på,
    // og en app lagt til på Hjem-skjermen viser blank hvit skjerm i stedet for
    // en feilside. Derav fristelsen til å hardkode IPv4-adressen i stedet.
    host: "::",
    port: 4173,
    strictPort: true,
    // Nettlesere sender verten med små bokstaver, men Vite sammenligner tegn for
    // tegn — og resten av prosjektet skriver navnet med stor forbokstav. Begge
    // skrivemåtene står her, så en klient som ikke normaliserer ikke blir avvist.
    // «.ts.net» slipper inn hele tailnettet. Tailscale-navnet er det eneste som
    // svarer likt hjemme, på hotspot og på mobildata, og det er ikke kjent før
    // Mac-en er logget inn — derfor domenet og ikke ett hardkodet vertsnavn.
    allowedHosts: ["terminal.local", "ole-sin-macbook-air.local", "Ole-sin-MacBook-Air.local", ".ts.net"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [usageApi(), agentSessionsApi(), deviceMetricsApi(), syncCalendarApi(), syncNotesApi(), dayPlanApi(), spotifyApi(), panelHelloApi(), macActionApi(), connectionRepairApi(), react()],
});
