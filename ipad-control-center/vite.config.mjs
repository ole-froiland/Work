import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getDeviceMetrics, updateDeviceMetrics } from "./server/device-metrics-service.mjs";
import { runMacAction } from "./server/mac-action-service.mjs";
import { getUsageSnapshot } from "./server/usage-service.mjs";
import { getSyncCalendar, mutateMacAppleCalendar, updateSyncCalendar } from "./server/sync-calendar-service.mjs";
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
            sendJson(response, 200, await updateDeviceMetrics(await readJsonBody(request)));
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
            sendJson(response, 200, await getSyncCalendar());
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

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: ["terminal.local", "ole-sin-macbook-air.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [usageApi(), deviceMetricsApi(), syncCalendarApi(), syncNotesApi(), macActionApi(), react()],
});
