import { describe, expect, test } from "vitest";
import { getThinkingLevels, resolveThinkingSuffix } from "./thinkingLevels";

describe("frontend thinking levels", () => {
  test("matches Codex and model-specific max behavior", () => {
    expect(getThinkingLevels("codex", "gpt-5.6-sol")).toContain("max");
    expect(getThinkingLevels("codex", "gpt-5.3-codex")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("does not append unsupported suffixes", () => {
    expect(resolveThinkingSuffix("openai", "gpt-4o", "high")).toBeNull();
    expect(resolveThinkingSuffix("openai", "gpt-5", "high")).toBe("high");
  });
});
