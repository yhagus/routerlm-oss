export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  // Optional accounts hold an API key for paid models; free models stay public.
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {},
    noAuth: true,
  },
  models: [] as any[],
  modelsFetcher: { url: "https://opencode.ai/inference/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
