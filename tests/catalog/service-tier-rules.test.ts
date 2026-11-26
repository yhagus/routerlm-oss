import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog";

interface CatalogFile {
  endpoints: { protocol: string }[];
  serviceTierValues?: Record<string, string>;
  upstreamModels: { serviceTiers?: string[]; tierPrices?: Record<string, object> }[];
}

async function catalogWith(change: (provider: CatalogFile) => void): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "catalog-tiers-"));
  const shipped: CatalogFile = JSON.parse(
    await readFile(join(CATALOG_DIRECTORY, "anthropic.json"), "utf8"),
  );
  change(shipped);
  await writeFile(join(directory, "anthropic.json"), JSON.stringify(shipped));
  return directory;
}

describe("Catalog Service Tier rules", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function load(change: (provider: CatalogFile) => void) {
    const directory = await catalogWith(change);
    directories.push(directory);
    return loadCatalog(directory);
  }

  it("gives Service Tiers to OpenAI and OpenAI Codex only", async () => {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);

    const withTiers = catalog
      .filter((provider) => Object.keys(provider.serviceTierValues ?? {}).length > 0)
      .map((provider) => provider.slug)
      .sort();

    expect(withTiers).toEqual(["openai", "openai-codex"]);
  });

  it("refuses Service Tier values on a Protocol that never sends a tier", async () => {
    await expect(
      load((provider) => {
        provider.serviceTierValues = { fast: "priority" };
      }),
    ).rejects.toThrow(/Service Tiers fast don't apply to anthropic-messages/);
  });

  it("refuses an Upstream Model that lists a tier its Provider does not map", async () => {
    await expect(
      load((provider) => {
        provider.endpoints[0].protocol = "openai-chat";
        provider.upstreamModels[0].serviceTiers = ["fast"];
      }),
    ).rejects.toThrow(/lists Service Tiers fast that the Provider maps to no wire value/);
  });

  it("refuses prices for a tier the Upstream Model does not list", async () => {
    await expect(
      load((provider) => {
        provider.endpoints[0].protocol = "openai-chat";
        provider.serviceTierValues = { fast: "priority" };
        provider.upstreamModels[0].tierPrices = { fast: { inputPrice: 1 } };
      }),
    ).rejects.toThrow(/prices Service Tiers fast that it doesn't list/);
  });
});
