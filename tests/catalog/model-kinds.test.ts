import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

interface CatalogFile {
  upstreamModels: { kind?: string }[];
}

describe("Catalog Model Kinds", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "catalog-kinds-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("refuses an Upstream Model of a Kind its Provider has no endpoint for, naming the Kind", async () => {
    const shipped: CatalogFile = JSON.parse(
      await readFile(join(CATALOG_DIRECTORY, "anthropic.json"), "utf8"),
    );
    shipped.upstreamModels[0].kind = "video";
    await writeFile(join(directory, "anthropic.json"), JSON.stringify(shipped));

    await expect(loadCatalog(directory)).rejects.toThrow(
      /Catalog anthropic\.json: the Provider has no endpoint for the Kind video/,
    );
  });
});
