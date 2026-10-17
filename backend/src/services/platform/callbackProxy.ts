import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { Repositories } from "../../db/repositories";
import { exchangeTokens } from "../providers/oauth/providers/index.ts";

type CallbackProvider = "codex";
type SessionStatus = "pending" | "done" | "error";

interface Session {
  state: string;
  status: SessionStatus;
  createdAt: number;
  codeVerifier?: string;
  redirectUri?: string;
  connectionId?: string;
  email?: string | null;
  error?: string;
}

interface ProxyState {
  server: Server | null;
  timer: ReturnType<typeof setTimeout> | null;
  port: number | null;
  appPort: number | null;
}

const PROVIDERS = ["codex"] as const;
const FIXED_PORTS: Record<CallbackProvider, number> = { codex: 1455 };
const CALLBACK_PATHS = ["/callback", "/auth/callback"];
const TIMEOUT_MS = 300_000;

function isProvider(value: string): value is CallbackProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function resultPage(success: boolean, message: string): string {
  const safe = message.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
  const title = success ? "Authentication Successful" : "Authentication Failed";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${safe}</p><p>You can close this window.</p></main><script>window.setTimeout(()=>window.close(),3000)</script></body></html>`;
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function tokenRecord(value: Record<string, unknown>) {
  const expiresIn = Number(value.expiresIn);
  const expiresAt = typeof value.expiresAt === "string"
    ? value.expiresAt
    : Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;
  return {
    credentials: {
      ...(typeof value.accessToken === "string" ? { accessToken: value.accessToken } : {}),
      ...(typeof value.refreshToken === "string" ? { refreshToken: value.refreshToken } : {}),
      ...(typeof value.idToken === "string" ? { idToken: value.idToken } : {}),
      ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    },
    data: {
      ...(value.providerSpecificData && typeof value.providerSpecificData === "object" ? value.providerSpecificData : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
      ...(typeof value.tokenType === "string" ? { tokenType: value.tokenType } : {}),
      ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
      testStatus: "active",
      lastRefreshAt: new Date().toISOString(),
    },
  };
}

function publicSession(session: Session | undefined) {
  if (!session) return { status: "unknown" };
  if (session.status === "pending") return { status: "pending" };
  return {
    status: session.status,
    ...(session.connectionId ? { connectionId: session.connectionId } : {}),
    ...(session.email ? { email: session.email } : {}),
    ...(session.error ? { error: session.error } : {}),
  };
}

export interface CallbackProxyManager {
  start(provider: string, appPort?: number): Promise<Record<string, unknown>>;
  register(provider: string, input: { state?: string; codeVerifier?: string; redirectUri?: string }): boolean;
  poll(provider: string, state: string): Record<string, unknown>;
  stop(provider: string): boolean;
  close(): void;
}

export function createCallbackProxyManager(repos: Repositories): CallbackProxyManager {
  const states = new Map<CallbackProvider, ProxyState>(PROVIDERS.map((provider) => [provider, { server: null, timer: null, port: null, appPort: null }]));
  const sessions = new Map<CallbackProvider, Map<string, Session>>(PROVIDERS.map((provider) => [provider, new Map()]));

  function stateFor(provider: CallbackProvider) { return states.get(provider)!; }
  function sessionsFor(provider: CallbackProvider) { return sessions.get(provider)!; }

  function stopKnown(provider: CallbackProvider) {
    const state = stateFor(provider);
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.server) state.server.close();
    state.server = null;
    state.port = null;
    state.appPort = null;
  }

  async function persist(provider: CallbackProvider, code: string, session?: Session) {
    const tokens = await (exchangeTokens as any)(provider, code, session?.redirectUri ?? null, session?.codeVerifier ?? null, session?.state) as Record<string, unknown>;
    const normalized = tokenRecord(tokens);
    const email = typeof tokens.email === "string" ? tokens.email : null;
    const name = typeof tokens.displayName === "string" ? tokens.displayName : email;
    const connection = repos.providers.create({
      provider,
      authType: "oauth",
      credentials: normalized.credentials,
      data: normalized.data,
      email,
      name,
    });
    return { id: connection.id, provider: connection.provider, email: connection.email, displayName: connection.name };
  }

  function respond(res: ServerResponse, success: boolean, message: string, status = 200) {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(resultPage(success, message));
  }

  async function callback(provider: CallbackProvider, req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", "http://localhost");
    if (!CALLBACK_PATHS.includes(url.pathname)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    if (!isLoopbackOrigin(req.headers.origin)) {
      respond(res, false, "Cross-origin callback rejected", 403); return;
    }

    const callbackState = url.searchParams.get("state") || "";
    const session = callbackState ? sessionsFor(provider).get(callbackState) : undefined;
    if (!session) {
      const appPort = stateFor(provider).appPort;
      if (!appPort) { respond(res, false, "No active OAuth login session"); return; }
      res.writeHead(302, { location: `http://localhost:${appPort}/callback${url.search}` });
      res.end();
      stopKnown(provider);
      return;
    }

    try {
      const error = url.searchParams.get("error");
      if (error) throw new Error("OAuth authorization was rejected");
      const code = url.searchParams.get("code") || "";
      if (!code) throw new Error("No authorization code received");
      const connection = await persist(provider, code, session);
      session.status = "done";
      session.connectionId = connection.id;
      session.email = connection.email;
      respond(res, true, "You can close this window.");
    } catch {
      session.status = "error";
      // Keep callback status useful without exposing an upstream response or credential.
      session.error = "OAuth token exchange failed";
      respond(res, false, session.error);
    } finally {
      stopKnown(provider);
    }
  }

  return {
    async start(rawProvider, appPort) {
      if (!isProvider(rawProvider)) throw new Error("Proxy only supported for codex");
      const provider = rawProvider;
      if ((!Number.isInteger(appPort) || appPort! < 1 || appPort! > 65535)) throw new Error("Missing app_port");
      const state = stateFor(provider);
      if (state.server) return { success: true };
      const server = createServer((req, res) => { void callback(provider, req, res); });
      const port = FIXED_PORTS[provider];
      const result = await new Promise<{ success: boolean; reason?: string; port?: number }>((resolve) => {
        server.once("error", (error: NodeJS.ErrnoException) => resolve({ success: false, reason: error.code === "EADDRINUSE" ? "port_busy" : error.message }));
        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? { success: true, port: address.port } : { success: false, reason: "Unable to determine callback port" });
        });
      });
      if (!result.success || !result.port) { server.close(); return result; }
      state.server = server;
      state.port = result.port;
      state.appPort = appPort || null;
      state.timer = setTimeout(() => stopKnown(provider), TIMEOUT_MS);
      return { success: true };
    },
    register(rawProvider, input) {
      if (!isProvider(rawProvider) || !input.state || !input.codeVerifier || !input.redirectUri) return false;
      sessionsFor(rawProvider).set(input.state, { state: input.state, status: "pending", createdAt: Date.now(), ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}), ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) });
      return true;
    },
    poll(rawProvider, sessionState) {
      if (!isProvider(rawProvider)) throw new Error("Poll only supported for codex");
      const store = sessionsFor(rawProvider);
      const session = store.get(sessionState);
      const payload = publicSession(session);
      if (session && session.status !== "pending") store.delete(sessionState);
      return payload;
    },
    stop(rawProvider) {
      if (!isProvider(rawProvider)) return false;
      stopKnown(rawProvider);
      return true;
    },
    close() {
      for (const provider of PROVIDERS) {
        stopKnown(provider);
        sessionsFor(provider).clear();
      }
    },
  };
}
