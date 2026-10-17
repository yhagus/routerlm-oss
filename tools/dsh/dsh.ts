#!/usr/bin/env node
// dsh.ts — standalone DeepSeek Harness client extracted from lobakai.
//
// Zero dependencies. Runs with `node dsh.ts` (Node >= 22.18 strips types) or `bun dsh.ts`.
//
// Sources of truth in lobakai:
//   auth      backend/src/services/providers/oauth/providers/deepseek-harness.ts
//   headers   backend/src/services/providers/deepseekHarnessPlatform.ts
//             backend/src/services/chat/executors/default.ts (deepseekHarnessHeaders)
//   body      backend/src/services/chat/translator/formats/claude.ts (prepareClaudeRequest)
//             backend/src/services/chat/translator/concerns/thinkingUnified.ts
//   balance   backend/src/services/billing/usage/deepseek-harness.ts

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

const PLATFORM_ORIGIN = "https://platform.deepseek.com";
const AUTH_INIT_URL = `${PLATFORM_ORIGIN}/auth-api/v0/dsh/auth_init`;
const AUTH_EXCHANGE_URL = `${PLATFORM_ORIGIN}/auth-api/v0/dsh/auth_exchange`;
const SUMMARY_URL = `${PLATFORM_ORIGIN}/api/v0/users/get_user_summary`;
const MESSAGES_URL = process.env.DSH_MESSAGES_URL || "https://api.deepseek.com/anthropic/v1/messages";

const CLIENT_VERSION = "0.2.1-alpha.2";
const USER_AGENT = `deepseek-harness/${CLIENT_VERSION} (+https://github.com/deepseek-ai/deepseek-harness)`;
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT = 256000;
const DEFAULT_MODEL = "deepseek-v4-pro";
const MODELS = [
  { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

const CONFIG_DIR = process.env.DSH_CONFIG_DIR || path.join(os.homedir(), ".config", "dsh");
const AUTH_FILE = path.join(CONFIG_DIR, "auth.json");

// ---------------------------------------------------------------- args

type Args = { _: string[]; [k: string]: any };

// Flags that never take a value, so `--show-thinking "hi"` keeps "hi" as the prompt.
const BOOL_FLAGS = new Set(["show-thinking", "json", "print", "help", "stream", "thinking", "open"]);

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--no-")) { out[a.slice(5)] = false; continue; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (BOOL_FLAGS.has(a.slice(2)) || next === undefined || next.startsWith("-")) out[a.slice(2)] = true;
      else { out[a.slice(2)] = next; i++; }
      continue;
    }
    if (a === "-m" || a === "-s" || a === "-t") {
      const key = { "-m": "model", "-s": "system", "-t": "token" }[a]!;
      out[key] = argv[++i];
      continue;
    }
    if (a === "-h") { out.help = true; continue; }
    out._.push(a);
  }
  return out;
}

const HELP = `dsh — DeepSeek Harness standalone client

Usage:
  node dsh.ts login [--port 20130] [--no-open]     Browser login, saves token to ${AUTH_FILE}
  node dsh.ts chat [prompt...] [options]           One-shot chat (or REPL when no prompt and stdin is a TTY)
  node dsh.ts serve [--port 8787] [--host 127.0.0.1]  Local Anthropic /v1/messages proxy that injects auth
  node dsh.ts balance                              Wallet balance (also validates the token)
  node dsh.ts models                               List models
  node dsh.ts token                                Print the saved token
  node dsh.ts logout                               Delete the saved token

Env: DSH_TOKEN, DSH_USER_ID, DSH_CONFIG_DIR, DSH_MESSAGES_URL (upstream override), DSH_DEBUG=1 (usage)
Token resolution: --token / -t  >  $DSH_TOKEN  >  ${AUTH_FILE}

Chat options:
  -m, --model <id>        ${MODELS.map((m) => m.id).join(" | ")} (default ${DEFAULT_MODEL})
  -s, --system <text>     System prompt
  --effort <level>        low | medium | high | max (default high)
  --no-thinking           Disable thinking
  --show-thinking         Print thinking to stderr
  --max-tokens <n>        Default ${MAX_OUTPUT}
  --temperature <n>
  --no-stream             Wait for the full response
  --json                  Print the raw response JSON (implies --no-stream)
  --session <id>          x-deepseek-harness-session-id (default random per run)

Prompt also reads from stdin when piped: echo "hi" | node dsh.ts chat
`;

