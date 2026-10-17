/**
 * OAuth Configuration Constants — static data lives in registry, re-exported here for consumers.
 */
import { platform, arch } from "os";
import { ANTIGRAVITY_OAUTH_CLIENT } from "../../registryShared.ts";
import { PROVIDER_OAUTH } from "../../index.ts";

/**
 * Get the platform enum value based on the current OS.
 * Matches Antigravity binary's ClientMetadata.Platform enum.
 */
function getOAuthPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? 2 : 1;
  if (os === "linux") return architecture === "arm64" ? 4 : 3;
  if (os === "win32") return 5;
  return 0;
}

// Claude OAuth Configuration (Authorization Code Flow with PKCE)
export const CLAUDE_CONFIG = { ...PROVIDER_OAUTH["claude"] };

// Codex (OpenAI) OAuth Configuration (Authorization Code Flow with PKCE)
export const CODEX_CONFIG = { ...PROVIDER_OAUTH["codex"] };

// Qoder OAuth Configuration (Device Token Flow with PKCE).
// Device tokens are long-lived (~30 days for access, ~360 for refresh).
// The upstream refresh endpoint at center.qoder.sh returns 403 for our
// flow — we accept that and surface it to the user as "re-login" instead
// of attempting to silently rotate.
export const QODER_CONFIG = { ...PROVIDER_OAUTH["qoder"] };

// Antigravity OAuth Configuration (Standard OAuth2 with Google)
// clientId/clientSecret from ANTIGRAVITY_OAUTH_CLIENT (shared.js) — not stored in registry
// loadCodeAssistClientMetadata is dynamic (runtime platform detection)
// Endpoints: project discovery on PROD, chat traffic on daily (see registry)
export const ANTIGRAVITY_CONFIG = {
  ...ANTIGRAVITY_OAUTH_CLIENT,
  ...PROVIDER_OAUTH["antigravity"],
  loadCodeAssistClientMetadata: JSON.stringify({ ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }),
  loadCodeAssistUserAgent: "google-api-nodejs-client/9.15.1",
  loadCodeAssistApiClient: "google-cloud-sdk vscode_cloudshelleditor/0.1",
};

/**
 * Get client metadata using numeric enum values for API calls.
 * @returns {{ ideType: number, platform: number, pluginType: number }}
 */
export function getOAuthClientMetadata() {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 };
}

// OpenAI OAuth Configuration (Authorization Code Flow with PKCE)
export const OPENAI_CONFIG = { ...PROVIDER_OAUTH["openai"] };

// CodeBuddy (Tencent) OAuth Configuration (Browser OAuth Polling Flow)
export const CODEBUDDY_CONFIG = { ...PROVIDER_OAUTH["codebuddy-cn"] };

// CodeBuddy International CLI — same .ai domain but CLI platform identity.
export const CODEBUDDY_INTL_CLI_CONFIG = { ...PROVIDER_OAUTH["codebuddy-intl-cli"] };

// Grok CLI / Grok Build OAuth Configuration (Device Code Flow)
// Endpoint: cli-chat-proxy.grok.com — xAI OAuth client, device-code flow
export const GROK_CLI_CONFIG = { ...PROVIDER_OAUTH["grok-cli"] };

// OAuth timeout (5 minutes)
export const OAUTH_TIMEOUT = 300000;

// Provider list
export const PROVIDERS = {
  CLAUDE: "claude",
  CODEX: "codex",
  QODER: "qoder",
  ANTIGRAVITY: "antigravity",
  OPENAI: "openai",
  CODEBUDDY: "codebuddy-cn",
  CODEBUDDY_INTL_CLI: "codebuddy-intl-cli",
  GROK_CLI: "grok-cli",
};
