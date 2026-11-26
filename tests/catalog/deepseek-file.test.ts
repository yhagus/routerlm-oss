import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog";

describe("The DeepSeek Catalog file", () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "deepseek");
    if (!provider) throw new Error("the Catalog has no DeepSeek Provider");
    return provider;
  }

  it("ships DeepSeek's off-peak hours as a UTC Pricing Window", async () => {
    const { pricingWindows } = await shipped();

    expect(pricingWindows).toMatchObject([{ name: "DeepSeek Off-Peak", timeZone: "UTC" }]);
  });

  it("prices DeepSeek Flash off-peak", async () => {
    const { upstreamModels } = await shipped();

    expect(
      upstreamModels.find((model) => model.upstreamModelId === "deepseek-flash")?.windowPrices,
    ).toMatchObject([{ pricingWindow: "DeepSeek Off-Peak", inputPrice: 0.15 }]);
  });
});
