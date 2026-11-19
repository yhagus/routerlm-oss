import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

describe("The Alibaba Model Studio (International) Catalog file's image models", () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "alibaba-model-studio-intl");
    if (!provider)
      throw new Error("the Catalog has no Alibaba Model Studio (International) Provider");
    return provider;
  }

  it("serves images from DashScope's native API next to the OpenAI-compatible chat endpoint", async () => {
    const { endpoints } = await shipped();

    expect(endpoints).toEqual(
      expect.arrayContaining([
        {
          kind: "chat",
          protocol: "openai-chat",
          baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        },
        {
          kind: "image",
          protocol: "dashscope-image",
          baseUrl: "https://dashscope-intl.aliyuncs.com/api/v1",
        },
      ]),
    );
  });

  it("ships the image models at Alibaba's Singapore list prices, with their input limits and Release Dates", async () => {
    const { upstreamModels } = await shipped();
    const imageModels = upstreamModels.filter((model) => model.kind === "image");

    expect(
      imageModels.map((model) => ({
        upstreamModelId: model.upstreamModelId,
        pricePerImage: model.pricePerImage,
        pricePerImageBySize: model.pricePerImageBySize,
        pricePerInputImage: model.pricePerInputImage,
        maxInputImages: model.maxInputImages,
        releaseDate: model.releaseDate,
      })),
    ).toEqual([
      {
        upstreamModelId: "qwen-image-3.0-pro",
        pricePerImage: null,
        pricePerImageBySize: { "1K": 0.04, "2K": 0.075 },
        pricePerInputImage: 0.003,
        maxInputImages: 3,
        releaseDate: "2026-07-20",
      },
      {
        upstreamModelId: "wan2.7-image",
        pricePerImage: 0.03,
        pricePerImageBySize: null,
        pricePerInputImage: null,
        maxInputImages: 9,
        releaseDate: "2026-04-01",
      },
      {
        upstreamModelId: "wan2.7-image-pro",
        pricePerImage: 0.075,
        pricePerImageBySize: null,
        pricePerInputImage: null,
        maxInputImages: 9,
        releaseDate: "2026-04-01",
      },
    ]);
  });

  it("lets only wan2.7-image-pro generate 4K images", async () => {
    const { upstreamModels } = await shipped();
    const sizesOf = (id: string) =>
      upstreamModels.find((model) => model.upstreamModelId === id)?.sizes ?? [];

    expect(sizesOf("wan2.7-image-pro")).toContain("4096*4096");
    expect(sizesOf("wan2.7-image")).not.toContain("4096*4096");
    expect(sizesOf("qwen-image-3.0-pro")).toContain("1024*1024");
  });
});
