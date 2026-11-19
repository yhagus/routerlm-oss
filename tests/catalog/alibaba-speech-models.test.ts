import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

describe("The Alibaba Model Studio (International) Catalog file's speech models", () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "alibaba-model-studio-intl");
    if (!provider)
      throw new Error("the Catalog has no Alibaba Model Studio (International) Provider");
    return provider;
  }

  it("serves speech from DashScope's native API", async () => {
    const { endpoints } = await shipped();

    expect(endpoints).toContainEqual({
      kind: "speech",
      protocol: "dashscope-speech",
      baseUrl: "https://dashscope-intl.aliyuncs.com/api/v1",
    });
  });

  it("ships qwen-audio-3.0-tts-plus at $20 per million characters, released 2026-07-14", async () => {
    const { upstreamModels } = await shipped();

    expect(
      upstreamModels
        .filter((model) => model.kind === "speech")
        .map(({ upstreamModelId, pricePerMillionCharacters, releaseDate }) => ({
          upstreamModelId,
          pricePerMillionCharacters,
          releaseDate,
        })),
    ).toEqual([
      {
        upstreamModelId: "qwen-audio-3.0-tts-plus",
        pricePerMillionCharacters: 20,
        releaseDate: "2026-07-14",
      },
    ]);
  });
});
