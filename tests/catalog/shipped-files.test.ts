import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';
import { quirksForeignToEndpoints } from '@/catalog/schemas/catalog.schema';

describe('Catalog files shipped with the gateway', () => {
  it('give every Provider a logo and only quirks its Protocols read', async () => {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);

    const misfits = catalog
      .map((provider) => ({
        slug: provider.slug,
        hasLogo: provider.logo !== undefined,
        foreignQuirks: quirksForeignToEndpoints(provider.endpoints, provider.quirks),
      }))
      .filter(({ hasLogo, foreignQuirks }) => !hasLogo || foreignQuirks.length > 0);

    expect(catalog).toHaveLength(24);
    expect(misfits).toEqual([]);
  });
});
