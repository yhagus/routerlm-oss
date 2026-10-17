import { describe, expect, test } from "bun:test";
import { FORMATS } from "../src/services/chat/translator/formats.ts";
import { stripUnsupportedModalities } from "../src/services/chat/translator/concerns/modality.ts";
import { reorderByCapabilities } from "../src/services/chat/combo.ts";
import { getCapabilitiesForModel } from "../src/services/providers/capabilities.ts";
import { applyCapabilityOverride } from "../src/services/providers/modelCapabilityOverrides.ts";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: "/tmp/lobakai-v2-tests",
    REQUIRE_LOGIN: "false",
  }));
}

describe("model capability overrides", () => {
  test("codebuddy vision resolves through both provider id and alias", () => {
    for (const key of ["codebuddy-intl-cli", "cbai-cli"]) {
      const caps = getCapabilitiesForModel(key, "glm-5v-turbo");
      expect(caps.vision).toBe(true);
    }
    // A text-only sibling stays text-only (no false-positive vision).
    expect(getCapabilitiesForModel("cbai-cli", "glm-5.2").vision).toBe(false);
  });

  test("codebuddy-intl-cli keeps images for a vision model instead of stripping them", () => {
    const caps = getCapabilitiesForModel("cbai-cli", "glm-5v-turbo") as Record<string, unknown>;
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,aa" } }] }],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    const content = body.messages[0].content as Array<{ type: string; text?: string }>;
    expect(content.some((block) => block.type === "image_url")).toBe(true);
    expect(content.some((block) => String(block.text || "").includes("image omitted"))).toBe(false);
  });

  test("stored vision false strips images from a grok model", () => {
    const caps = applyCapabilityOverride(
      getCapabilitiesForModel("gcli", "grok-4.6-high") as Record<string, unknown>,
      { vision: false },
    );
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,aa" } }] }],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    const content = body.messages[0].content as Array<{ type: string; text?: string }>;
    expect(content.some((block) => block.type === "image_url")).toBe(false);
    expect(content.some((block) => String(block.text || "").includes("image omitted"))).toBe(true);
  });

  test("stored vision true keeps images and raises combo priority", () => {
    const caps = applyCapabilityOverride(
      getCapabilitiesForModel("local", "my-model") as Record<string, unknown>,
      { vision: true },
    );
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,aa" } }] }],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    const content = body.messages[0].content as Array<{ type: string }>;
    expect(content.some((block) => block.type === "image_url")).toBe(true);

    const resolveCaps = (provider: string, model: string) =>
      model === "my-model" ? caps : getCapabilitiesForModel(provider, model);
    const ordered = reorderByCapabilities(
      ["gcli/grok-code-fast-1", "local/my-model"],
      new Set(["vision"]),
      resolveCaps,
    );
    expect(ordered[0]).toBe("local/my-model");
  });

  test("persists a capability override and writes it onto a custom model", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await app.request("/api/models/custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerAlias: "gcli", id: "grok-4.6-high", type: "llm" }),
      });
      expect(created.status).toBe(201);

      const saved = await app.request("/api/models/capabilities", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "gcli",
          model: "grok-4.6-high",
          capabilities: { vision: false, reasoning: true },
        }),
      });
      expect(saved.status).toBe(200);

      const listed = await app.request("/api/models/capabilities?provider=gcli");
      expect((await listed.json()).overrides["grok-4.6-high"].vision).toBe(false);

      const custom = await app.request("/api/models/custom");
      const row = (await custom.json()).models.find((model: Record<string, unknown>) => model.id === "grok-4.6-high");
      expect(row.capabilities.vision).toBe(false);
    } finally {
      instance.close();
    }
  });
});
