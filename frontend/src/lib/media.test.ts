import { describe, expect, test } from "vitest";
import { buildMediaProviderSummaries } from "./media";

describe("media provider registry rows", () => {
  test("does not promote a connection-only compatible provider into a v1 media grid", () => {
    const rows = buildMediaProviderSummaries(
      [],
      [
        {
          id: "connection-1",
          provider: "openai-compatible-custom",
          name: "Custom OpenAI",
          isActive: true,
        } as any,
      ],
      [{ id: "openai", name: "OpenAI", noAuth: false }],
      false,
    );

    expect(rows.map((row) => row.providerId)).toEqual(["openai"]);
  });
});
