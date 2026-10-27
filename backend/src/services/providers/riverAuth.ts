import { proxyAwareFetch } from "../common/proxyFetch.ts";

const AUTH_URL = "https://auth.console.river.ai/user_management/authenticate";
const SESSION_LIFETIME_MS = 240_000;

export interface RiverSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string | null;
}

export interface RiverCredentialPair {
  refreshToken: string;
  clientId: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function riverCredentialPair(data: Record<string, unknown> | null | undefined): RiverCredentialPair | null {
  const refreshToken = text(data?.riverRefreshToken ?? data?.refreshToken);
  const clientId = text(data?.riverClientId ?? data?.clientId);
  if (!refreshToken || !clientId) return null;
  return { refreshToken, clientId };
}

function expiryFromToken(token: string): string {
  const payload = token.split(".")[1];
  if (payload) {
    try {
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
      if (typeof decoded.exp === "number" && Number.isFinite(decoded.exp)) {
        return new Date(decoded.exp * 1000).toISOString();
      }
    } catch {
      // Fall through to the fixed lifetime.
    }
  }
  return new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
}

export async function authenticateRiver(
  refreshToken: string,
  clientId: string,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<RiverSession> {
  const response = await proxyAwareFetch(
    AUTH_URL,
    {
      method: "POST",
      headers: {
        Cookie: `workos-session=${refreshToken}`,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_id: clientId, grant_type: "refresh_token" }),
    },
    proxyOptions,
  );

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`River AI authentication failed (${response.status})${responseText ? `: ${responseText.slice(0, 120)}` : ""}`);
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(responseText || "{}");
  } catch {
    throw new Error("River AI authentication returned an invalid response.");
  }

  const accessToken = text(payload.access_token);
  const nextRefreshToken = text(payload.refresh_token) || refreshToken;
  if (!accessToken) throw new Error("River AI authentication returned no access token.");

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt: expiryFromToken(accessToken),
    email: text(payload.user?.email) || null,
  };
}
