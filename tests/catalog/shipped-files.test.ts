import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import { chatEndpointOf, quirksForeignToProtocol } from "@/catalog/schemas/catalog.schema.js";

describe("Catalog files shipped with the gateway", () => {
  it("give every Provider a logo and only quirks its Protocol reads", async () => {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);

    const misfits = catalog
      .map((provider) => ({
        slug: provider.slug,
        hasLogo: provider.logo !== undefined,
        foreignQuirks: quirksForeignToProtocol(
          chatEndpointOf(provider.endpoints)?.protocol,
          provider.quirks,
        ),
      }))
      .filter(({ hasLogo, foreignQuirks }) => !hasLogo || foreignQuirks.length > 0);

    expect(catalog).toHaveLength(15);
    expect(misfits).toEqual([]);
  });
});
