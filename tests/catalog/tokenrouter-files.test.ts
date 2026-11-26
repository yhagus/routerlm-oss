import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

describe("The TokenRouter Catalog files", () => {
  async function shipped(slug: string) {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === slug);
    if (!provider) throw new Error(`the Catalog has no ${slug} Provider`);
    return provider;
  }

  it("ships TokenRouter.io as a bring-your-own-key chat completions gateway", async () => {
    const provider = await shipped("tokenrouter-io");

    expect(provider).toMatchObject({
      name: "TokenRouter.io",
      endpoints: [
        { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.tokenrouter.io/v1" },
      ],
      authStyle: "bearer",
    });
    expect(provider.termsRisk).toBeUndefined();
    expect(provider.quirks.exhaustedErrorCodes).toBeUndefined();
  });

  it("splits TokenRouter.com into one Provider per wire format", async () => {
    const chat = await shipped("tokenrouter-com");
    const responses = await shipped("tokenrouter-com-responses");
    const anthropic = await shipped("tokenrouter-com-anthropic");

    expect([chat, responses, anthropic].map((provider) => provider.endpoints)).toEqual([
      [{ kind: "chat", protocol: "openai-chat", baseUrl: "https://api.tokenrouter.com/v1" }],
      [{ kind: "chat", protocol: "openai-responses", baseUrl: "https://api.tokenrouter.com/v1" }],
      [{ kind: "chat", protocol: "anthropic-messages", baseUrl: "https://api.tokenrouter.com" }],
    ]);
  });

  it("lists each TokenRouter.com model under exactly one of its Providers", async () => {
    const slugs = ["tokenrouter-com", "tokenrouter-com-responses", "tokenrouter-com-anthropic"];
    const providers = await Promise.all(slugs.map(shipped));

    const modelIds = providers.flatMap((provider) =>
      provider.upstreamModels.map((model) => model.upstreamModelId),
    );

    expect(new Set(modelIds).size).toBe(modelIds.length);
  });

  it("prices TokenRouter.com models from the pricing ratios", async () => {
    const { upstreamModels } = await shipped("tokenrouter-com");

    expect(
      upstreamModels.find((model) => model.upstreamModelId === "moonshotai/kimi-k3.1-pro"),
    ).toMatchObject({ inputPrice: 0.6, outputPrice: 3, cacheReadPrice: 0.06 });
  });
});
