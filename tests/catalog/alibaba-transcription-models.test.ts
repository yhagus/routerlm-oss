import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

describe("The Alibaba Model Studio (International) Catalog file's transcription models", () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "alibaba-model-studio-intl");
    if (!provider)
      throw new Error("the Catalog has no Alibaba Model Studio (International) Provider");
    return provider;
  }

  it("serves transcription from DashScope's native API", async () => {
    const { endpoints } = await shipped();

    expect(endpoints).toContainEqual({
      kind: "transcription",
      protocol: "dashscope-transcription",
      baseUrl: "https://dashscope-intl.aliyuncs.com/api/v1",
    });
  });

  it("ships qwen-audio-3.0-asr-flash at $0.000035 per audio second, released 2026-07-30", async () => {
    const { upstreamModels } = await shipped();

    expect(
      upstreamModels
        .filter((model) => model.kind === "transcription")
        .map(({ upstreamModelId, pricePerAudioSecond, releaseDate }) => ({
          upstreamModelId,
          pricePerAudioSecond,
          releaseDate,
        })),
    ).toEqual([
      {
        upstreamModelId: "qwen-audio-3.0-asr-flash",
        pricePerAudioSecond: 0.000035,
        releaseDate: "2026-07-30",
      },
    ]);
  });
});
