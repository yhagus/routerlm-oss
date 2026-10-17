import { QoderService } from "./oauth/services/qoder.ts";
import { getProvider } from "./oauth/providers/index.ts";
import { refreshProviderCredentials } from "./oauth/oauthCredentialManager.ts";
import type { ProviderConnection, Repositories } from "../../db/repositories";

type ProviderRepo = Repositories["providers"];
type Json = Record<string, unknown>;

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function firstString(...values: unknown[]): string {
  return values.map(string).find(Boolean) || "";
}

function decodeJwtPayload(token: unknown): Json {
  const value = string(token);
  try {
    const part = value.split(".")[1];
    if (!part) return {};
    return JSON.parse(Buffer.from(part.replaceAll("-", "+").replaceAll("_", "/"), "base64url").toString("utf8")) as Json;
  } catch {
    return {};
  }
}

function expiryFrom(value: Json, fallbackMs = 60 * 60 * 1000): string {
  const explicit = value.expiresAt || value.expires_at || value.expired;
  if (typeof explicit === "string" && Number.isFinite(new Date(explicit).getTime())) return new Date(explicit).toISOString();
  const seconds = Number(value.expiresIn ?? value.expires_in);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(Date.now() + seconds * 1000).toISOString();
  const payload = decodeJwtPayload(value.idToken || value.id_token || value.accessToken || value.access_token);
  if (typeof payload.exp === "number") return new Date(payload.exp * 1000).toISOString();
  return new Date(Date.now() + fallbackMs).toISOString();
}

function safeConnection(connection: ProviderConnection): Json {
  return { id: connection.id, provider: connection.provider, email: connection.email, name: connection.name };
}

// Import failures can include upstream payloads. Do not reflect credentials in errors.
export function redactSecrets(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value || "Unknown error");
  return text
    .replace(/((?:access|refresh|id)[_-]?token|api[_-]?key|cookie|authorization|client[_-]?secret|code[_-]?verifier)\s*[:=]\s*\S+/gi, "$1[REDACTED]")
    .replace(/\b(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|(?:sk|pt|dt)-[a-zA-Z0-9_-]{8,})\b/g, "[REDACTED]");
}

function normalizedAccounts(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  const input = object(body);
  if (Array.isArray(input.accounts)) return input.accounts;
  return Object.keys(input).length ? [input] : null;
}

function providerData(input: Json, credentials: Json): Json {
  return {
    ...object(input.providerSpecificData),
    ...object(input.data),
    ...credentials,
    ...(input.expiresAt || input.expires_at || input.expiresIn || input.expires_in ? { expiresAt: expiryFrom(input) } : {}),
    ...(input.scope || input.tokenScope ? { scope: input.scope || input.tokenScope } : {}),
    testStatus: typeof input.testStatus === "string" ? input.testStatus : "active",
    lastRefreshAt: typeof input.lastRefreshAt === "string" ? input.lastRefreshAt : new Date().toISOString(),
  };
}

