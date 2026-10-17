export default {
  id: "experiential-labs",
  priority: 71,
  alias: "experiential-labs",
  aliases: [
    "explabs",
  ],
  uiAlias: "explabs",
  display: {
    name: "Experiential Labs",
    icon: "science",
    color: "#10B981",
    textIcon: "EL",
    website: "https://api.experientiallabs.ai",
    notice: {
      text: "OpenAI-compatible API. API key auth.",
      apiKeyUrl: "https://api.experientiallabs.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.experientiallabs.ai/v1/chat/completions",
    validateUrl: "https://api.experientiallabs.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.experientiallabs.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
