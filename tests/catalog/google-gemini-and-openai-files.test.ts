import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog";

describe("The Google Gemini and OpenAI Catalog files", () => {
  async function shipped(slug: string) {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === slug);
    if (!provider) throw new Error(`the Catalog has no ${slug} Provider`);
    return provider;
  }

  it("ships Google Gemini on its OpenAI compatibility endpoint with the Gemini 3.5 to 4 chat models", async () => {
    const provider = await shipped("google-gemini");

    expect(provider).toMatchObject({
      endpoints: [
        {
          kind: "chat",
          protocol: "openai-chat",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        },
      ],
      authStyle: "bearer",
      logo: "gemini",
    });
    expect(provider.termsRisk).toBeUndefined();
    expect(provider.upstreamModels.map((model) => model.upstreamModelId)).toEqual([
      "gemini-4-neon",
      "gemini-4-hydrogen",
      "gemini-4-carbon",
      "gemini-4-argon",
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.5-flash-lite",
    ]);
  });

  it("ships the GPT-6.2 Astra and Sol chat models", async () => {
    const { upstreamModels } = await shipped("openai");

    const gpt62 = upstreamModels.filter((model) => model.upstreamModelId.startsWith("gpt-6.2-"));

    expect(
      gpt62.map((model) => [model.upstreamModelId, model.inputPrice, model.outputPrice]),
    ).toEqual([
      ["gpt-6.2-astra", 8, 40],
      ["gpt-6.2-sol", 2, 10],
    ]);
  });

  it("names the models.dev provider only for the Providers that have a first-party one", async () => {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);

    const modelsDevIds = Object.fromEntries(
      catalog.map((provider) => [provider.slug, provider.modelsDevProviderId]),
    );

    expect(modelsDevIds).toEqual({
      "alibaba-model-studio-intl": "alibaba",
      "alibaba-token-plan": "alibaba-token-plan",
      anthropic: "anthropic",
      clinepass: "cline-pass",
      commandcode: undefined,
      deepseek: "deepseek",
      "google-gemini": "google",
      "kimi-code": undefined,
      "meta-ai": undefined,
      "minimax-api": "minimax",
      "minimax-m-plan": undefined,
      moonshot: "moonshotai",
      "openai-codex": undefined,
      openai: "openai",
      "opencode-go": "opencode-go",
      "tokenrouter-com": "tokenrouter",
      "tokenrouter-io": undefined,
      "xiaomi-mimo": "xiaomi",
      "xiaomi-mimo-token-plan": "xiaomi-token-plan-sgp",
      zai: "zai",
      "zai-coding-plan": "zai-coding-plan",
    });
  });
});
