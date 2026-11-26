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

  it("ships TokenRouter.com as one bearer-key Provider with an endpoint per wire format", async () => {
    const provider = await shipped("tokenrouter-com");

    expect(provider).toMatchObject({
      endpoints: [
        { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.tokenrouter.com/v1" },
        { kind: "chat", protocol: "openai-responses", baseUrl: "https://api.tokenrouter.com/v1" },
        { kind: "chat", protocol: "anthropic-messages", baseUrl: "https://api.tokenrouter.com" },
      ],
      authStyle: "bearer",
    });
  });

  it("lists each TokenRouter.com model with the Protocols TokenRouter.com serves it on", async () => {
    const { upstreamModels } = await shipped("tokenrouter-com");
    const protocolsOf = (id: string) =>
      upstreamModels.find((model) => model.upstreamModelId === id)?.protocols;

    expect({
      claude: protocolsOf("anthropic/claude-sonnet-5.5"),
      responsesOnly: protocolsOf("openai/gpt-6.2-sol"),
      chatAndResponses: protocolsOf("openai/gpt-6-sol"),
      chatOnly: protocolsOf("moonshotai/kimi-k3.1-pro"),
    }).toEqual({
      claude: ["anthropic-messages"],
      responsesOnly: ["openai-responses"],
      chatAndResponses: ["openai-chat", "openai-responses"],
      chatOnly: ["openai-chat"],
    });
  });

  it("prices TokenRouter.com models from the pricing ratios", async () => {
    const { upstreamModels } = await shipped("tokenrouter-com");

    expect(
      upstreamModels.find((model) => model.upstreamModelId === "moonshotai/kimi-k3.1-pro"),
    ).toMatchObject({ inputPrice: 0.6, outputPrice: 3, cacheReadPrice: 0.06 });
  });
});