// ---------------------------------------------------------------- storage

type SavedAuth = { token?: string; deviceId?: string; userId?: string; email?: string; name?: string; savedAt?: string };

function loadAuth(): SavedAuth {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")); } catch { return {}; }
}

function saveAuth(data: SavedAuth) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// DeepSeek registers one device identity per local installation, so keep it stable.
function deviceId(): string {
  const saved = loadAuth();
  if (saved.deviceId) return saved.deviceId;
  const id = crypto.randomUUID();
  saveAuth({ ...saved, deviceId: id });
  return id;
}

function resolveAuth(args: Args): { token: string; userId?: string } {
  const saved = loadAuth();
  const token = (typeof args.token === "string" && args.token) || process.env.DSH_TOKEN || saved.token;
  if (!token) die("No token. Run `node dsh.ts login`, or pass --token / set DSH_TOKEN.");
  // userId only belongs to the saved token; do not attach it to a foreign token.
  const userId = args["user-id"] || process.env.DSH_USER_ID || (token === saved.token ? saved.userId : undefined);
  return { token, userId };
}

// ---------------------------------------------------------------- platform

function platformHeaders(): Record<string, string> {
  return {
    "x-client-bundle-id": "",
    "x-client-platform": "web",
    "x-client-version": CLIENT_VERSION,
    "x-client-locale": "en_US",
    "x-client-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
  };
}

// Envelope: { code: 0, data: { biz_code: 0, biz_data } }. Some gateways flatten data.
async function unwrapPlatform(res: Response): Promise<any> {
  const text = await res.text();
  let payload: any;
  try { payload = JSON.parse(text); } catch {
    throw new Error(`DeepSeek platform returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  const code = Number(payload?.code);
  const bizCode = payload?.data?.biz_code === undefined ? undefined : Number(payload.data.biz_code);
  if (code === 40003 || res.status === 401) throw new Error("Token rejected; run `node dsh.ts login` again");
  if (code === 0 && bizCode === undefined) return payload?.data?.biz_data ?? payload.data;
  if (code !== 0 || bizCode !== 0) {
    const detail = payload?.data?.biz_data?.message || payload?.data?.biz_msg || payload?.data?.message
      || payload?.msg || payload?.message || `code=${payload?.code} biz_code=${payload?.data?.biz_code}`;
    throw new Error(`DeepSeek platform error: ${detail}`);
  }
  return payload.data.biz_data;
}

async function platformPost(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...platformHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 401) throw new Error(`${url} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return unwrapPlatform(res);
}

// ---------------------------------------------------------------- login

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const argv = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, argv, { stdio: "ignore", detached: true }).unref(); } catch {}
}

async function cmdLogin(args: Args) {
  const port = Number(args.port || 20130);
  // DeepSeek validates loginOrigin and accepts loopback HTTP only.
  const redirectUri = `http://localhost:${port}/oauth/callback`;
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");

  const init = await platformPost(AUTH_INIT_URL, {
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    redirect_uri: redirectUri,
    locale: "en_US",
    login_source: "web",
  });
  if (!init?.authorize_url) throw new Error("auth_init returned no authorize_url");

  const result = await new Promise<any>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", redirectUri);
      if (url.pathname !== "/oauth/callback") { res.writeHead(404).end(); return; }
      const finish = (status: number, msg: string, err?: Error, data?: any) => {
        const target = data?.authorized_url;
        if (target && !err) res.writeHead(302, { Location: target }).end();
        else res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
          .end(`<!doctype html><meta charset="utf-8"><title>dsh</title><p style="font:16px system-ui;margin:3em">${msg}</p>`);
        server.close();
        err ? reject(err) : resolve(data);
      };
      const code = url.searchParams.get("code");
      if (url.searchParams.get("state") !== state) return finish(400, "State mismatch.", new Error("OAuth state mismatch"));
      if (!code) return finish(400, "Missing code.", new Error(url.searchParams.get("error") || "Callback missing code"));
      try {
        const data = await platformPost(AUTH_EXCHANGE_URL, {
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          device_id: deviceId(),
          device_model: `${process.platform}-${process.arch}`,
          os_version: `${process.platform} ${os.release()}`,
        });
        if (!data?.token) throw new Error("auth_exchange returned no token");
        finish(200, "Login complete. You can close this tab.", undefined, data);
      } catch (e: any) {
        finish(500, `Login failed: ${e.message}`, e);
      }
    });
    server.on("error", (e: any) => reject(e.code === "EADDRINUSE" ? new Error(`Port ${port} is busy; use --port <n>`) : e));
    server.listen(port, "127.0.0.1", () => {
      process.stderr.write(`Open this URL to sign in:\n\n  ${init.authorize_url}\n\nWaiting for callback on ${redirectUri} ...\n`);
      if (args.open !== false) openBrowser(init.authorize_url);
    });
    const ttl = Number(init.expires_in) > 0 ? Number(init.expires_in) * 1000 : 15 * 60 * 1000;
    setTimeout(() => { server.close(); reject(new Error("Login timed out")); }, ttl).unref();
  });

  const user = result.user || {};
  saveAuth({
    ...loadAuth(),
    token: result.token,
    userId: user.id !== undefined ? String(user.id) : undefined,
    email: user.email,
    name: user.id_profile?.name,
    savedAt: new Date().toISOString(),
  });
  process.stderr.write(`\nLogged in${user.email ? ` as ${user.email}` : ""}. Token saved to ${AUTH_FILE}\n`);
  if (args.print) process.stdout.write(result.token + "\n");
}

