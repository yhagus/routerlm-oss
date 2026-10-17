// Load-test harness for router overhead under concurrent streams.
//
// The harness starts three parts:
//   1. A mock Provider (child process) that streams OpenAI SSE with a set delay per chunk.
//   2. The real backend (`src/main.ts`, child process) on a free port with a temporary DATA_DIR.
//   3. A load generator (this process) that opens streams at a set rate up to a concurrency cap.
//
// Run it from the backend workspace:
//   bun run loadtest -- --streams 200 --rps 20 --duration 20
// Run `bun run loadtest -- --help` for all options. `bun test` does not load this file.

import { mkdirSync, mkdtempSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../src/db/migrate";

const BACKEND_DIR = join(import.meta.dir, "..");
const MODEL = "load-model";
const DASHBOARD_PATHS = [
  "/api/usage/dashboard?period=7d",
  "/api/usage/chart?period=7d",
  "/api/usage/stats?period=7d",
  "/api/usage/overview",
  "/api/usage/request-details?page=1&pageSize=20",
  "/api/usage/providers",
];

function dashboardPaths(period: string | null): string[] {
  if (!period) return DASHBOARD_PATHS;
  return [
    `/api/usage/dashboard?period=${period}`,
    `/api/usage/chart?period=${period}`,
    `/api/usage/stats?period=${period}`,
    `/api/usage/overview?period=${period}`,
    `/api/usage/trend?by=model&period=${period}`,
    `/api/usage/by-provider?period=${period}`,
  ];
}

const HELP = `Usage: bun run loadtest -- [options]

  --streams <n>          Maximum concurrent streams (default 200)
  --rps <n>              New stream requests per second (default 20)
  --duration <s>         Seconds to open new streams (default 20)
  --chunk-delay <ms>     Mock delay between SSE chunks (default 50)
  --first-byte <ms>      Mock delay before the first SSE chunk (default 200)
  --chunks <n>           SSE chunks per stream (default: streams / rps seconds of chunks)
  --chunk-bytes <n>      Extra padding characters per SSE chunk (default 0)
  --client-read-delay <ms>  Slow client: a raw TCP reader pauses this long after each socket read (default 0)
  --dashboard-rps <n>    Usage dashboard requests per second during the run (default 0 = off)
  --seed-usage <n>       Usage rows to insert before the server starts, spread over 30 days (default 0)
  --dashboard-period <p> Period for the dashboard requests, e.g. all (default: the 7d mix)
  --usage-retention-days <n>  Set settings.usageRetentionDays and run the retention job before the load phase
  --connections <n>      Provider Connections to create (default 1)
  --server-max-http <n>  BUN_CONFIG_MAX_HTTP_REQUESTS for the server (default: Bun default, 256)
  --max-in-flight <n>    Server global in-flight cap, settings.maxInFlightRequests (default: server default)
  --server-cpus <list>   Linux only: pin the server to these CPUs with taskset, e.g. 0,1 (default: no pinning)
  --json                 Print the result as one JSON line
  --keep                 Keep the temporary data directory and server log
`;

type Options = {
  streams: number;
  rps: number;
  duration: number;
  chunkDelay: number;
  firstByte: number;
  chunks: number;
  chunkBytes: number;
  clientReadDelay: number;
  dashboardRps: number;
  seedUsage: number;
  dashboardPeriod: string | null;
  usageRetentionDays: number | null;
  connections: number;
  serverMaxHttp: number | null;
  maxInFlight: number | null;
  serverCpus: string | null;
  json: boolean;
  keep: boolean;
};

function parseArgs(argv: string[]): { role: string; options: Options } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) flags.add(name);
    else { values.set(name, next); index += 1; }
  }
  if (flags.has("help")) { console.log(HELP); process.exit(0); }
  const number = (name: string, fallback: number) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} must be a number >= 0; received "${raw}"`);
    return parsed;
  };
  const streams = number("streams", 200);
  const rps = number("rps", 20);
  const chunkDelay = number("chunk-delay", 50);
  const defaultChunks = Math.max(1, Math.round(((streams / Math.max(rps, 1)) * 1000) / Math.max(chunkDelay, 1)));
  return {
    role: values.get("role") || "run",
    options: {
      streams,
      rps,
      duration: number("duration", 20),
      chunkDelay,
      firstByte: number("first-byte", 200),
      chunks: Math.max(1, Math.round(number("chunks", defaultChunks))),
      chunkBytes: Math.round(number("chunk-bytes", 0)),
      clientReadDelay: number("client-read-delay", 0),
      dashboardRps: number("dashboard-rps", 0),
      seedUsage: Math.round(number("seed-usage", 0)),
      dashboardPeriod: values.get("dashboard-period") || null,
      usageRetentionDays: values.has("usage-retention-days") ? Math.round(number("usage-retention-days", 0)) : null,
      connections: Math.max(1, Math.round(number("connections", 1))),
      serverMaxHttp: values.has("server-max-http") ? number("server-max-http", 256) : null,
      maxInFlight: values.has("max-in-flight") ? Math.round(number("max-in-flight", 0)) : null,
      serverCpus: values.get("server-cpus") || null,
      json: flags.has("json"),
      keep: flags.has("keep"),
    },
  };
}

// ---------------------------------------------------------------------------
// Mock Provider (runs in its own process so its timers do not skew client timing)

function runMockProvider(options: Options) {
  const encoder = new TextEncoder();
  const stats = { chatRequests: 0, refreshCalls: 0, activeStreams: 0, peakStreams: 0, cancelledStreams: 0 };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const padding = "x".repeat(options.chunkBytes);
  const frame = (id: string, delta: Record<string, unknown>, finish: string | null, usage?: Record<string, number>) =>
    encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/__stats") return Response.json(stats);
      // Count any OAuth token call so later tickets can check refresh behavior.
      if (/token|refresh/i.test(url.pathname)) {
        stats.refreshCalls += 1;
        return Response.json({ access_token: `access-${stats.refreshCalls}`, refresh_token: `refresh-${stats.refreshCalls}`, expires_in: 3600, token_type: "Bearer" });
      }
      if (url.pathname.endsWith("/chat/completions") && request.method === "POST") {
        stats.chatRequests += 1;
        const body = await request.json().catch(() => ({})) as { stream?: boolean };
        const id = `chatcmpl-${stats.chatRequests}`;
        if (body.stream === false) {
          await sleep(options.firstByte);
          return Response.json({ id, object: "chat.completion", model: MODEL, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 } });
        }
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            stats.activeStreams += 1;
            stats.peakStreams = Math.max(stats.peakStreams, stats.activeStreams);
            try {
              await sleep(options.firstByte);
              for (let index = 0; index < options.chunks && !cancelled; index += 1) {
                if (index > 0) await sleep(options.chunkDelay);
                if (cancelled) break;
                controller.enqueue(frame(id, index === 0 ? { role: "assistant", content: `tok ${padding}` } : { content: `tok ${padding}` }, null));
              }
              if (!cancelled) {
                controller.enqueue(frame(id, {}, "stop", { prompt_tokens: 8, completion_tokens: options.chunks, total_tokens: 8 + options.chunks }));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              }
            } catch {
              // The client went away while the mock wrote a chunk.
            } finally {
              stats.activeStreams -= 1;
            }
          },
          cancel() {
            cancelled = true;
            stats.cancelledStreams += 1;
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }
      return Response.json({ error: { message: `mock: no route for ${request.method} ${url.pathname}` } }, { status: 404 });
    },
  });
  console.log(JSON.stringify({ mockPort: server.port }));
}

// ---------------------------------------------------------------------------
// Helpers

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 10) / 10;
}

async function freePort() {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);
  return port;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
}

async function readFirstLine(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  return text.split("\n")[0];
}

function seedUsage(databasePath: string, rows: number) {
  mkdirSync(databasePath.slice(0, databasePath.lastIndexOf("/")), { recursive: true });
  const sqlite = new Database(databasePath);
  applyMigrations(sqlite);
  const insert = sqlite.query("INSERT INTO usageHistory (timestamp, provider, model, connectionId, apiKey, endpoint, clientIp, promptTokens, completionTokens, cost, status, tokens, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const now = Date.now();
  const spanMs = 30 * 24 * 3600 * 1000;
  sqlite.transaction(() => {
    for (let index = 0; index < rows; index += 1) {
      const prompt = 100 + (index % 900);
      const completion = 20 + (index % 300);
      insert.run(new Date(now - Math.floor((index / rows) * spanMs)).toISOString(), "openai", MODEL, `seed-conn-${index % 5}`, null, "/v1/chat/completions", "127.0.0.1", prompt, completion, 0.0001, "200", JSON.stringify({ prompt_tokens: prompt, completion_tokens: completion }), "{}");
    }
  })();
  sqlite.close();
}

// ---------------------------------------------------------------------------
// Run

async function run(options: Options) {
  const workDir = mkdtempSync(join(tmpdir(), "lobakai-loadtest-"));
  const dataDir = join(workDir, "data");
  const databasePath = join(dataDir, "db", "data.sqlite");
  const logPath = join(workDir, "server.log");
  const children: Array<ReturnType<typeof Bun.spawn>> = [];
  const cleanup = () => {
    for (const child of children) { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
  };
  process.once("SIGINT", () => { cleanup(); process.exit(130); });

  try {
    if (options.seedUsage > 0) seedUsage(databasePath, options.seedUsage);

    const mock = Bun.spawn(["bun", import.meta.path, "--role", "mock", "--chunk-delay", String(options.chunkDelay), "--first-byte", String(options.firstByte), "--chunks", String(options.chunks), "--chunk-bytes", String(options.chunkBytes)], { stdout: "pipe", stderr: "inherit" });
    children.push(mock);
    const mockPort = Number(JSON.parse(await readFirstLine(mock.stdout as ReadableStream<Uint8Array>)).mockPort);
    const mockUrl = `http://127.0.0.1:${mockPort}`;

    const port = await freePort();
    const serverUrl = `http://127.0.0.1:${port}`;
    const serverEnv: Record<string, string> = { ...process.env as Record<string, string>, BACKEND_HOST: "127.0.0.1", BACKEND_PORT: String(port), DATA_DIR: dataDir, BACKEND_DATABASE_PATH: databasePath, REQUIRE_LOGIN: "false", REQUIRE_API_KEY: "false" };
    // The load generator raises its own fetch cap. The server keeps the Bun default unless the operator sets it.
    delete serverEnv.BUN_CONFIG_MAX_HTTP_REQUESTS;
    if (options.serverMaxHttp !== null) serverEnv.BUN_CONFIG_MAX_HTTP_REQUESTS = String(options.serverMaxHttp);
    const logFd = openSync(logPath, "w");
    const serverCommand = ["bun", "run", "src/main.ts"];
    if (options.serverCpus !== null) serverCommand.unshift("taskset", "-c", options.serverCpus);
    const server = Bun.spawn(serverCommand, { cwd: BACKEND_DIR, env: serverEnv, stdout: logFd, stderr: logFd });
    children.push(server);
    closeSync(logFd);
    await waitFor(async () => (await fetch(`${serverUrl}/api/health`)).ok, 30_000, "the backend to start");

    for (let index = 0; index < options.connections; index += 1) {
      const created = await fetch(`${serverUrl}/api/providers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", name: `Load ${index + 1}`, apiKey: `mock-key-${index + 1}`, baseUrl: mockUrl, data: { models: [MODEL] } }),
      });
      if (created.status !== 201) throw new Error(`Connection setup failed: ${created.status} ${await created.text()}`);
    }

    if (options.maxInFlight !== null) {
      const patched = await fetch(`${serverUrl}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxInFlightRequests: options.maxInFlight }) });
      if (patched.status !== 200) throw new Error(`Settings setup failed: ${patched.status} ${await patched.text()}`);
    }

    let retention: { moved: number; cutoff: string | null; runMs: number } | null = null;
    if (options.usageRetentionDays !== null) {
      const patched = await fetch(`${serverUrl}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ usageRetentionDays: options.usageRetentionDays }) });
      if (patched.status !== 200) throw new Error(`Settings setup failed: ${patched.status} ${await patched.text()}`);
      const begin = performance.now();
      const ran = await fetch(`${serverUrl}/api/usage/retention/run`, { method: "POST" });
      if (ran.status !== 200) throw new Error(`Retention run failed: ${ran.status} ${await ran.text()}`);
      const body = await ran.json() as { moved: number; cutoff: string | null };
      retention = { moved: body.moved, cutoff: body.cutoff, runMs: Math.round(performance.now() - begin) };
    }

    const chatBody = JSON.stringify({ model: `openai/${MODEL}`, stream: true, messages: [{ role: "user", content: "load test" }] });
    const warmup = await fetch(`${serverUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: chatBody });
    const warmupText = await warmup.text();
    if (warmup.status !== 200 || !warmupText.includes("[DONE]")) throw new Error(`Warm-up request failed: ${warmup.status} ${warmupText.slice(0, 300)}`);
    const mockBaseline = await (await fetch(`${mockUrl}/__stats`)).json() as { refreshCalls: number; chatRequests: number };

    await fetch(`${serverUrl}/api/usage/runtime-stats/reset`, { method: "POST" });

    // Load phase
    const statusCounts: Record<string, number> = {};
    const dashboardStatus: Record<string, number> = {};
    const ttfbOverhead: number[] = [];
    const rejectLatency: number[] = [];
    const streamDurations: number[] = [];
    const dashboardLatency: number[] = [];
    let inFlight = 0;
    let peakInFlight = 0;
    let started = 0;
    let skipped = 0;
    let incomplete = 0;
    let peakRssBytes = 0;
    const pending = new Set<Promise<void>>();
    const count = (bucket: Record<string, number>, key: string) => { bucket[key] = (bucket[key] || 0) + 1; };

    // Slow client: a raw TCP reader that pauses after each socket read, so
    // kernel buffers fill and the server must stop writing (or buffer).
    // `fetch` cannot model this: it reads the socket eagerly.
    const slowStream = (begin: number) => new Promise<void>((resolve) => {
      const url = new URL(serverUrl);
      const socket = connect({ host: url.hostname, port: Number(url.port) });
      let head = "";
      let status = "";
      let tail = "";
      let first = true;
      let sawDone = false;
      socket.on("connect", () => {
        socket.write(`POST /v1/chat/completions HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(chatBody)}\r\nConnection: close\r\n\r\n${chatBody}`);
      });
      socket.on("data", (data: Buffer) => {
        const text = data.toString("latin1");
        if (first) {
          head += text;
          const match = !status && head.match(/^HTTP\/1\.1 (\d+)/);
          if (match) status = match[1];
        }
        if (first && status === "200" && head.includes("\r\n\r\n") && head.slice(head.indexOf("\r\n\r\n") + 4).includes("data:")) {
          ttfbOverhead.push(performance.now() - begin - options.firstByte);
          first = false;
        }
        tail = (tail + text).slice(-256);
        if (tail.includes("[DONE]")) sawDone = true;
        socket.pause();
        setTimeout(() => socket.resume(), options.clientReadDelay);
      });
      const done = () => {
        count(statusCounts, status || "error:socket");
        if (status === "200") {
          streamDurations.push(performance.now() - begin);
          if (!sawDone) incomplete += 1;
        }
        resolve();
      };
      socket.once("close", done);
      socket.on("error", () => { /* close follows */ });
    });

    const openStream = async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      const begin = performance.now();
      if (options.clientReadDelay > 0) {
        try { await slowStream(begin); } finally { inFlight -= 1; }
        return;
      }
      try {
        const response = await fetch(`${serverUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: chatBody });
        count(statusCounts, String(response.status));
        if (response.status !== 200) {
          await response.arrayBuffer();
          rejectLatency.push(performance.now() - begin);
          return;
        }
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let first = true;
        let tail = "";
        let sawDone = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (first && response.status === 200) {
            ttfbOverhead.push(performance.now() - begin - options.firstByte);
            first = false;
          }
          tail = (tail + decoder.decode(value, { stream: true })).slice(-64);
          if (tail.includes("[DONE]")) sawDone = true;
        }
        if (response.status === 200) {
          streamDurations.push(performance.now() - begin);
          if (!sawDone) incomplete += 1;
        }
      } catch (error) {
        count(statusCounts, `error:${error instanceof Error ? error.name : "unknown"}`);
      } finally {
        inFlight -= 1;
      }
    };

    const track = (promise: Promise<void>) => {
      pending.add(promise);
      promise.finally(() => pending.delete(promise));
    };

    const sampleServer = async () => {
      try {
        const snapshot = await (await fetch(`${serverUrl}/api/usage/runtime-stats`)).json() as { memory: { rssBytes: number; peakRssBytes: number } };
        peakRssBytes = Math.max(peakRssBytes, snapshot.memory.rssBytes, snapshot.memory.peakRssBytes);
      } catch { /* the next sample retries */ }
    };
    const sampler = setInterval(sampleServer, 1000);

    let dashboardTimer: ReturnType<typeof setInterval> | null = null;
    let dashboardIndex = 0;
    if (options.dashboardRps > 0) {
      dashboardTimer = setInterval(() => {
        const paths = dashboardPaths(options.dashboardPeriod);
        const path = paths[dashboardIndex++ % paths.length];
        const begin = performance.now();
        track(fetch(`${serverUrl}${path}`).then(async (response) => {
          await response.arrayBuffer();
          dashboardLatency.push(performance.now() - begin);
          count(dashboardStatus, String(response.status));
        }, () => count(dashboardStatus, "error")));
      }, 1000 / options.dashboardRps);
    }

    const loadStart = performance.now();
    const loadEndAt = loadStart + options.duration * 1000;
    while (performance.now() < loadEndAt) {
      const due = Math.floor(((performance.now() - loadStart) / 1000) * options.rps) + 1;
      while (started + skipped < due) {
        if (inFlight >= options.streams) { skipped += 1; continue; }
        started += 1;
        track(openStream());
      }
      await Bun.sleep(5);
    }
    if (dashboardTimer) clearInterval(dashboardTimer);

    const drainMs = options.firstByte + options.chunks * (options.chunkDelay + options.clientReadDelay) + 30_000;
    await Promise.race([Promise.allSettled([...pending]), Bun.sleep(drainMs)]);
    clearInterval(sampler);
    await sampleServer();

    const runtimeStats = await (await fetch(`${serverUrl}/api/usage/runtime-stats`)).json() as {
      eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; samples: number };
      slowQueries: { thresholdMs: number | null; count: number };
    };
    const mockStats = await (await fetch(`${mockUrl}/__stats`)).json() as { refreshCalls: number; chatRequests: number; peakStreams: number };
    const serverLog = await Bun.file(logPath).text();

    const result = {
      input: { streams: options.streams, rps: options.rps, durationSec: options.duration, chunkDelayMs: options.chunkDelay, firstByteMs: options.firstByte, chunksPerStream: options.chunks, chunkBytes: options.chunkBytes, clientReadDelayMs: options.clientReadDelay, dashboardRps: options.dashboardRps, seedUsageRows: options.seedUsage, dashboardPeriod: options.dashboardPeriod, usageRetentionDays: options.usageRetentionDays, connections: options.connections, serverMaxHttp: options.serverMaxHttp, maxInFlight: options.maxInFlight, serverCpus: options.serverCpus },
      eventLoopLagMs: { p50: runtimeStats.eventLoop.p50Ms, p99: runtimeStats.eventLoop.p99Ms, max: runtimeStats.eventLoop.maxMs },
      ttfbOverheadMs: { p50: percentile(ttfbOverhead, 50), p99: percentile(ttfbOverhead, 99), max: percentile(ttfbOverhead, 100) },
      streamDurationMs: { p50: percentile(streamDurations, 50), p99: percentile(streamDurations, 99) },
      rejectLatencyMs: { count: rejectLatency.length, p50: percentile(rejectLatency, 50), p99: percentile(rejectLatency, 99) },
      peakRssMb: Math.round(peakRssBytes / 1024 / 1024),
      retention,
      responses: statusCounts,
      started,
      skippedAtCap: skipped,
      incompleteStreams: incomplete,
      unfinishedAtExit: inFlight,
      peakInFlight,
      mock: { refreshCalls: mockStats.refreshCalls - mockBaseline.refreshCalls, chatRequests: mockStats.chatRequests - mockBaseline.chatRequests, peakStreams: mockStats.peakStreams },
      dashboard: options.dashboardRps > 0 ? { responses: dashboardStatus, latencyMs: { p50: percentile(dashboardLatency, 50), p99: percentile(dashboardLatency, 99) } } : null,
      slowQueries: { thresholdMs: runtimeStats.slowQueries.thresholdMs, count: runtimeStats.slowQueries.count, logLines: serverLog.split("\n").filter((line) => line.startsWith("[SQLite] slow query")).length },
    };

    if (options.json) console.log(JSON.stringify(result));
    else printReport(result);
    if (options.keep) console.log(`Kept ${workDir}`);
  } finally {
    cleanup();
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

function printReport(result: Record<string, any>) {
  const rows: Array<[string, string]> = [
    ["input", JSON.stringify(result.input)],
    ["event-loop lag p99 / max (ms)", `${result.eventLoopLagMs.p99} / ${result.eventLoopLagMs.max}`],
    ["router TTFB overhead p50 / p99 / max (ms)", `${result.ttfbOverheadMs.p50} / ${result.ttfbOverheadMs.p99} / ${result.ttfbOverheadMs.max}`],
    ["stream duration p50 / p99 (ms)", `${result.streamDurationMs.p50} / ${result.streamDurationMs.p99}`],
    ["non-200 latency count / p50 / p99 (ms)", `${result.rejectLatencyMs.count} / ${result.rejectLatencyMs.p50} / ${result.rejectLatencyMs.p99}`],
    ["peak RSS (MB)", String(result.peakRssMb)],
    ["responses by status", JSON.stringify(result.responses)],
    ["started / skipped at cap", `${result.started} / ${result.skippedAtCap}`],
    ["streams without [DONE] / unfinished at exit", `${result.incompleteStreams} / ${result.unfinishedAtExit}`],
    ["peak in-flight (client / mock)", `${result.peakInFlight} / ${result.mock.peakStreams}`],
    ["mock refresh calls", String(result.mock.refreshCalls)],
    ["slow queries (count / log lines)", `${result.slowQueries.count} / ${result.slowQueries.logLines} (threshold ${result.slowQueries.thresholdMs} ms)`],
  ];
  if (result.retention) rows.push(["retention moved rows / run (ms)", `${result.retention.moved} / ${result.retention.runMs} (cutoff ${result.retention.cutoff})`]);
  if (result.dashboard) rows.push(["dashboard p50 / p99 (ms)", `${result.dashboard.latencyMs.p50} / ${result.dashboard.latencyMs.p99} ${JSON.stringify(result.dashboard.responses)}`]);
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.log(`${label.padEnd(width)}  ${value}`);
}

const { role, options } = parseArgs(process.argv.slice(2));
if (role === "mock") runMockProvider(options);
else await run(options);
