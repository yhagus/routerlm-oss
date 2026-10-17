// CodeBuddy international CLI (codebuddy-intl-cli) — same .ai backend as
// codebuddy-intl but with CLI platform identity. OAuth device-code flow uses
// platform=CLI instead of platform=ide.
export default {
  id: "codebuddy-intl-cli",
  alias: "cbai-cli",
  uiAlias: "cbai-cli",
  hidden: false,
  priority: 91,
  display: {
    name: "CodeBuddy CLI",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://www.codebuddy.ai",
    notice: {
      signupUrl: "https://www.codebuddy.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  serviceKinds: ["llm", "image"],
  transport: {
    // Chat gateway is OpenAI-compatible SSE (same /v2/chat/completions path as intl).
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    forceStream: true,
    thinkingFormat: "openai",
    headers: {
      "User-Agent": "CLI/2.154.0 CodeBuddy/2.154.0",
      "X-Product": "SaaS",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "x-requested-with": "XMLHttpRequest",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    usage: {
      // Same Tencent billing endpoint as codebuddy-cn/intl — returns the
      // data.Response.Data.Accounts[] shape. Only the X-IDE-Type: CLI
      // header differs from codebuddy-intl.
      url: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
    },
  },
  // Same model lineup as codebuddy-intl (shared .ai gateway).
  models: [
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5.0", name: "GLM-5.0" },
    { id: "glm-5.0-turbo", name: "GLM-5.0-Turbo" },
    { id: "glm-5v-turbo", name: "GLM-5v-Turbo" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "minimax-m2.7", name: "MiniMax-M2.7" },
    { id: "kimi-k2.7", name: "Kimi-K2.7-Code" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "kimi-k2.5", name: "Kimi-K2.5" },
    { id: "hy3-preview", name: "Hy3 Preview" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
    { id: "deepseek-v3-2-volc", name: "DeepSeek-V3.2" },
    { id: "gemini-2.5-flash-image", name: "Gemini-2.5-Flash-Image", kind: "image" },
    { id: "gemini-3.1-flash-image", name: "Gemini-3.1-Flash-Image", kind: "image" },
    { id: "gpt-image-2", name: "GPT-Image-2", kind: "image" },
  ],
  oauth: {
    baseUrl: "https://www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.154.0 CodeBuddy/2.154.0",
    platform: "CLI",
    pollInterval: 5000,
    refreshLeadMs: 10 * 60 * 1000,
    maxRefreshAgeMs: 2 * 60 * 60 * 1000,
    trackRefreshAt: true,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
