import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The Command Code and OpenCode Go Catalog files', () => {
  async function shipped(slug: string) {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === slug);
    if (!provider) throw new Error(`the Catalog has no ${slug} Provider`);
    return provider;
  }

  it("makes OpenCode Go forward the client's user agent and session", async () => {
    const { quirks } = await shipped('opencode-go');

    expect(quirks.forwardedClientHeaders).toEqual(['user-agent', 'x-opencode-session']);
  });

  it.each(['commandcode', 'opencode-go'])(
    'leaves %s with no exhausted error codes and no quota reader until a real Error Capture shows them',
    async (slug) => {
      const provider = await shipped(slug);

      expect(provider.quirks.exhaustedErrorCodes).toBeUndefined();
      expect(provider.quotaReader).toBeUndefined();
    },
  );
});
