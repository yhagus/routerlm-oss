import { PROVIDERS } from "../config/providers.ts";
import { REFRESH_LEAD_MS } from "../config/appConstants.ts";
import {
  refreshGrokCliToken,
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlCliToken,
  classifyOAuthRefreshError,
} from "./tokenRefresh/providers.ts";

// Re-export all provider refresh functions (preserves public API for all consumers)
export {
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshCodexToken,
  refreshCodebuddyToken,
  refreshCodebuddyIntlCliToken,
  classifyOAuthRefreshError,
};

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result: any) {
  return (
    result &&
    typeof result === "object" &&
    (result.error === "unrecoverable_refresh_error" ||
      result.error === "refresh_token_reused" ||
      result.error === "invalid_request" ||
      result.error === "invalid_grant")
  );
}

export function getRefreshLeadMs(provider: any) {
  if (REFRESH_LEAD_MS[provider]) return REFRESH_LEAD_MS[provider];
  return TOKEN_EXPIRY_BUFFER_MS;
}

const REFRESH_HANDLERS = {
  antigravity: (c: any, log: any) => refreshGoogleToken(c.refreshToken, PROVIDERS.antigravity.clientId, PROVIDERS.antigravity.clientSecret, log),
  claude: (c: any, log: any) => refreshClaudeOAuthToken(c.refreshToken, log),
  codex: (c: any, log: any) => refreshCodexToken(c.refreshToken, log),
  "grok-cli": (c: any, log: any) => refreshGrokCliToken(c.refreshToken, log),
  gcli: (c: any, log: any) => refreshGrokCliToken(c.refreshToken, log),
  "codebuddy-cn": (c: any, log: any) => refreshCodebuddyToken(c.refreshToken, log),
  "codebuddy-intl-cli": (c: any, log: any) => refreshCodebuddyIntlCliToken(c.refreshToken, log),
};

export async function getAccessToken(provider: any, credentials: any, log: any) {
  if (!credentials || !credentials.refreshToken || typeof credentials.refreshToken !== "string") {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }
  return _getAccessTokenInternal(provider, credentials, log);
}

async function _getAccessTokenInternal(provider: any, credentials: any, log: any) {
  const handler = (REFRESH_HANDLERS as Record<string, any>)[provider];
  if (!handler) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider for token refresh: ${provider}`);
    return null;
  }
  return handler(credentials, log);
}

export async function refreshTokenByProvider(provider: any, credentials: any, log: any) {
  if (!credentials.refreshToken) return null;
  const handler = (REFRESH_HANDLERS as Record<string, any>)[provider];
  return handler ? handler(credentials, log) : refreshAccessToken(provider, credentials.refreshToken, credentials, log);
}

export function formatProviderCredentials(provider: any, credentials: any, log: any) {
  const config = PROVIDERS[provider];
  if (!config) {
    log?.warn?.("TOKEN_REFRESH", `No configuration found for provider: ${provider}`);
    return null;
  }

  switch (provider) {
    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "codex":
    case "openai":
    case "grok-cli":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "antigravity":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken
      };
  }
}

export async function getAllAccessTokens(userInfo: any, log: any) {
  const results: Record<string, any> = {};
  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log);

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

export async function refreshWithRetry(refreshFn: any, maxRetries = 3, log: any = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise<any>(r => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (result) return result;
    } catch (error: any) {
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
