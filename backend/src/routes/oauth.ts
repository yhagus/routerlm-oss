import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { fetchCodebuddyAccount, isCodebuddyProvider } from "../services/providers/codebuddyIdentity";

// OAuth provider implementations remain authoritative in v1. This route only
// exposes the stable HTTP contract and persists the normalized token result.
import { getProvider, generateAuthData, exchangeTokens, requestDeviceCode, pollForToken } from "../services/providers/oauth/providers/index.ts";

const NO_PKCE_DEVICE_PROVIDERS = new Set(["codebuddy-cn", "qoder", "grok-cli"]);
const NO_PKCE_POLL_PROVIDERS = new Set(["codebuddy-cn", "grok-cli"]);

function tokenData(value: Record<string, unknown>) {
  const providerSpecificData = value.providerSpecificData && typeof value.providerSpecificData === "object" ? value.providerSpecificData : {};
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
      ...providerSpecificData,
      ...(expiresAt ? { expiresAt } : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
      ...(typeof value.tokenType === "string" ? { tokenType: value.tokenType } : {}),
      ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
      lastRefreshAt: new Date().toISOString(),
    },
  };
}

function connectionPayload(provider: string, value: Record<string, unknown>) {
  const normalized = tokenData(value);
  return {
    provider,
    authType: "oauth",
    credentials: normalized.credentials,
    data: normalized.data,
    email: typeof value.email === "string" ? value.email : null,
    name: typeof value.displayName === "string" ? value.displayName : typeof value.email === "string" ? value.email : null,
  };
}

