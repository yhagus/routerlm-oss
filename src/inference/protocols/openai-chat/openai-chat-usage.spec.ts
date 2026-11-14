import { tokenUsageOf } from "./openai-chat-usage.js";

describe("tokenUsageOf", () => {
  it("leaves the cache read count empty when the upstream doesn't report it", () => {
    const usage = tokenUsageOf({ prompt_tokens: 120, completion_tokens: 30 });

    expect(usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: null,
      cacheWriteTokens: 0,
      reasoningTokens: null,
    });
  });

  it("counts no cache write, even without a prompt count, since Chat Completions never reports one", () => {
    const usage = tokenUsageOf({ completion_tokens: 30 });

    expect(usage.inputTokens).toBeNull();
    expect(usage.cacheWriteTokens).toBe(0);
  });

  it("takes the cache write count a Provider with explicit caching reports out of the input", () => {
    const usage = tokenUsageOf({
      prompt_tokens: 1200,
      completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 0, cache_creation_input_tokens: 1100 },
    });

    expect(usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 1100 });
  });

  it("leaves every count empty when the upstream sent no usage", () => {
    expect(tokenUsageOf(undefined)).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    });
  });
});
