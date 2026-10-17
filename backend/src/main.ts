import { createApp } from "./app";
import { loadRuntimeConfig } from "./config";
import { createRuntime } from "./runtime";
import { initializeApp, shutdownAppInit } from "./services/platform/appInit";
import { setShutdownHandler } from "./services/platform/shutdown";

const config = loadRuntimeConfig();
const runtime = await createRuntime(config);
const app = createApp(runtime);
// v1 layout bootstrap: auto-resume tunnel/tailscale/MITM + watchdogs.
initializeApp(runtime);
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  // SSE/streaming responses can have long gaps between data frames (model
  // thinking time, token generation latency). Bun's default idleTimeout is
  // 10s which kills these connections mid-stream. Set to 5 minutes to match
  // typical upstream SSE keepalive windows.
  idleTimeout: 255,
});

console.log(`[Backend] Listening on ${server.url}`);

let stopping = false;
async function stop(reason: string) {
  if (stopping) return;
  stopping = true;

  console.log(`[Backend] ${reason}; shutting down`);
  // Order: stop the server, stop schedulers, then runtime.close() flushes
  // Usage and request details and closes SQLite. Exit only after that.
  let exitCode = 0;
  try {
    await server.stop();
    shutdownAppInit();
    runtime.close();
  } catch (error) {
    console.error("[Backend] Shutdown failed:", error);
    exitCode = 1;
  }
  process.exit(exitCode);
}

// This module owns the process shutdown: the signals and every in-app
// request (update, shutdown routes) run the same stop(). No other module may
// exit.
process.once("SIGINT", (signal) => stop(`Received ${signal}`));
process.once("SIGTERM", (signal) => stop(`Received ${signal}`));
setShutdownHandler((reason) => stop(`Shutdown requested (${reason})`));
