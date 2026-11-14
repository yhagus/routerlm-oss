import { promptCacheKey } from "./prompt-cache-key.js";

const API_KEY_ID = "0b6f4c1e-8d1a-4f43-9a52-3c2e7f1d9a10";
const MODEL_ID = "5d0e2a77-1c3b-4b8e-b1f2-6a9d4e8c7b21";
const OTHER_MODEL_ID = "9a1c3e5f-7b2d-4f6a-8c0e-1d3f5a7b9c2e";

describe("promptCacheKey", () => {
  it("gives every request of one API Key and Model the same key", () => {
    const first = promptCacheKey({ kind: "api-key", apiKeyId: API_KEY_ID }, MODEL_ID);
    const second = promptCacheKey({ kind: "api-key", apiKeyId: API_KEY_ID }, MODEL_ID);

    expect(second).toBe(first);
  });

  it("gives another Model, or a User with the same id, a different key", () => {
    const apiKeyKey = promptCacheKey({ kind: "api-key", apiKeyId: API_KEY_ID }, MODEL_ID);

    expect(promptCacheKey({ kind: "api-key", apiKeyId: API_KEY_ID }, OTHER_MODEL_ID)).not.toBe(
      apiKeyKey,
    );
    expect(promptCacheKey({ kind: "user", userId: API_KEY_ID }, MODEL_ID)).not.toBe(apiKeyKey);
  });

  it("doesn't reveal the ids it is derived from", () => {
    const key = promptCacheKey({ kind: "api-key", apiKeyId: API_KEY_ID }, MODEL_ID);

    expect(key).not.toContain(API_KEY_ID);
    expect(key).not.toContain(MODEL_ID);
  });
});
