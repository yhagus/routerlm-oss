import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { syncModelCatalog } from "../src/services/providers/modelSync";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: "/tmp/lobakai-v2-tests",
    REQUIRE_LOGIN: "false",
  }));
}

describe("model catalog sync", () => {
  test("seeds registry models into the models table", async () => {
    const instance = await runtime();
    try {
      syncModelCatalog(instance);
      const catalog = instance.repos.models.catalog();
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.some((model) => model.source === "registry")).toBe(true);
      expect(catalog.some((model) => String(model.id).includes("/"))).toBe(true);

      const codex = catalog.filter((model) => model.provider === "codex" && model.kind === "llm");
      expect(codex.length).toBeGreaterThan(0);
      for (const model of codex) expect(String(model.id)).toMatch(/^cx\//);
    } finally {
      instance.close();
    }
  });

  test("migrates legacy kv custom models once and clears the kv scope", async () => {
    const instance = await runtime();
    try {
      instance.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('customModels', 'openai|my-custom|llm', ?)").run(
        JSON.stringify({ provider: "openai", providerAlias: "openai", id: "my-custom", model: "my-custom", name: "My Custom", kind: "llm", type: "llm" }),
      );
      syncModelCatalog(instance);

      const custom = instance.repos.models.all();
      expect(custom.some((model) => model.id === "my-custom" && model.providerAlias === "openai")).toBe(true);

      const remaining = instance.sqlite.query("SELECT COUNT(*) AS c FROM kv WHERE scope = 'customModels'").get() as { c: number };
      expect(Number(remaining.c)).toBe(0);

      // Second sync must not duplicate (flag short-circuits).
      syncModelCatalog(instance);
      expect(instance.repos.models.all().filter((model) => model.id === "my-custom")).toHaveLength(1);
    } finally {
      instance.close();
    }
  });

  test("search endpoint returns catalog matches and respects disabled models", async () => {
    const instance = await runtime();
    try {
      syncModelCatalog(instance);
      const app = createApp(instance);

      const results = await app.request("/api/models/search?q=gpt");
      expect(results.status).toBe(200);
      const body = (await results.json()) as { models: Array<Record<string, unknown>> };
      expect(body.models.length).toBeGreaterThan(0);
      expect(body.models.every((model) => typeof model.id === "string" && model.id.includes("/"))).toBe(true);

      instance.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('disabledModels', 'cx', ?)").run(
        JSON.stringify(["gpt-5.6-sol"]),
      );
      const filtered = await app.request("/api/models/search?q=gpt-5.6-sol");
      const filteredBody = (await filtered.json()) as { models: Array<Record<string, unknown>> };
      expect(filteredBody.models.some((model) => model.id === "cx/gpt-5.6-sol")).toBe(false);
    } finally {
      instance.close();
    }
  });
});
