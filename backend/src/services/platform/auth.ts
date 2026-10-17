import { defaultDataDir } from "./dataDir.ts";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import type { BackendConfig } from "../../config";
import type { ApiKeyRecord, Repositories } from "../../db/repositories";
import { checkRateLimit } from "./rateLimit";

const encoder = new TextEncoder();

function base64url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function cookieValue(header: string | undefined, name: string): string | null {
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : null;
}

export interface AuthService {
  hashApiKey(key: string): Promise<string>;
  verifyApiKey(key: string): Promise<ApiKeyRecord | null>;
  apiKeyFromHeaders(headers: Headers): Promise<ApiKeyRecord | null>;
  gatewayRequestGate(request: Request): Promise<Response | null>;
  apiKeyFromRequest(request: Request): Promise<ApiKeyRecord | null>;
  login(password: string): Promise<string | null>;
  createSession(subject?: string, claims?: DashboardSessionClaims): Promise<string>;
  loginRequest(request: Request, password: string): Promise<{ token: string | null; retryAfter?: number; remainingBeforeLock?: number }>;
  verifySession(token: string | null): Promise<boolean>;
  sessionFromHeaders(headers: Headers): Promise<boolean>;
  sessionClaimsFromHeaders(headers: Headers): Promise<DashboardSessionClaims | null>;
  adminMiddleware(): MiddlewareHandler;
  alwaysProtectedMiddleware(): MiddlewareHandler;
  gatewayMiddleware(): MiddlewareHandler;
}

export interface DashboardSessionClaims {
  sub?: string;
  oidc?: boolean;
  oidcName?: string;
  oidcEmail?: string;
  exp?: number;
}