// ---------------------------------------------------------------- balance

async function cmdBalance(args: Args) {
  const { token } = resolveAuth(args);
  const res = await fetch(SUMMARY_URL, {
    headers: { "x-dsh-auth-token": token, Accept: "application/json", ...platformHeaders() },
    redirect: "error",
  });
  if (res.status === 403) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(/<html/i.test(body) ? "403: blocked by a proxy or network ACL" : `403: ${body}`);
  }
  const data = await unwrapPlatform(res);
  if (args.json) { console.log(JSON.stringify(data, null, 2)); return; }
  const rows: [string, string][] = [];
  for (const w of data?.normal_wallets || []) rows.push([`Recharge (${w.currency || "CNY"})`, String(w.balance ?? "0")]);
  for (const w of data?.bonus_wallets || []) rows.push([`Bonus (${w.currency || "CNY"})`, String(w.balance ?? "0")]);
  if (rows.length === 0) console.log("Token valid. No wallet data returned.");
  for (const [k, v] of rows) console.log(`${k.padEnd(18)} ${v}`);
}

// ---------------------------------------------------------------- inference

function inferenceHeaders(token: string, opts: { userId?: string; sessionId?: string; compact?: boolean }) {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "x-dsh-auth-token": token,
    "anthropic-version": ANTHROPIC_VERSION,
    "user-agent": USER_AGENT,
  };
  if (opts.userId) h["x-deepseek-harness-user-id"] = opts.userId;
  if (opts.sessionId) h["x-deepseek-harness-session-id"] = opts.sessionId;
  if (opts.compact) h["x-deepseek-harness-compact"] = "1";
  return h;
}

// Mirrors prepareClaudeRequest + applyThinking for provider "deepseek-harness":
// no cache_control anywhere, max_tokens defaults/clamps to 256000,
// thinking defaults to enabled with effort "high" (xhigh → high).
function normalizeBody(body: any): any {
  if (body.max_tokens === undefined || body.max_tokens > MAX_OUTPUT) body.max_tokens = MAX_OUTPUT;

  const strip = (block: any) => { if (block && typeof block === "object") delete block.cache_control; return block; };
  if (Array.isArray(body.system)) body.system.forEach(strip);
  for (const msg of body.messages || []) if (Array.isArray(msg.content)) msg.content.forEach(strip);
  if (Array.isArray(body.tools)) {
    body.tools = body.tools
      .filter((t: any) => !t.type || t.type === "function" || t.type === "custom")
      .map((t: any) => {
        if (t.function) return { name: t.function.name, description: t.function.description, input_schema: t.function.parameters };
        const { type, cache_control, ...rest } = t;
        return rest;
      });
    if (body.tools.length === 0) { delete body.tools; delete body.tool_choice; }
  }

  if (!body.thinking) body.thinking = { type: "enabled" };
  if (body.thinking.type === "adaptive") body.thinking = { type: "enabled" };
  if (body.thinking.type === "enabled") {
    delete body.thinking.budget_tokens;
    const effort = body.output_config?.effort || "high";
    body.output_config = { ...body.output_config, effort: effort === "xhigh" ? "high" : effort };
  } else if (body.output_config) {
    delete body.output_config.effort;
    if (Object.keys(body.output_config).length === 0) delete body.output_config;
  }
  return body;
}

