export default {
  id: "river",
  alias: "river",
  aliases: ["riverai", "river-ai"],
  uiAlias: "river",
  display: {
    name: "River AI",
    icon: "water",
    color: "#254F9F",
    textIcon: "RV",
    website: "https://river.ai",
    notice: {
      apiKeyUrl: "https://river.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.river.ai/v1/responses",
    format: "openai-responses",
    validateUrl: "https://api.river.ai/v1/models",
  },
  models: [
    { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
  ],
  passthroughModels: true,
};
