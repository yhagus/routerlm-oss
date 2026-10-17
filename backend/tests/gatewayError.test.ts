import { describe, expect, test } from "bun:test";
import { gatewayErrorBody, gatewayErrorResponse, gatewayStreamErrorFrame, mapGatewayErrorStatus } from "../src/services/chat/gatewayError.ts";

const SOURCES = ["openai", "claude", "responses", "ollama"] as const;

describe("mapGatewayErrorStatus", () => {
  test("passes common codes through verbatim", () => {
    for (const code of [400, 401, 402, 403, 404, 406, 408, 409, 422, 429, 500, 502, 503, 504]) {
      expect(mapGatewayErrorStatus(code)).toBe(code);
    }
  });
  test("normalizes exotic and unmapped codes", () => {
    expect(mapGatewayErrorStatus(529)).toBe(502); // Anthropic overloaded
    expect(mapGatewayErrorStatus(522)).toBe(502); // Cloudflare
    expect(mapGatewayErrorStatus(524)).toBe(502); // Cloudflare
    expect(mapGatewayErrorStatus(418)).toBe(400); // unmapped 4xx
    expect(mapGatewayErrorStatus(599)).toBe(502); // unmapped 5xx
    expect(mapGatewayErrorStatus(undefined)).toBe(502); // network failure
    expect(mapGatewayErrorStatus(499)).toBe(400); // client-closed maps to 4xx shape
  });
});

describe("gatewayErrorBody", () => {
  test("openai/responses/ollama share the OpenAI envelope", () => {
    for (const source of ["openai", "responses", "ollama"] as const) {
      const body = gatewayErrorBody(429, source) as { error: Record<string, string> };
      expect(body.error.message).toBe("Rate limit exceeded");
      expect(body.error.type).toBe("rate_limit_error");
      expect(body.error.code).toBe("rate_limit_exceeded");
    }
  });
  test("claude uses the Anthropic envelope", () => {
    const body = gatewayErrorBody(429, "claude") as { type: string; error: Record<string, string> };
    expect(body.type).toBe("error");
    expect(body.error.message).toBe("Rate limit exceeded");
    expect(body.error.type).toBe("rate_limit_error");
  });
  test("no body leaks upstream text", () => {
    const raw = "openai account quota exceeded, no credentials for provider: acme";
    for (const source of SOURCES) {
      const text = JSON.stringify(gatewayErrorBody(503, source));
      expect(text).not.toContain("acme");
      expect(text).not.toContain("quota exceeded");
      expect(text).not.toContain("no credentials");
      expect(text).not.toContain(raw);
    }
  });
});

describe("gatewayErrorResponse", () => {
  test("client sees mapped status and generic body, raw stays internal", async () => {
    const raw = "provider acme overloaded: capacity gone";
    for (const source of SOURCES) {
      const response = gatewayErrorResponse(529, source, raw);
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).not.toContain("acme");
      expect(text).not.toContain("overloaded");
      expect(text).not.toContain("capacity");
      const attached = (response as unknown as { upstreamError: { status: number; message: string } }).upstreamError;
      expect(attached).toEqual({ status: 529, message: raw });
    }
  });
  test("stream frame shares the surface envelope", () => {
    const frame = gatewayStreamErrorFrame(429, "claude");
    expect(frame.startsWith("data: ")).toBe(true);
    const parsed = JSON.parse(frame.slice(6).trim()) as { type: string };
    expect(parsed.type).toBe("error");
  });
});