export function createAuthService(config: BackendConfig, repos: Repositories): AuthService {
  const secretPromise = Promise.resolve(config.jwtSecret || `${config.dataDir || defaultDataDir()}:v2-session-secret`);
  const authDir = join(config.dataDir || defaultDataDir(), "auth");
  const cliSecretPath = join(authDir, "cli-secret");
  let cliSecret: string | null = null;

  function loadCliToken(): string {
    if (!cliSecret) {
      try { cliSecret = readFileSync(cliSecretPath, "utf8").trim(); } catch { /* create below */ }
      if (!cliSecret) {
        cliSecret = randomBytes(32).toString("hex");
        try { mkdirSync(authDir, { recursive: true }); writeFileSync(cliSecretPath, cliSecret, { mode: 0o600 }); } catch { /* best effort for read-only runtimes */ }
      }
    }
    return createHash("sha256").update(`${cliSecret}lobak-cli-auth`).digest("hex").slice(0, 16);
  }

  function cookieValue(header: string | undefined, name: string): string | null {
    const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return value ? decodeURIComponent(value.slice(name.length + 1)) : null;
  }

  function isLoopback(value: string | null): boolean {
    if (!value) return false;
    const host = value.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  }

  function isLocalRequest(request: Request): boolean {
    if (request.headers.get("x-lobak-via-proxy")) return false;
    const realIp = request.headers.get("x-lobak-real-ip");
    // Bun may not materialize Host as a header; fall back to the URL host.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (realIp ? !isLoopback(realIp) : !isLoopback(host)) return false;
    const origin = request.headers.get("origin");
    if (!origin) return true;
    try { return isLoopback(new URL(origin).hostname); } catch { return false; }
  }

  function requestApiKey(request: Request): string | null {
    const authorization = request.headers.get("authorization") || "";
    if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim() || null;
    return request.headers.get("x-api-key") || request.headers.get("x-goog-api-key") || new URL(request.url).searchParams.get("key");
  }

  const failedLogins = new Map<string, { failures: number; lockUntil: number; level: number; lastFailure: number }>();
  const lockSteps = [30_000, 120_000, 600_000, 1_800_000];
  function loginIp(request: Request): string { return request.headers.get("x-lobak-real-ip") || "unknown"; }
  function lockStatus(ip: string): number {
    const entry = failedLogins.get(ip);
    if (!entry || entry.lockUntil <= Date.now()) return 0;
    return Math.ceil((entry.lockUntil - Date.now()) / 1000);
  }
  function recordLoginFailure(ip: string): { locked: number; remaining: number } {
    const entry = failedLogins.get(ip) || { failures: 0, lockUntil: 0, level: 0, lastFailure: 0 };
    if (entry.lastFailure && Date.now() - entry.lastFailure > 60 * 60 * 1000 && entry.lockUntil <= Date.now()) entry.failures = 0;
    entry.failures += 1;
    entry.lastFailure = Date.now();
    if (entry.failures >= 5) {
      entry.lockUntil = Date.now() + lockSteps[Math.min(entry.level, lockSteps.length - 1)];
      entry.level += 1;
      entry.failures = 0;
    }
    failedLogins.set(ip, entry);
    return { locked: lockStatus(ip), remaining: Math.max(0, 5 - entry.failures) };
  }

  async function passwordHash(password: string): Promise<string> {
    return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
  }

  async function login(password: string): Promise<string | null> {
    const settings = repos.settings.get();
    const expected = typeof settings.password === "string" ? settings.password : typeof settings.passwordHash === "string" ? settings.passwordHash : null;
    let valid = false;
    if (expected?.startsWith("$2")) valid = await Bun.password.verify(password, expected);
    else if (expected?.startsWith("sha256:")) valid = expected === `sha256:${await digest(password)}`;
    else valid = password === (config.initialPassword || "123456");
    if (!valid) return null;
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ sub: "dashboard", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 }));
    return `${header}.${payload}.${await sign(`${header}.${payload}`, await secretPromise)}`;
  }

  async function verifiedSessionClaims(token: string | null): Promise<DashboardSessionClaims | null> {
    if (!token) return null;
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) return null;
    try {
      const expected = await sign(`${header}.${payload}`, await secretPromise);
      if (expected !== signature) return null;
      const claims = JSON.parse(decode(payload)) as DashboardSessionClaims;
      return !claims.exp || claims.exp > Date.now() / 1000 ? claims : null;
    } catch {
      return null;
    }
  }

  async function createSession(subject = "dashboard", claims: DashboardSessionClaims = {}) {
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const now = Math.floor(Date.now() / 1000);
    const payload = base64url(JSON.stringify({ ...claims, sub: subject, iat: now, exp: now + 86400 }));
    return `${header}.${payload}.${await sign(`${header}.${payload}`, await secretPromise)}`;
  }

  async function loginRequest(request: Request, password: string) {
    const ip = loginIp(request);
    const retryAfter = lockStatus(ip);
    if (retryAfter) return { token: null, retryAfter };
    const token = await login(password);
    if (token) {
      failedLogins.delete(ip);
      return { token };
    }
    const failure = recordLoginFailure(ip);
    return failure.locked
      ? { token: null, retryAfter: failure.locked }
      : { token: null, remainingBeforeLock: failure.remaining };
  }

  async function verifySession(token: string | null): Promise<boolean> {
    return Boolean(await verifiedSessionClaims(token));
  }

    return {
    hashApiKey: digest,
    verifyApiKey: async (key) => repos.keys.getByKey(key),
     apiKeyFromHeaders: async (headers) => {
       const authorization = headers.get("authorization") || "";
       const key = authorization.startsWith("Bearer ") ? authorization.slice(7) : headers.get("x-api-key") || headers.get("x-goog-api-key");
       return key ? repos.keys.getByKey(key) : null;
     },
     apiKeyFromRequest: async (request) => {
       const key = requestApiKey(request);
       return key ? repos.keys.getByKey(key) : null;
     },
     // v1 getApiKeyRecordForRequest (route-level): with requireApiKey every
     // chat/media caller must present a valid key — including local ones.
     // Without it, a provided-but-inactive key is still rejected.
     gatewayRequestGate: async (request) => {
       // v1 errorResponse: bare "application/json" content type + ACAO header.
       const v1Error = (status: number, message: string, type: string, code: string) => new Response(
         JSON.stringify({ error: { message, type, code } }),
         { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
       );
       const settings = repos.settings.get();
       const key = requestApiKey(request);
       const invalid = v1Error(401, "Invalid API key", "authentication_error", "invalid_api_key");
       let record: ApiKeyRecord | null = null;
       if (settings.requireApiKey) {
         if (!key) return v1Error(401, "Missing API key", "authentication_error", "invalid_api_key");
         record = await repos.keys.getByKey(key);
         if (!record?.isActive) return invalid;
       } else if (key) {
         record = await repos.keys.getByKey(key);
         if (record && record.isActive === false) return invalid;
       }
if (record) {
          const mode = record.limitMode;
          const limit = record.limitValue;
          if (mode && mode !== "none" && limit != null && limit > 0) {
            const usage = mode === "tokens" ? Number(record.usageTokens) || 0 : Number(record.usageRequests) || 0;
            if (usage >= limit) return v1Error(429, `API key usage limit exceeded (${mode}: ${usage}/${limit})`, "rate_limit_error", "rate_limit_exceeded");
          }
          const features = record.features || {};
          const rate = checkRateLimit(
            record.id,
            (features as Record<string, unknown>).requestsPerMinute as number | null | undefined,
            (features as Record<string, unknown>).requestsPerSecond as number | null | undefined,
          );
          if (!rate.allowed) return v1Error(429, rate.message || "Rate limit exceeded", "rate_limit_error", "rate_limit_exceeded");
          // The per-key concurrency limit (maxConcurrency) is enforced by
          // admission control in the route, not here.
        }
        return null;
      },
     login,
    createSession,
     loginRequest,
    verifySession,
    sessionFromHeaders: (headers) => verifySession(cookieValue(headers.get("cookie") || undefined, "auth_token")),
    sessionClaimsFromHeaders: (headers) => verifiedSessionClaims(cookieValue(headers.get("cookie") || undefined, "auth_token")),
     adminMiddleware: () => async (c, next) => {
       const settings = repos.settings.get();
       if (config.requireLogin === false || settings.requireLogin === false || c.req.header("x-lobak-cli-token") === loadCliToken() || await verifySession(cookieValue(c.req.header("cookie"), "auth_token"))) return next();
       // v1 dashboardGuard responds with the bare {"error":"Unauthorized"} body.
       return c.json({ error: "Unauthorized" }, 401);
     },
     alwaysProtectedMiddleware: () => async (c, next) => {
       // Mirrors v1's ALWAYS_PROTECTED: a real token is required even when
       // requireLogin is disabled.
       if (c.req.header("x-lobak-cli-token") === loadCliToken() || await verifySession(cookieValue(c.req.header("cookie"), "auth_token"))) return next();
       return c.json({ error: { message: "Unauthorized", type: "authentication_error" } }, 401);
     },
     gatewayMiddleware: () => async (c, next) => {
       // v1 dashboardGuard canAccessPublicLlmApi: local requests, the CLI
       // token, or a valid API key pass; everyone else gets the proxy 401.
       // requireApiKey for chat/media is enforced at route level instead
       // (v1 getApiKeyRecordForRequest), so model listings stay reachable.
       const request = c.req.raw;
       if (isLocalRequest(request) || c.req.header("x-lobak-cli-token") === loadCliToken()) {
         const key = requestApiKey(request);
         c.set("apiKey", key ? await repos.keys.getByKey(key) : null);
         return next();
       }
       const key = requestApiKey(request);
       const record = key ? await repos.keys.getByKey(key) : null;
       if (!record?.isActive) return c.json({ error: "API key required for remote API access" }, 401);
       c.set("apiKey", record);
       return next();
     },
   };
}
