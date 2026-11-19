import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

describe("The Alibaba Model Studio (International) Catalog file's video models", () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "alibaba-model-studio-intl");
    if (!provider)
      throw new Error("the Catalog has no Alibaba Model Studio (International) Provider");
    return provider;
  }

  it("serves video from DashScope's native API", async () => {
    const { endpoints } = await shipped();

    expect(endpoints).toContainEqual({
      kind: "video",
      protocol: "dashscope-video",
      baseUrl: "https://dashscope-intl.aliyuncs.com/api/v1",
    });
  });

  it("ships the video models at Alibaba's Singapore list prices per second, with their Capabilities, durations and input-image limits", async () => {
    const { upstreamModels } = await shipped();
    const videoModels = upstreamModels.filter((model) => model.kind === "video");

    expect(
      videoModels.map((model) => ({
        upstreamModelId: model.upstreamModelId,
        capabilities: model.capabilities,
        pricePerSecondByResolution: model.pricePerSecondByResolution,
        minDurationSeconds: model.minDurationSeconds,
        maxDurationSeconds: model.maxDurationSeconds,
        maxInputImages: model.maxInputImages,
        resolutions: model.resolutions,
        releaseDate: model.releaseDate,
      })),
    ).toEqual([
      {
        upstreamModelId: "wan3.0-video",
        capabilities: ["text-to-video", "first-frame", "last-frame", "reference-images"],
        pricePerSecondByResolution: { "480P": 0.05, "720P": 0.1, "1080P": 0.2 },
        minDurationSeconds: 2,
        maxDurationSeconds: 30,
        maxInputImages: 10,
        resolutions: ["480P", "720P", "1080P"],
        releaseDate: "2026-08-06",
      },
      {
        upstreamModelId: "happyhorse-1.1-t2v",
        capabilities: ["text-to-video"],
        pricePerSecondByResolution: { "480P": 0.07, "720P": 0.14, "1080P": 0.18 },
        minDurationSeconds: 3,
        maxDurationSeconds: 15,
        maxInputImages: 0,
        resolutions: ["480P", "720P", "1080P"],
        releaseDate: "2026-06-16",
      },
      {
        upstreamModelId: "happyhorse-1.1-i2v",
        capabilities: ["first-frame"],
        pricePerSecondByResolution: { "480P": 0.07, "720P": 0.14, "1080P": 0.18 },
        minDurationSeconds: 3,
        maxDurationSeconds: 15,
        maxInputImages: 1,
        resolutions: ["480P", "720P", "1080P"],
        releaseDate: "2026-06-16",
      },
      {
        upstreamModelId: "happyhorse-1.1-r2v",
        capabilities: ["reference-images"],
        pricePerSecondByResolution: { "480P": 0.07, "720P": 0.14, "1080P": 0.18 },
        minDurationSeconds: 3,
        maxDurationSeconds: 15,
        maxInputImages: 9,
        resolutions: ["480P", "720P", "1080P"],
        releaseDate: "2026-06-16",
      },
    ]);
  });
});
