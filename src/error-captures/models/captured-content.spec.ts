import { capturedBody, capturedHeaders } from "./captured-content.js";

const PROVIDER_ACCOUNT_KEY = "sk-provider-account-secret";

describe("capturedHeaders", () => {
  it("redacts credentials and cookies but keeps the other headers", () => {
    const headers = capturedHeaders(
      {
        authorization: "Bearer rlm_client_key",
        "x-api-key": "rlm_client_key",
        cookie: "__Host-sid=abc",
        "set-cookie": ["a=1", "b=2"],
        "content-type": "application/json",
      },
      [],
    );

    expect(headers).toEqual({
      authorization: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      cookie: "[REDACTED]",
      "set-cookie": "[REDACTED]",
      "content-type": "application/json",
    });
  });

  it("redacts the Provider Account key wherever it appears in a header value", () => {
    const headers = capturedHeaders(
      { "x-debug": `rejected key ${PROVIDER_ACCOUNT_KEY}`, "x-count": undefined },
      [PROVIDER_ACCOUNT_KEY],
    );

    expect(headers).toEqual({ "x-debug": "rejected key [REDACTED]" });
  });
});

describe("capturedBody", () => {
  it("redacts the Provider Account key from the body", () => {
    const body = capturedBody(`{"error":"invalid key ${PROVIDER_ACCOUNT_KEY}"}`, [
      PROVIDER_ACCOUNT_KEY,
    ]);

    expect(body).toBe('{"error":"invalid key [REDACTED]"}');
  });

  it("keeps a body of exactly 256 KB whole", () => {
    const body = "a".repeat(256 * 1024);

    expect(capturedBody(body, [])).toBe(body);
  });

  it("truncates a body over 256 KB and says so", () => {
    const body = capturedBody("a".repeat(256 * 1024 + 10), []);

    expect(body.startsWith("a".repeat(256 * 1024))).toBe(true);
    expect(body.slice(256 * 1024)).toBe("\n[truncated: 262154 bytes in total, 256 KB kept]");
  });

  it("never cuts a multi-byte character in half when truncating", () => {
    const body = capturedBody(`${"a".repeat(256 * 1024 - 1)}é and more`, []);

    expect(body.startsWith(`${"a".repeat(256 * 1024 - 1)}\n[truncated:`)).toBe(true);
  });
});
