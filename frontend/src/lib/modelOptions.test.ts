import { describe, expect, test } from "vitest";
import { isFreeModelId, modelOptionIds } from "./modelOptions";

describe("model option ids", () => {
  test("supports management catalog routed model fields", () => {
    expect(
      modelOptionIds([
        {
          provider: "codex",
          model: "gpt-5.6-luna",
          fullModel: "cx/gpt-5.6-luna",
          routedModel: "cx/gpt-5.6-luna",
        },
        { id: "openai/gpt-5.4" },
      ]),
    ).toEqual(["cx/gpt-5.6-luna", "openai/gpt-5.4"]);
  });
});

describe("isFreeModelId", () => {
  test("matches the -free and :free suffixes only", () => {
    expect(
      ["tencent/hy3-free", "meta/llama-4:free", "x/Model-FREE"].map(
        isFreeModelId,
      ),
    ).toEqual([true, true, true]);
    expect(
      ["orcarouter/free", "free-model", "gpt-freeform", undefined].map(
        isFreeModelId,
      ),
    ).toEqual([false, false, false, false]);
  });
});
