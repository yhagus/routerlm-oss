
// DeepSeek Harness (dsh) account route: OAuth-like PKCE browser flow against
// platform.deepseek.com auth-api, inference via Anthropic Messages format with
// the account token in x-dsh-auth-token (mirrors dsh llm-deepseek-account).
// The API-key route stays in the separate `deepseek` registry entry.
export default {
  id: "deepseek-harness",
  priority: 111,
  alias: "deepseek-harness",
  aliases: ["dsh"],
  display: {
    name: "DeepSeek Harness",
    icon: "hub",
    color: "#4D6BFE",
    textIcon: "DH",
    website: "https://deepseek.com/harness",
    notice: {
      signupUrl: "https://platform.deepseek.com",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.deepseek.com/anthropic/v1/messages",
    format: "claude",
    headers: {},
    auth: {
      combined: true,
      header: "x-dsh-auth-token",
      scheme: "raw",
      anthropicVersion: true,
      hooks: ["deepseekHarnessHeaders"],
    },
  },
  models: [
    { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
  serviceKinds: ["llm", "imageToText"],
  features: {
    // Balance display via /api/usage — wallet summary from the account token.
    usage: true,
  },
  oauth: {
    // dsh platform PKCE flow is handled by oauth/providers/deepseek-harness.ts;
    // these fields document the endpoints for UI/route glue.
    platformOrigin: "https://platform.deepseek.com",
    authInitPath: "/auth-api/v0/dsh/auth_init",
    authExchangePath: "/auth-api/v0/dsh/auth_exchange",
  },
};
