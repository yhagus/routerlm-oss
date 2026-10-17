import { describe, expect, test } from "bun:test";
import { checkRateLimit, resetRateLimit } from "../src/services/platform/rateLimit";

describe("rate limiter", () => {
  test("allows requests up to the per-second limit", () => {
    resetRateLimit("k1");
    expect(checkRateLimit("k1", null, 2).allowed).toBe(true);
    expect(checkRateLimit("k1", null, 2).allowed).toBe(true);
    const blocked = checkRateLimit("k1", null, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain("requests/second");
  });

  test("enforces per-minute limit", () => {
    resetRateLimit("k2");
    expect(checkRateLimit("k2", 1, null).allowed).toBe(true);
    const blocked = checkRateLimit("k2", 1, null);
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain("requests/minute");
  });

  test("no limit allows everything", () => {
    resetRateLimit("k3");
    expect(checkRateLimit("k3", null, null).allowed).toBe(true);
    expect(checkRateLimit("k3", 0, 0).allowed).toBe(true);
  });

  test("reset clears the window", () => {
    resetRateLimit("k4");
    expect(checkRateLimit("k4", null, 1).allowed).toBe(true);
    resetRateLimit("k4");
    expect(checkRateLimit("k4", null, 1).allowed).toBe(true);
  });
});