export function importCodexAccounts(providers: ProviderRepo, body: unknown) {
  const accounts = normalizedAccounts(body);
  if (!accounts?.length) throw new Error("No accounts provided");
  const results: Json[] = [];
  for (const [index, raw] of accounts.entries()) {
    try {
      const input = object(raw);
      // Accept both flat fields (accessToken/refreshToken/idToken) and the
      // nested `tokens` shape emitted by POST /api/providers/export/codex,
      // so exported accounts round-trip back through bulk import.
      const tokens = object(input.tokens);
      const accessToken = string(input.accessToken || input.access_token || tokens.access_token);
      if (!accessToken) throw new Error("Missing accessToken");
      const refreshToken = string(input.refreshToken || input.refresh_token || tokens.refresh_token);
      const idToken = string(input.idToken || input.id_token || tokens.id_token);
      const accountId = string(input.chatgptAccountId || input.chatgpt_account_id || tokens.account_id);
      const payload = decodeJwtPayload(idToken || accessToken);
      const auth = object(payload["https://api.openai.com/auth"]);
      const profile = object(payload["https://api.openai.com/profile"]);
      const source = object(input.providerSpecificData);
      const email = firstString(input.email, profile.email, payload.email, payload.preferred_username);
      const data = providerData(input, {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(idToken ? { idToken } : {}),
        ...(!source.chatgptAccountId && (auth.chatgpt_account_id || accountId) ? { chatgptAccountId: auth.chatgpt_account_id || accountId } : {}),
        ...(!source.chatgptPlanType && auth.chatgpt_plan_type ? { chatgptPlanType: auth.chatgpt_plan_type } : {}),
      });
      const connection = providers.create({
        provider: "codex", authType: "oauth", name: firstString(input.name, email) || `Codex ${index + 1}`,
        email: email || null, isActive: input.isActive !== false, priority: input.priority, data,
      });
      results.push({ index, ok: true, id: connection.id });
    } catch (error: any) {
      results.push({ index, ok: false, error: redactSecrets(error) });
    }
  }
  return { success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}

export function importCodexAccessToken(providers: ProviderRepo, input: Json) {
  const accessToken = string(input.accessToken);
  if (!accessToken) throw new Error("Access token is required");
  const payload = decodeJwtPayload(accessToken);
  const auth = object(payload["https://api.openai.com/auth"]);
  const profile = object(payload["https://api.openai.com/profile"]);
  const email = firstString(profile.email, payload.email, payload.preferred_username);
  const data = providerData({}, {
    accessToken,
    authMethod: "access_token",
    ...(auth.chatgpt_account_id ? { chatgptAccountId: auth.chatgpt_account_id } : {}),
    ...(auth.chatgpt_plan_type ? { chatgptPlanType: auth.chatgpt_plan_type } : {}),
    ...(payload.exp ? { jwtExp: payload.exp } : {}),
  });
  const connection = providers.create({ provider: "codex", authType: "access_token", name: string(input.name) || email || "ChatGPT Access Token", email: email || null, data });
  return { success: true, connection: { ...safeConnection(connection), workspace: data.chatgptAccountId || null, plan: data.chatgptPlanType || null } };
}

function grokAccount(connection: ProviderConnection): Json {
  const data = connection.data;
  return {
    provider: "grok_build",
    name: firstString(connection.name, connection.email, data.email),
    // Credentials are intentionally redacted. Import accepts the same shape.
    client_id: string(getProvider("grok-cli").config?.clientId),
    access_token: "[REDACTED]",
    refresh_token: "[REDACTED]",
    id_token: "[REDACTED]",
    token_type: firstString(data.tokenType) || "Bearer",
    scope: firstString(data.scope), expires_at: firstString(data.expiresAt), expires_in: Number(data.expiresIn) || 0,
    email: firstString(connection.email, data.email), sub: firstString(data.sub), user_id: firstString(data.userId, data.principalId),
    principal_id: firstString(data.principalId), team_id: firstString(data.teamId),
  };
}

export function exportGrokAccounts(providers: ProviderRepo) {
  return { accounts: providers.list(true).filter((connection) => connection.provider === "grok-cli").map(grokAccount) };
}

export async function importGrokAccounts(providers: ProviderRepo, body: unknown) {
  const accounts = normalizedAccounts(body);
  if (!accounts?.length) throw new Error("No accounts provided");
  const results: Json[] = [];
  for (const [index, raw] of accounts.entries()) {
    try {
      const input = object(raw);
      const refreshToken = firstString(input.refreshToken, input.refresh_token, input.oauth_refresh_token);
      if (!refreshToken) throw new Error("Missing refresh token");
      const refreshed = await refreshProviderCredentials("grok-cli", { refreshToken });
      if (!refreshed || refreshed.error || !refreshed.accessToken) {
        throw new Error(refreshed?.error === "invalid_grant" ? "Refresh token is invalid, expired, or revoked" : "Unable to refresh Grok CLI token");
      }
      const provider = getProvider("grok-cli");
      const source = object(input.providerSpecificData);
      const rawTokens = {
        access_token: refreshed.accessToken, refresh_token: refreshed.refreshToken || refreshToken,
        ...(refreshed.idToken || input.idToken || input.id_token || source.idToken ? { id_token: refreshed.idToken || input.idToken || input.id_token || source.idToken } : {}),
        ...(refreshed.expiresIn || input.expiresIn || input.expires_in ? { expires_in: refreshed.expiresIn || input.expiresIn || input.expires_in } : {}),
        ...(input.scope || input.tokenScope ? { scope: input.scope || input.tokenScope } : {}),
      };
      let extra: Json = { user: null };
      try { extra = await provider.postExchange(rawTokens) || extra; } catch { /* profile lookup is best effort */ }
      const mapped = provider.mapTokens(rawTokens, extra);
      const mappedData = object(mapped.providerSpecificData);
      const email = firstString(mapped.email, input.email, source.email);
      const data = providerData({ ...input, ...mapped, providerSpecificData: { ...source, ...mappedData, authMethod: "device_code", ...(email ? { email } : {}) } }, {
        accessToken: mapped.accessToken, refreshToken: mapped.refreshToken || refreshToken,
        ...(mappedData.idToken ? { idToken: mappedData.idToken } : {}),
      });
      const connection = providers.create({ provider: "grok-cli", authType: "oauth", name: firstString(mapped.displayName, input.displayName, input.name, email) || `Grok CLI ${index + 1}`, email: email || null, data });
      results.push({ index, ok: true, id: connection.id, email: connection.email });
    } catch (error: any) { results.push({ index, ok: false, error: redactSecrets(error) }); }
  }
  return { success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}

export async function importCodebuddyIntlCliAccounts(providers: ProviderRepo, body: unknown) {
  const accounts = normalizedAccounts(body);
  if (!accounts?.length) throw new Error("No accounts provided");
  const results: Json[] = [];
  for (const [index, raw] of accounts.entries()) {
    try {
      const input = object(raw);
      const refreshToken = firstString(input.refreshToken, input.refresh_token);
      if (!refreshToken) throw new Error("Missing refresh token");
      const refreshed = await refreshProviderCredentials("codebuddy-intl-cli", { refreshToken });
      if (!refreshed || refreshed.error || !refreshed.accessToken) {
        throw new Error(refreshed?.error === "invalid_grant" ? "Refresh token is invalid, expired, or revoked" : "Unable to refresh CodeBuddy Intl CLI token");
      }
      // Decode the access token JWT to extract the email/username for
      // deduplication. The input may carry no name/email at all (bulk
      // import from raw refresh tokens), so the JWT is the only source.
      const payload = decodeJwtPayload(refreshed.accessToken);
      const tokenEmail = firstString(payload.email, payload.preferred_username, payload.sub) || null;
      const tokenName = firstString(payload.name, payload.given_name, payload.preferred_username) || tokenEmail || null;
      const name = firstString(input.name, input.email) || tokenName || tokenEmail || `CodeBuddy CLI ${index + 1}`;
      const email = firstString(input.email) || tokenEmail;
      const data = providerData({}, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || refreshToken,
      });
      // Re-check for an existing connection right before create — the
      // refresh call above is async, so concurrent jobs may have created
      // a matching connection while this one was refreshing. Match by
      // email first (most specific), then by name.
      const existing = providers.list(true).find((c: any) => c.provider === "codebuddy-intl-cli" && (
        (email && c.email === email) || (name && c.name === name)
      ));
      if (existing) {
        providers.update(existing.id, { data, name, email, lastError: null });
        results.push({ index, ok: true, id: existing.id });
      } else {
        const connection = providers.create({ provider: "codebuddy-intl-cli", authType: "oauth", name, email, data });
        results.push({ index, ok: true, id: connection.id });
      }
    } catch (error: any) { results.push({ index, ok: false, error: redactSecrets(error) }); }
  }
  return { success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}

export async function importQoderAccounts(providers: ProviderRepo, input: Json) {
  if (!Array.isArray(input.accounts) || !input.accounts.length) throw new Error("No accounts provided");
  const results: Json[] = []; const service = new QoderService();
  for (const [index, raw] of input.accounts.entries()) {
    try {
      const account = object(raw); const pat = firstString(account.pat, account.personalAccessToken, account.personal_access_token); const deviceToken = firstString(account.deviceToken, account.accessToken); const machineId = string(account.machineId) || crypto.randomUUID();
      let accessToken = ""; let refreshToken = ""; let expiresAt = ""; let userId = firstString(account.userId, account.uid); let name = string(account.name); let email = string(account.email); let organizationId = ""; let personalAccessToken = ""; let authMethod = "device";
      if (pat) { const exchanged = await service.loginWithPAT(pat); accessToken = exchanged.accessToken; refreshToken = exchanged.refreshToken || ""; expiresAt = exchanged.expireTime ? new Date(exchanged.expireTime).toISOString() : ""; userId ||= exchanged.userId || ""; name ||= exchanged.name || ""; email ||= exchanged.email || ""; organizationId = exchanged.organizationId || ""; personalAccessToken = exchanged.personalAccessToken || pat; authMethod = "pat"; if (!userId) throw new Error("PAT exchange succeeded but userId is missing (userinfo failed)"); }
      else if (deviceToken) { if (!userId) throw new Error("Missing userId (required with deviceToken)"); accessToken = deviceToken; } else throw new Error("Missing pat or deviceToken");
      const data = providerData({}, { accessToken, ...(refreshToken ? { refreshToken } : {}), ...(expiresAt ? { expiresAt } : {}), authMethod, userId, machineId, organizationId, ...(personalAccessToken ? { personalAccessToken } : {}) });
      const connection = providers.create({ provider: "qoder", authType: "oauth", name: name || `Qoder ${index + 1}`, email: email || (userId ? `qoder-user-${userId}` : null), data });
      results.push({ index, ok: true, id: connection.id, authMethod });
    } catch (error: any) { results.push({ index, ok: false, error: redactSecrets(error) }); }
  }
  return { success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}