async function* sseEvents(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream as any) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
      const data = raw.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data); } catch {}
    }
  }
}

type ChatOpts = { token: string; userId?: string; sessionId: string; stream: boolean; showThinking: boolean; json: boolean };

// Sends one request. Writes text to stdout as it arrives and returns the assistant content blocks.
async function sendMessages(body: any, o: ChatOpts): Promise<any[]> {
  const res = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: inferenceHeaders(o.token, { userId: o.userId, sessionId: o.sessionId }),
    body: JSON.stringify(normalizeBody({ ...body, stream: o.stream })),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) throw new Error("401: token rejected; run `node dsh.ts login` again");
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!o.stream) {
    const data: any = await res.json();
    if (o.json) { console.log(JSON.stringify(data, null, 2)); return data.content || []; }
    for (const b of data.content || []) {
      if (b.type === "thinking" && o.showThinking) process.stderr.write(dim(b.thinking) + "\n\n");
      if (b.type === "text") process.stdout.write(b.text);
      if (b.type === "tool_use") process.stdout.write(`\n[tool_use ${b.name} ${JSON.stringify(b.input)}]`);
    }
    process.stdout.write("\n");
    return data.content || [];
  }

  const blocks: any[] = [];
  let usage: any = {};
  for await (const ev of sseEvents(res.body!)) {
    if (ev.type === "error") throw new Error(`Upstream stream error: ${JSON.stringify(ev.error || ev)}`);
    if (ev.type === "message_start") usage = { ...ev.message?.usage };
    if (ev.type === "content_block_start") blocks[ev.index] = { ...ev.content_block };
    if (ev.type === "content_block_delta") {
      const b = blocks[ev.index] || (blocks[ev.index] = {});
      const d = ev.delta || {};
      if (d.type === "text_delta") { b.text = (b.text || "") + d.text; process.stdout.write(d.text); }
      if (d.type === "thinking_delta") { b.thinking = (b.thinking || "") + d.thinking; if (o.showThinking) process.stderr.write(dim(d.thinking)); }
      if (d.type === "signature_delta") b.signature = (b.signature || "") + d.signature;
      if (d.type === "input_json_delta") b._json = (b._json || "") + d.partial_json;
    }
    if (ev.type === "content_block_stop") {
      const b = blocks[ev.index];
      if (b?.type === "thinking" && o.showThinking) process.stderr.write("\n\n");
      if (b?._json !== undefined) { try { b.input = JSON.parse(b._json); } catch { b.input = {}; } delete b._json; }
    }
    if (ev.type === "message_delta") usage = { ...usage, ...ev.usage };
  }
  process.stdout.write("\n");
  if (process.env.DSH_DEBUG) process.stderr.write(dim(`usage ${JSON.stringify(usage)}`) + "\n");
  return blocks.filter(Boolean);
}

function dim(s: string) { return process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s; }

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s.trim();
}

