import { providerMeta } from "@/lib/providerMeta";

export type ProviderAuthMode =
  "oauth" | "apikey" | "cookie" | "none";

const oauthProviders = new Set([
  "claude",
  "antigravity",
  "codex",
  "qoder",
  "codebuddy-intl-cli",
  "grok-cli",
]);
const cookieProviders = new Set(["grok-web", "perplexity-web"]);
const apiKeyProviders = new Set([
  "openai",
  "anthropic",
  "deepgram",
  "assemblyai",
  "mistral",
  "glm",
  "glm-cn",
  "deepseek",
]);
const noAuthProviders = new Set([
  "opencode",
]);

export function providerAuthModes(
  providerId: string,
  compatible = false,
): ProviderAuthMode[] {
  if (compatible) return ["apikey"];
  const modes: ProviderAuthMode[] = [];
  // The v1 registry's authModes win when present, matching v1's
  // providerInfo.authModes.
  const metaModes = providerMeta(providerId).authModes;
  if (metaModes?.length) {
    for (const mode of metaModes) {
      if (
        mode === "oauth" ||
        mode === "apikey" ||
        mode === "cookie" ||
        mode === "none"
      ) {
        if (!modes.includes(mode)) modes.push(mode);
      }
    }
  }
  if (!metaModes?.length) {
    if (oauthProviders.has(providerId)) modes.push("oauth");
    if (apiKeyProviders.has(providerId)) modes.push("apikey");
    if (cookieProviders.has(providerId)) modes.push("cookie");
    if (noAuthProviders.has(providerId)) modes.push("none");
  } else {
    // Registry metadata can miss the cookie side-channel for web providers.
    if (cookieProviders.has(providerId) && !modes.includes("cookie"))
      modes.push("cookie");
  }
  return modes.length ? modes : ["apikey"];
}

export function providerAuthLabel(
  providerId: string,
  mode: ProviderAuthMode,
): string {
  if (providerId === "grok-cli" && mode === "oauth")
    return "Grok CLI Device Login";
  if (mode === "oauth") return "OAuth";
  if (mode === "cookie") return "Cookie";
  if (mode === "none") return "No credentials";
  return "API Key";
}

export function providerIsNoAuth(providerId: string): boolean {
  return noAuthProviders.has(providerId);
}
