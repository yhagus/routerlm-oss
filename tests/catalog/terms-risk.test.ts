import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

describe("The Terms Risk flag in the shipped Catalog", () => {
  it("flags Kimi Code, Meta AI, MiniMax M Plan and OpenAI Codex and no other Provider", async () => {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);

    const flagged = catalog.filter((entry) => entry.termsRisk).map((entry) => entry.slug);

    expect(flagged.sort()).toEqual(["kimi-code", "meta-ai", "minimax-m-plan", "openai-codex"]);
  });
});
