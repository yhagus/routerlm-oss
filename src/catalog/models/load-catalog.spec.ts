import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_DIRECTORY, loadCatalog } from "./load-catalog.js";

const validProvider = {
  slug: "example",
  name: "Example",
  protocol: "openai-chat",
  baseUrl: "https://api.example.com/v1",
  authStyle: "bearer",
  quirks: {},
  source: { urls: ["https://example.com/docs"], retrievedOn: "2026-11-15" },
  upstreamModels: [
    {
      upstreamModelId: "example-small",
      capabilities: ["tools"],
      contextSize: 128000,
      maxOutputTokens: null,
      inputPrice: 1,
      outputPrice: 2,
      cacheReadPrice: null,
      cacheWritePrice: null,
      source: { urls: ["https://example.com/pricing"], retrievedOn: "2026-11-15" },
    },
  ],
};

describe("loadCatalog", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "catalog-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("loads every Provider file shipped with the gateway", async () => {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);

    expect(catalog.map((provider) => provider.slug).sort()).toEqual([
      "alibaba-model-studio-intl",
      "anthropic",
      "deepseek",
      "kimi-code",
      "minimax",
      "moonshot",
      "openai",
      "xiaomi-mimo",
    ]);
  });

  it("names the file and Upstream Model of a malformed entry", async () => {
    const withoutSource = { ...validProvider.upstreamModels[0], source: undefined };
    await writeFile(
      join(directory, "example.json"),
      JSON.stringify({ ...validProvider, upstreamModels: [withoutSource] }),
    );

    await expect(loadCatalog(directory)).rejects.toThrow(
      /example\.json: upstreamModels\[0\] \(example-small\)\.source/,
    );
  });

  it("rejects an unknown quirk key so a typo can't silently do nothing", async () => {
    await writeFile(
      join(directory, "example.json"),
      JSON.stringify({ ...validProvider, quirks: { acceptsCacheControll: true } }),
    );

    await expect(loadCatalog(directory)).rejects.toThrow(/example\.json: quirks/);
  });

  it("rejects two files declaring the same Provider slug", async () => {
    await writeFile(join(directory, "a.json"), JSON.stringify(validProvider));
    await writeFile(join(directory, "b.json"), JSON.stringify(validProvider));

    await expect(loadCatalog(directory)).rejects.toThrow(/b\.json: slug "example"/);
  });
});
