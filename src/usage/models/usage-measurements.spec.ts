import type { TokenUsage } from "@/inference/models/internal-format.js";
import type { ServedBy, UpstreamModelPrices } from "./usage-job.js";
import { usageMeasurementsOf } from "./usage-measurements.js";

const PRICES: UpstreamModelPrices = {
  inputPrice: 2,
  outputPrice: 8,
  cacheReadPrice: 0.5,
  cacheWritePrice: 2.5,
};

const FULL_USAGE: TokenUsage = {
  inputTokens: 1_000,
  outputTokens: 500,
  cacheReadTokens: 10_000,
  cacheWriteTokens: 2_000,
  reasoningTokens: 100,
};

function servedAt(prices: UpstreamModelPrices): ServedBy {
  return { routeId: "route", providerAccountId: "account", prices };
}

describe("usageMeasurementsOf", () => {
  it("prices input, output, cache reads and cache writes at the Upstream Model's prices", () => {
    const measurements = usageMeasurementsOf(servedAt(PRICES), FULL_USAGE);

    // 1000 x 2 + 500 x 8 + 10000 x 0.5 + 2000 x 2.5 = 16000 per million tokens.
    expect(measurements.cost).toBeCloseTo(0.016, 10);
    expect(measurements.isIncomplete).toBe(false);
    expect(measurements.reasoningTokens).toBe(100);
  });

  it("keeps an unreported count empty and flags the record incomplete", () => {
    const measurements = usageMeasurementsOf(servedAt(PRICES), {
      ...FULL_USAGE,
      cacheReadTokens: null,
    });

    expect(measurements.cacheReadTokens).toBeNull();
    expect(measurements.isIncomplete).toBe(true);
    // Only what was reported is priced: 1000 x 2 + 500 x 8 + 2000 x 2.5.
    expect(measurements.cost).toBeCloseTo(0.011, 10);
  });

  it("flags the record incomplete when the upstream reported no usage at all", () => {
    const measurements = usageMeasurementsOf(servedAt(PRICES), null);

    expect(measurements).toMatchObject({ inputTokens: null, outputTokens: null, cost: null });
    expect(measurements.isIncomplete).toBe(true);
  });

  it("does not flag a missing reasoning count, which only splits the output count", () => {
    const measurements = usageMeasurementsOf(servedAt(PRICES), {
      ...FULL_USAGE,
      reasoningTokens: null,
    });

    expect(measurements.isIncomplete).toBe(false);
  });

  it("leaves the Cost unknown when tokens were used at a price nobody entered", () => {
    const measurements = usageMeasurementsOf(
      servedAt({ ...PRICES, cacheWritePrice: null }),
      FULL_USAGE,
    );

    expect(measurements.cost).toBeNull();
  });

  it("needs no price for a count of zero", () => {
    const measurements = usageMeasurementsOf(servedAt({ ...PRICES, cacheWritePrice: null }), {
      ...FULL_USAGE,
      cacheWriteTokens: 0,
    });

    expect(measurements.cost).toBeCloseTo(0.011, 10);
  });

  it("records no tokens, no Cost and nothing incomplete when no Attempt answered", () => {
    const measurements = usageMeasurementsOf(null, null);

    expect(measurements).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      cost: null,
      isIncomplete: false,
    });
  });
});
