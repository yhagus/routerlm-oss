export default {
  id: "dudul",
  priority: 117,
  alias: "dudul",
  aliases: [
    "dd",
  ],
  uiAlias: "dudul",
  display: {
    name: "Dudul",
    icon: "bolt",
    color: "#c2f046",
    textIcon: "DD",
    website: "https://dudul.dev",
    notice: {
      text: "OpenAI-compatible API. API key auth.",
      apiKeyUrl: "https://dudul.dev/",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dudul.dev/v1/chat/completions",
    validateUrl: "https://dudul.dev/v1/models",
    thinkingFormat: "openai",
  },
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "minimax-m3", name: "MiniMax M3" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
  ],
  modelsFetcher: { url: "https://dudul.dev/v1/models", type: "openai" },
  passthroughModels: true,
};
