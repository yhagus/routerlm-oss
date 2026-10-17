import { describe, expect, test } from "vitest";
import { modelOptionIds } from "./modelOptions";

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
