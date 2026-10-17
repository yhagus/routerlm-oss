import { describe, expect, test } from "bun:test";
import { computeTokensPerSecond } from "../src/services/chat/requestDetails";

describe("computeTokensPerSecond", () => {
  test("divides output tokens by the generation window in seconds", () => {
    // 100 tokens over 2s = 50 t/s
    expect(computeTokensPerSecond(100, 2500, 500)).toBe(50);
  });

  test("excludes time-to-first-token from the window", () => {
    // 100 tokens, total 3s but first byte at 1s -> 2s generation -> 50 t/s
    expect(computeTokensPerSecond(100, 3000, 1000)).toBe(50);
  });

  test("returns 0 when there are no output tokens", () => {
    expect(computeTokensPerSecond(0, 2000, 500)).toBe(0);
  });

  test("returns 0 when ttft exceeds total (nonsensical measurement)", () => {
    expect(computeTokensPerSecond(50, 400, 500)).toBe(0);
  });

  test("returns 0 for a zero total", () => {
    expect(computeTokensPerSecond(50, 0, 0)).toBe(0);
  });

  test("handles undefined clamp values", () => {
    // 100 tokens over 1s default (ttft 0) -> 100 t/s
    expect(computeTokensPerSecond(100, 1000)).toBe(100);
  });

  test("falls back to end-to-end throughput when the stream phase is negligible", () => {
    // Reasoning models (e.g. Codex gpt-5.6-sol) deliver output in a final burst,
    // so ttft approximates total and the generation window collapses to timer noise.
    // End-to-end throughput is the only meaningful number for these requests.
    // 50 tokens, total 500ms, ttft 500ms -> 100 t/s end-to-end.
    expect(computeTokensPerSecond(50, 500, 500)).toBe(100);
    // 109 tokens, total 6188ms, ttft 6178ms -> 17.61 t/s end-to-end.
    expect(computeTokensPerSecond(109, 6188, 6178)).toBe(17.61);
    // 8591 tokens with a meaningful stream phase keeps its generation-window value.
    expect(computeTokensPerSecond(8591, 277895, 47007)).toBe(37.21);
  });
});