async function cmdChat(args: Args) {
  const { token, userId } = resolveAuth(args);
  const json = !!args.json;
  const o: ChatOpts = {
    token,
    userId,
    sessionId: typeof args.session === "string" ? args.session : crypto.randomUUID(),
    stream: json ? false : args.stream !== false,
    showThinking: !!args["show-thinking"],
    json,
  };
  const base: any = { model: args.model || DEFAULT_MODEL };
  if (args.system) base.system = String(args.system);
  if (args["max-tokens"]) base.max_tokens = Number(args["max-tokens"]);
  if (args.temperature !== undefined) base.temperature = Number(args.temperature);
  if (args.thinking === false) base.thinking = { type: "disabled" };
  else base.output_config = { effort: String(args.effort || "high") };

  // Stdin is read only without a prompt argument, so an open pipe never blocks a one-shot call.
  const prompt = args._.join(" ") || await readStdin();

  if (prompt) {
    await sendMessages({ ...base, messages: [{ role: "user", content: prompt }] }, o);
    return;
  }

  if (!process.stdin.isTTY) die("Empty prompt. Pass it as an argument or pipe it on stdin.");

  // REPL: keeps full assistant blocks (thinking included) so multi-turn thinking stays valid.
  const messages: any[] = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, prompt: "› " });
  process.stderr.write(dim(`${base.model} · session ${o.sessionId} · /reset clears history · Ctrl+D exits`) + "\n");
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (!text) { rl.prompt(); continue; }
    if (text === "/reset") { messages.length = 0; process.stderr.write(dim("history cleared") + "\n"); rl.prompt(); continue; }
    if (text === "/exit" || text === "/quit") break;
    messages.push({ role: "user", content: text });
    try {
      const content = await sendMessages({ ...base, messages }, o);
      messages.push({ role: "assistant", content });
    } catch (e: any) {
      messages.pop();
      process.stderr.write(`error: ${e.message}\n`);
    }
    rl.prompt();
  }
  rl.close();
}

// ---------------------------------------------------------------- serve

// Local Anthropic-compatible proxy. Point any Anthropic client at http://host:port.
// Incoming auth headers are ignored; the dsh token is injected upstream.
async function cmdServe(args: Args) {
  const { token, userId } = resolveAuth(args);
  const port = Number(args.port || 8787);
  const host = String(args.host || "127.0.0.1");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && url.pathname === "/v1/models") {
        return send(200, { data: MODELS.map((m) => ({ type: "model", id: m.id, display_name: m.name })) });
      }
      if (req.method !== "POST" || url.pathname !== "/v1/messages") {
        return send(404, { type: "error", error: { type: "not_found_error", message: `${req.method} ${url.pathname}` } });
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = normalizeBody(JSON.parse(raw));
      if (!MODELS.some((m) => m.id === body.model)) body.model = String(args.model || DEFAULT_MODEL);

      const upstream = await fetch(MESSAGES_URL, {
        method: "POST",
        headers: inferenceHeaders(token, {
          userId,
          sessionId: String(req.headers["x-claude-code-session-id"] || req.headers["x-session-id"] || "") || undefined,
          compact: req.headers["x-deepseek-harness-compact"] === "1",
        }),
        body: JSON.stringify(body),
      });
      const headers: Record<string, string> = { "content-type": upstream.headers.get("content-type") || "application/json" };
      if (body.stream) headers["cache-control"] = "no-cache";
      res.writeHead(upstream.status, headers);
      if (!upstream.body) return res.end();
      for await (const chunk of upstream.body as any) res.write(chunk);
      res.end();
      process.stderr.write(dim(`${new Date().toISOString()} ${upstream.status} ${body.model} stream=${!!body.stream}`) + "\n");
    } catch (e: any) {
      if (!res.headersSent) send(502, { type: "error", error: { type: "api_error", message: e.message } });
      else res.end();
    }
  });
  server.listen(port, host, () => {
    process.stderr.write(`dsh proxy on http://${host}:${port}  (POST /v1/messages, GET /v1/models)\n`);
    process.stderr.write(dim(`e.g. ANTHROPIC_BASE_URL=http://${host}:${port} ANTHROPIC_API_KEY=dsh ANTHROPIC_MODEL=${DEFAULT_MODEL} claude`) + "\n");
  });
}

// ---------------------------------------------------------------- main

function die(msg: string): never {
  process.stderr.write(`dsh: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._.shift();
  if (!cmd || args.help || cmd === "help") { process.stdout.write(HELP); return; }
  switch (cmd) {
    case "login": return cmdLogin(args);
    case "chat": return cmdChat(args);
    case "serve": return cmdServe(args);
    case "balance": return cmdBalance(args);
    case "models": for (const m of MODELS) console.log(`${m.id.padEnd(18)} ${m.name}`); return;
    case "token": { const t = loadAuth().token; if (!t) die("No saved token."); console.log(t); return; }
    case "logout": { const a = loadAuth(); saveAuth({ deviceId: a.deviceId }); console.error("Token removed."); return; }
    default: die(`Unknown command "${cmd}". Run with --help.`);
  }
}

main().catch((e) => die(e?.message || String(e)));