export function oauthRoutes(runtime: Runtime) {
  const app = new Hono().use("*", runtime.auth.adminMiddleware());

  app.get("/:provider/:action", async (c) => {
    const provider = c.req.param("provider");
    const action = c.req.param("action");
    try {
      if (action === "start-proxy") {
        const query = c.req.query();
        try {
          const result = await runtime.callbackProxy.start(provider, query.app_port ? Number(query.app_port) : undefined);
          const serverSide = provider === "codex" && query.state && query.code_verifier && query.redirect_uri
            ? runtime.callbackProxy.register(provider, { state: query.state, codeVerifier: query.code_verifier, redirectUri: query.redirect_uri })
            : false;
          return c.json({ ...result, serverSide });
        } catch (error: any) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      }
      if (action === "poll-status") {
        const state = c.req.query("state");
        if (!state) return c.json({ error: "Missing state" }, 400);
        try { return c.json(runtime.callbackProxy.poll(provider, state)); }
        catch (error: any) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
      }
      if (action === "stop-proxy") {
        if (!runtime.callbackProxy.stop(provider)) return c.json({ error: "Proxy only supported for codex" }, 400);
        return c.json({ success: true });
      }
      const config = getProvider(provider);
      if (action === "authorize") {
        const query = c.req.query();
        const redirectUri = query.redirect_uri || "http://localhost:8080/callback";
        const meta = { ...query };
        delete meta.redirect_uri;
        // deepseek-harness auth_init needs the redirect URI up front (in prepareConfig).
        if (provider === "deepseek-harness") meta.redirect_uri = redirectUri;
        return c.json(await generateAuthData(provider, redirectUri, Object.keys(meta).length ? meta : undefined));
      }
      if (action === "device-code") {
        if (config.flowType !== "device_code") return c.json({ error: "Provider does not support device code flow" }, 400);
        const query = c.req.query();
        const auth = await generateAuthData(provider, null, undefined);
        const result = await requestDeviceCode(provider, NO_PKCE_DEVICE_PROVIDERS.has(provider) ? undefined : auth.codeChallenge, undefined);
        return c.json({ ...result, codeVerifier: (result as Record<string, unknown>).codeVerifier || auth.codeVerifier });
      }
      return c.json({ error: "Unknown action" }, 400);
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post("/:provider/:action", async (c) => {
    const provider = c.req.param("provider");
    const action = c.req.param("action");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    try {
      if (action === "exchange") {
        if (typeof body.code !== "string" || !body.code || typeof body.redirectUri !== "string" || typeof body.codeVerifier !== "string") return c.json({ error: "Missing required fields" }, 400);
        // v1: a pasted raw JWT access token (starts with eyJ) becomes an
        // access_token connection with the ChatGPT account claims extracted.
        if (typeof body.code === "string" && body.code.startsWith("eyJ") && body.code.includes(".")) {
          const { extractCodexAccountInfo } = await import("../services/providers/oauth/providers/index.ts") as { extractCodexAccountInfo: (token: string) => Record<string, string | undefined> };
          const info = extractCodexAccountInfo(body.code);
          let directPayload: Record<string, unknown> = {};
          try {
            const b64 = body.code.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
            directPayload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
          } catch { /* malformed payload */ }
          const accountId = info.chatgptAccountId || directPayload.account_id;
          const planType = info.chatgptPlanType || directPayload.plan_type;
          const email = info.email || directPayload.email;
          const data: Record<string, unknown> = { authMethod: "access_token" };
          if (accountId) data.chatgptAccountId = accountId;
          if (planType) data.chatgptPlanType = planType;
          const connection = runtime.repos.providers.create({
            provider,
            authType: "access_token",
            credentials: { accessToken: body.code },
            data,
            email: email || null,
            name: email || null,
          });
          return c.json({ success: true, connection: { id: connection.id, provider: connection.provider, email: connection.email, displayName: connection.name } });
        }
        const tokens = await exchangeTokens(provider, body.code, body.redirectUri, body.codeVerifier, body.state, body.meta);
        const connection = runtime.repos.providers.create({ ...connectionPayload(provider, tokens), authType: "oauth" });
        return c.json({ success: true, connection: { id: connection.id, provider: connection.provider, email: connection.email, displayName: connection.name } });
      }
      if (action === "poll") {
        if (typeof body.deviceCode !== "string" || !body.deviceCode) return c.json({ error: "Missing device code" }, 400);
        if (!NO_PKCE_POLL_PROVIDERS.has(provider) && typeof body.codeVerifier !== "string") return c.json({ error: "Missing code verifier" }, 400);
        const result = await pollForToken(provider, body.deviceCode, NO_PKCE_POLL_PROVIDERS.has(provider) ? null : body.codeVerifier, body.extraData);
        if (!result.success || !result.tokens) {
          const pending = result.pending || result.error === "authorization_pending" || result.error === "slow_down";
          return c.json({ success: false, error: result.error, errorDescription: result.errorDescription, pending });
        }
        const tokens = result.tokens as Record<string, any>;
        // Resolve the CodeBuddy account identity so repeated logins to the same
        // account reuse the existing connection instead of duplicating it.
        if (isCodebuddyProvider(provider) && typeof tokens?.accessToken === "string") {
          const account = await fetchCodebuddyAccount(provider, tokens.accessToken);
          if (account?.uid) {
            tokens.displayName = account.nickname || tokens.displayName;
            tokens.providerSpecificData = {
              ...(tokens.providerSpecificData && typeof tokens.providerSpecificData === "object" ? tokens.providerSpecificData : {}),
              codebuddyUserId: account.uid,
              codebuddyNickname: account.nickname,
              ...(account.enterpriseName ? { codebuddyEnterpriseName: account.enterpriseName } : {}),
            };
          }
        }
        const payload = connectionPayload(provider, tokens);
        const uid = (payload.data as Record<string, unknown>)?.codebuddyUserId;
        const existing = uid
          ? runtime.repos.providers.list(true).find((connection) => connection.provider === provider && connection.authType === "oauth" && connection.data.codebuddyUserId === uid)
          : null;
        const connection = existing
          ? runtime.repos.providers.update(existing.id, { ...payload, isActive: true }) ?? existing
          : runtime.repos.providers.create(payload);
        return c.json({ ...result, connection: { id: connection.id, provider: connection.provider, email: connection.email, displayName: connection.name } });
      }
      return c.json({ error: "Unknown action" }, 400);
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
  return app;
}
