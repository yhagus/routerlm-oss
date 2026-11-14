import type { InferenceRequest } from "./internal-format.js";
import { applyParameterPolicy, effectiveParameterPolicy } from "./parameter-policy.js";

const CLIENT_REQUEST: InferenceRequest = {
  model: "smart",
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  stream: null,
};

describe("applyParameterPolicy", () => {
  it("fills a parameter the client omitted with its default", () => {
    const policed = applyParameterPolicy(CLIENT_REQUEST, {
      defaults: { temperature: 0.3, stopSequences: ["END"] },
    });

    expect(policed.temperature).toBe(0.3);
    expect(policed.stopSequences).toEqual(["END"]);
  });

  it("keeps the client's value over a default", () => {
    const policed = applyParameterPolicy(
      { ...CLIENT_REQUEST, topP: 0.5, stopSequences: ["STOP"] },
      { defaults: { topP: 0.9, stopSequences: ["END"] } },
    );

    expect(policed.topP).toBe(0.5);
    expect(policed.stopSequences).toEqual(["STOP"]);
  });

  it("replaces the client's value with a forced one", () => {
    const policed = applyParameterPolicy(
      { ...CLIENT_REQUEST, temperature: 1.2, stopSequences: ["STOP"] },
      { forced: { temperature: 0, stopSequences: ["END"] } },
    );

    expect(policed.temperature).toBe(0);
    expect(policed.stopSequences).toEqual(["END"]);
  });

  it("clamps a client value above its cap and leaves one below it", () => {
    const policed = applyParameterPolicy(
      { ...CLIENT_REQUEST, maxOutputTokens: 64_000, temperature: 0.2 },
      { caps: { maxOutputTokens: 4096, temperature: 1 } },
    );

    expect(policed.maxOutputTokens).toBe(4096);
    expect(policed.temperature).toBe(0.2);
  });

  it("does not invent a value for a capped parameter the client omitted", () => {
    const policed = applyParameterPolicy(CLIENT_REQUEST, { caps: { maxOutputTokens: 4096 } });

    expect(policed.maxOutputTokens).toBeUndefined();
  });

  it("caps a reasoning effort by its order, keeping a lower one", () => {
    const capped = applyParameterPolicy(
      { ...CLIENT_REQUEST, reasoning: { effort: "xhigh" } },
      { caps: { reasoningEffort: "medium" } },
    );
    const lower = applyParameterPolicy(
      { ...CLIENT_REQUEST, reasoning: { effort: "low" } },
      { caps: { reasoningEffort: "medium" } },
    );

    expect(capped.reasoning).toEqual({ effort: "medium" });
    expect(lower.reasoning).toEqual({ effort: "low" });
  });

  it("defaults the reasoning effort only when the client asked for no reasoning at all", () => {
    const omitted = applyParameterPolicy(CLIENT_REQUEST, { defaults: { reasoningEffort: "low" } });
    const withBudget = applyParameterPolicy(
      { ...CLIENT_REQUEST, reasoning: { budgetTokens: 2048 } },
      { defaults: { reasoningEffort: "low" } },
    );

    expect(omitted.reasoning).toEqual({ effort: "low" });
    expect(withBudget.reasoning).toEqual({ budgetTokens: 2048 });
  });

  it("replaces the client's whole reasoning setting with a forced effort, dropping a thinking budget", () => {
    const policed = applyParameterPolicy(
      { ...CLIENT_REQUEST, reasoning: { effort: "high", budgetTokens: 8000 } },
      { forced: { reasoningEffort: "medium" } },
    );

    expect(policed.reasoning).toEqual({ effort: "medium" });
  });

  it("places the system prompt verbatim before the client's system content", () => {
    const policed = applyParameterPolicy(
      { ...CLIENT_REQUEST, system: [{ type: "text", text: "Answer in French." }] },
      { systemPrompt: "You are Acme's assistant. {{user}} is not a variable." },
    );

    expect(policed.system).toEqual([
      { type: "text", text: "You are Acme's assistant. {{user}} is not a variable." },
      { type: "text", text: "Answer in French." },
    ]);
  });

  it("adds no system part for an empty system prompt", () => {
    const policed = applyParameterPolicy(CLIENT_REQUEST, { systemPrompt: "" });

    expect(policed.system).toEqual([]);
  });

  it("does not change the request it was given", () => {
    const request: InferenceRequest = { ...CLIENT_REQUEST, system: [], temperature: 1.5 };

    applyParameterPolicy(request, { forced: { temperature: 0 }, systemPrompt: "Be brief." });

    expect(request.temperature).toBe(1.5);
    expect(request.system).toEqual([]);
  });
});

describe("effectiveParameterPolicy", () => {
  it("is the Model's policy when the Route has no override", () => {
    const modelPolicy = { forced: { temperature: 0.2 }, systemPrompt: "Model prompt" };

    expect(effectiveParameterPolicy(modelPolicy, null)).toEqual(modelPolicy);
  });

  it("takes every rule for a parameter from the Route override when the override sets that parameter", () => {
    const effective = effectiveParameterPolicy(
      { forced: { temperature: 0.2 }, caps: { maxOutputTokens: 4096 } },
      { defaults: { temperature: 0.7 } },
    );

    expect(effective).toEqual({ defaults: { temperature: 0.7 }, caps: { maxOutputTokens: 4096 } });
  });

  it("uses the Route override's system prompt, even an empty one, over the Model's", () => {
    const replaced = effectiveParameterPolicy(
      { systemPrompt: "Model prompt" },
      { systemPrompt: "Route prompt" },
    );
    const cleared = effectiveParameterPolicy(
      { systemPrompt: "Model prompt" },
      { systemPrompt: "" },
    );
    const kept = effectiveParameterPolicy({ systemPrompt: "Model prompt" }, {});

    expect(replaced.systemPrompt).toBe("Route prompt");
    expect(cleared.systemPrompt).toBe("");
    expect(kept.systemPrompt).toBe("Model prompt");
  });
});
