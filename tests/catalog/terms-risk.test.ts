import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";

describe("The Terms Risk flag in the shipped Catalog", () => {
  it("flags Alibaba Token Plan, ClinePass, Kimi Code, Meta AI, MiniMax M Plan, OpenAI Codex, TokenRouter.com, Xiaomi MiMo Token Plan and Z.ai GLM Coding Plan and no other Provider", async () => {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);

    const flagged = catalog.filter((entry) => entry.termsRisk).map((entry) => entry.slug);

    expect(flagged.sort()).toEqual([
      "alibaba-token-plan",
      "clinepass",
      "kimi-code",
      "meta-ai",
      "minimax-m-plan",
      "openai-codex",
      "tokenrouter-com",
      "xiaomi-mimo-token-plan",
      "zai-coding-plan",
    ]);
  });
});
