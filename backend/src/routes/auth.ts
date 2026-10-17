import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Runtime } from "../runtime";

function isLoopback(value: string | null): boolean {
  if (!value) return false;
  const host = value.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLocalRequest(request: Request): boolean {
  if (request.headers.get("x-lobak-via-proxy")) return false;
  const realIp = request.headers.get("x-lobak-real-ip");
  if (realIp ? !isLoopback(realIp) : !isLoopback(request.headers.get("host"))) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return isLoopback(new URL(origin).hostname); } catch { return false; }
}

function oidcConfig(runtime: Runtime) {
  const settings = runtime.repos.settings.get();
  const authMode = String(settings.authMode || "password");
  const issuerUrl = String(settings.oidcIssuerUrl || "").trim().replace(/\/+$/, "");
  const clientId = String(settings.oidcClientId || "").trim();
  const clientSecret = String(settings.oidcClientSecret || "").trim();
  if (!issuerUrl || !clientId || !clientSecret || !["oidc", "both"].includes(authMode)) return null;
  return { issuerUrl, clientId, clientSecret, scopes: String(settings.oidcScopes || "openid profile email").trim() || "openid profile email", loginLabel: String(settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC", authMode };
}

function publicOrigin(request: Request): string {
  const configured = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(/:$/, "");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

function random(): string { return crypto.getRandomValues(new Uint8Array(24)).reduce((value, byte) => `${value}${byte.toString(16).padStart(2, "0")}`, ""); }

async function pkce() {
  const verifier = random();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return { verifier, challenge };
}

export function authRoutes(runtime: Runtime) {
  return new Hono()
    .get("/oidc/start", async (c) => {
      const config = oidcConfig(runtime);
      if (!config) return c.redirect(`${publicOrigin(c.req.raw)}/login?error=oidc_not_configured`);
      try {
        const discovery = await fetch(`${config.issuerUrl}/.well-known/openid-configuration`, { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<Record<string, string>> : Promise.reject(new Error("OIDC discovery failed")));
        const state = random(); const nonce = random(); const pair = await pkce();
        const redirectUri = `${publicOrigin(c.req.raw)}/api/auth/oidc/callback`;
        const url = new URL(String(discovery.authorization_endpoint));
        url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: redirectUri, scope: config.scopes, state, nonce, code_challenge: pair.challenge, code_challenge_method: "S256" }).toString();
        const options = { httpOnly: true, secure: c.req.header("x-forwarded-proto") === "https", sameSite: "Lax" as const, path: "/", maxAge: 600 };
        setCookie(c, "oidc_state", state, options); setCookie(c, "oidc_nonce", nonce, options); setCookie(c, "oidc_code_verifier", pair.verifier, options);
        return c.redirect(url.toString());
      } catch { return c.redirect(`${publicOrigin(c.req.raw)}/login?error=oidc_start_failed`); }
    })
    .get("/oidc/callback", async (c) => {
      const config = oidcConfig(runtime); const origin = publicOrigin(c.req.raw);
      const clear = () => { deleteCookie(c, "oidc_state", { path: "/" }); deleteCookie(c, "oidc_nonce", { path: "/" }); deleteCookie(c, "oidc_code_verifier", { path: "/" }); };
      const code = c.req.query("code"); const state = c.req.query("state");
      if (!config || !code || !state || state !== getCookie(c, "oidc_state")) { clear(); return c.redirect(`${origin}/login?error=oidc_invalid_state`); }
      try {
        const nonce = getCookie(c, "oidc_nonce"); const verifier = getCookie(c, "oidc_code_verifier");
        if (!nonce || !verifier) throw new Error("missing OIDC verifier");
        const discovery = await fetch(`${config.issuerUrl}/.well-known/openid-configuration`, { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<Record<string, string>> : Promise.reject(new Error("OIDC discovery failed")));
        const redirectUri = `${origin}/api/auth/oidc/callback`;
        const response = await fetch(String(discovery.token_endpoint), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier }) });
        const tokens = await response.json().catch(() => ({})) as Record<string, string>;
        if (!response.ok || !tokens.id_token) throw new Error("OIDC token exchange failed");
        const jwks = createRemoteJWKSet(new URL(String(discovery.jwks_uri)));
        const { payload } = await jwtVerify(tokens.id_token, jwks as any, { issuer: String(discovery.issuer || config.issuerUrl), audience: config.clientId });
        if (payload.nonce !== nonce) throw new Error("OIDC nonce validation failed");
        clear();
        const oidcName = String(payload.preferred_username || payload.email || payload.name || payload.given_name || payload.sub || "OIDC user").trim() || "OIDC user";
        const oidcEmail = String(payload.email || "").trim();
        const token = await runtime.auth.createSession(`oidc:${String(payload.sub || "")}`, { oidc: true, oidcName, oidcEmail });
        setCookie(c, "auth_token", token, { httpOnly: true, secure: c.req.header("x-forwarded-proto") === "https", sameSite: "Lax", path: "/" });
        return c.redirect(`${origin}/dashboard`);
      } catch { clear(); return c.redirect(`${origin}/login?error=oidc_callback_failed`); }
    })
    .post("/oidc/test", runtime.auth.adminMiddleware(), async (c) => {
      const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const settings = runtime.repos.settings.get();
      const issuerUrl = String(body.issuerUrl || settings.oidcIssuerUrl || "").trim().replace(/\/+$/, "");
      const clientId = String(body.clientId || settings.oidcClientId || "").trim();
      const clientSecret = String(Object.hasOwn(body, "clientSecret") ? body.clientSecret : settings.oidcClientSecret || "").trim();
      if (!issuerUrl || !clientId) return c.json({ error: !issuerUrl ? "Issuer URL is required" : "Client ID is required" }, 400);
      try {
        const discovery = await fetch(`${issuerUrl}/.well-known/openid-configuration`, { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<Record<string, string>> : Promise.reject(new Error("OIDC discovery failed")));
        return c.json({ ok: true, discoveryOk: true, clientSecretTested: Boolean(clientSecret), issuerUrl, clientId, scopes: String(body.scopes || settings.oidcScopes || "openid profile email"), redirectUri: `${publicOrigin(c.req.raw)}/api/auth/oidc/callback`, authorizationEndpoint: discovery.authorization_endpoint || "", tokenEndpoint: discovery.token_endpoint || "", jwksUri: discovery.jwks_uri || "" });
      } catch (error: any) { return c.json({ error: error instanceof Error ? error.message : "OIDC test failed" }, 500); }
    })
    .post("/login", async (c) => {
      if (String(runtime.repos.settings.get().authMode || "password") === "oidc") return c.json({ error: "Password login is disabled" }, 403, { "Cache-Control": "no-store" });
      const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
      const result = await runtime.auth.loginRequest(c.req.raw, String(body.password || ""));
      if (result.retryAfter) return c.json({ error: `Too many failed attempts. Try again in ${result.retryAfter}s.`, retryAfter: result.retryAfter }, 429, { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" });
      if (!result.token) return c.json({ error: `Invalid password. ${result.remainingBeforeLock ?? 0} attempt(s) left before lockout.`, remainingBeforeLock: result.remainingBeforeLock }, 401, { "Cache-Control": "no-store" });
      const secure = c.req.header("x-forwarded-proto") === "https" ? "; Secure" : "";
      const settings = runtime.repos.settings.get();
      const mustChangePassword = !settings.password && !process.env.INITIAL_PASSWORD && !isLocalRequest(c.req.raw);
      return c.json({ success: true, mustChangePassword }, 200, { "Set-Cookie": `auth_token=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Lax; Path=/${secure}`, "Cache-Control": "no-store" });
    })
    .post("/logout", (c) => c.json({ ok: true }, 200, { "Set-Cookie": "auth_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" }))
    .post("/reset-password", runtime.auth.adminMiddleware(), (c) => { runtime.repos.settings.update({ password: null, passwordHash: undefined }); return c.json({ success: true }); })
    .get("/status", async (c) => {
      const settings = runtime.repos.settings.get(); const oidc = oidcConfig(runtime);
      const session = await runtime.auth.sessionClaimsFromHeaders(c.req.raw.headers);
      const oidcName = String(session?.oidcName || "").trim();
      const oidcEmail = String(session?.oidcEmail || "").trim();
      const isOidc = session?.oidc === true;
      return c.json({
        requireLogin: settings.requireLogin,
        authenticated: Boolean(session),
        authMode: settings.authMode || "password",
        oidcConfigured: Boolean(oidc),
        oidcLoginLabel: oidc?.loginLabel || "Sign in with OIDC",
        hasPassword: Boolean(settings.password || settings.passwordHash),
        displayName: oidcName || oidcEmail || (isOidc ? "OIDC user" : "Password user"),
        loginMethod: isOidc ? "OIDC" : "Password",
        oidcName: oidcName || null,
        oidcEmail: oidcEmail || null,
        oidcLogin: isOidc,
      });
    });
}
