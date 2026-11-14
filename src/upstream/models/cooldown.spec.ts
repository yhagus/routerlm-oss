import { cooldownDurationMs } from "./cooldown.js";

const NOW = new Date("2026-11-15T12:00:00Z");

describe("cooldownDurationMs", () => {
  it("starts at 5 seconds and doubles with each failure in a row", () => {
    expect(cooldownDurationMs(1, null, NOW)).toBe(5_000);
    expect(cooldownDurationMs(2, null, NOW)).toBe(10_000);
    expect(cooldownDurationMs(4, null, NOW)).toBe(40_000);
  });

  it("stops growing at 5 minutes", () => {
    expect(cooldownDurationMs(30, null, NOW)).toBe(300_000);
  });

  it("waits as long as Retry-After asks, in seconds or as a date", () => {
    expect(cooldownDurationMs(1, "120", NOW)).toBe(120_000);
    expect(cooldownDurationMs(1, "Sun, 15 Nov 2026 12:00:30 GMT", NOW)).toBe(30_000);
  });

  it("never waits less than the grown Cooldown when Retry-After is shorter", () => {
    expect(cooldownDurationMs(3, "1", NOW)).toBe(20_000);
  });

  it("caps Retry-After at one hour and ignores a value it cannot read", () => {
    expect(cooldownDurationMs(1, "86400", NOW)).toBe(3_600_000);
    expect(cooldownDurationMs(1, "soon", NOW)).toBe(5_000);
  });
});
