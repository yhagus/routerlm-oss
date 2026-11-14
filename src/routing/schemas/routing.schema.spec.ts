import { parameterPolicySchema } from "./routing.schema.js";

function issuesOf(policy: unknown): string[] {
  const result = parameterPolicySchema.safeParse(policy);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("parameterPolicySchema", () => {
  it("accepts a policy with defaults, forced values, caps and a system prompt", () => {
    expect(
      issuesOf({
        defaults: { temperature: 0.7, stopSequences: ["END"] },
        forced: { reasoningEffort: "low" },
        caps: { maxOutputTokens: 4096, temperature: 1 },
        systemPrompt: "You are Acme's assistant.",
      }),
    ).toEqual([]);
  });

  it("rejects a default above its cap", () => {
    expect(
      issuesOf({ defaults: { maxOutputTokens: 8192 }, caps: { maxOutputTokens: 4096 } }),
    ).toEqual(["The default maxOutputTokens (8192) is above its cap (4096)"]);
  });

  it("rejects a forced reasoning effort above its cap", () => {
    expect(
      issuesOf({ forced: { reasoningEffort: "high" }, caps: { reasoningEffort: "medium" } }),
    ).toEqual(["The forced reasoningEffort (high) is above its cap (medium)"]);
  });

  it("rejects an unknown parameter", () => {
    expect(issuesOf({ defaults: { frequencyPenalty: 0.5 } })).toEqual([
      'Unrecognized key: "frequencyPenalty"',
    ]);
  });
});
