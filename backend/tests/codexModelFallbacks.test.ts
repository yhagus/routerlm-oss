import { describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { codexFallbackModelsFor, codexModelFallbacks } from "../src/services/chat/credentials";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codex-model-fallbacks-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("codexModelFallbacks", () => {
  test("returns an empty map when no fallbacks are configured", async () => {
    const instance = await runtime();
    try {
      expect(codexModelFallbacks(instance)).toEqual({});
      expect(codexFallbackModelsFor(instance, "gpt-5.6-sol")).toEqual([]);
    } finally {
      instance.close();
    }
  });

  test("returns the configured chain for a model, in priority order", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({
        codex: { modelFallbacks: { "gpt-5.6-sol": ["gpt-5.6-terra", "gpt-5.5"] } },
      });
      expect(codexFallbackModelsFor(instance, "gpt-5.6-sol")).toEqual(["gpt-5.6-terra", "gpt-5.5"]);
    } finally {
      instance.close();
    }
  });

  test("strips provider prefixes from both keys and entries", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({
        codex: { modelFallbacks: { "codex/gpt-5.6-sol": ["codex/gpt-5.6-terra"] } },
      });
      // Lookup by bare id and by prefixed id both resolve.
      expect(codexFallbackModelsFor(instance, "gpt-5.6-sol")).toEqual(["gpt-5.6-terra"]);
      expect(codexFallbackModelsFor(instance, "codex/gpt-5.6-sol")).toEqual(["gpt-5.6-terra"]);
    } finally {
      instance.close();
    }
  });

  test("drops self-references so a model never falls back to itself", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({
        codex: { modelFallbacks: { "gpt-5.6-sol": ["gpt-5.6-sol", "gpt-5.6-terra"] } },
      });
      expect(codexFallbackModelsFor(instance, "gpt-5.6-sol")).toEqual(["gpt-5.6-terra"]);
    } finally {
      instance.close();
    }
  });

  test("ignores entries that are not arrays and non-string members", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({
        codex: {
          modelFallbacks: {
            "gpt-5.6-sol": ["gpt-5.6-terra", 42, null, "gpt-5.5"],
            "gpt-6-sol": "gpt-6-terra",
            "gpt-7": [],
          },
        },
      });
      const map = codexModelFallbacks(instance);
      // Non-string members filtered; empty chains dropped from the map.
      expect(map["gpt-5.6-sol"]).toEqual(["gpt-5.6-terra", "gpt-5.5"]);
      expect(map["gpt-6-sol"]).toBeUndefined();
      expect(map["gpt-7"]).toBeUndefined();
    } finally {
      instance.close();
    }
  });

  test("treats a malformed setting as no fallbacks", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ codex: { modelFallbacks: "gpt-5.6-terra" } });
      expect(codexModelFallbacks(instance)).toEqual({});
      expect(codexFallbackModelsFor(instance, "gpt-5.6-sol")).toEqual([]);
    } finally {
      instance.close();
    }
  });

  test("updating modelFallbacks does not clobber planModelMap (and vice versa)", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ codex: { planModelMap: { free: ["gpt-5.6-terra"] } } });
      // Simulate the frontend save, which re-sends the whole codex object.
      const before = (instance.repos.settings.get() as Record<string, any>).codex || {};
      instance.repos.settings.update({ codex: { ...before, modelFallbacks: { "gpt-5.6-sol": ["gpt-5.6-terra"] } } });
      const codex = (instance.repos.settings.get() as Record<string, any>).codex;
      expect(codex.planModelMap).toEqual({ free: ["gpt-5.6-terra"] });
      expect(codex.modelFallbacks).toEqual({ "gpt-5.6-sol": ["gpt-5.6-terra"] });
    } finally {
      instance.close();
    }
  });
});
