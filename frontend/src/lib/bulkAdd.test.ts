import { describe, expect, test } from "vitest";
import { planBulkAdd } from "./bulkAdd";

describe("planBulkAdd", () => {
  test("parses the optional River session pair", () => {
    const plan = planBulkAdd(["River|sk-key|refresh-1:client-1"], []);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      name: "River 1",
      apiKey: "sk-key",
      refreshToken: "refresh-1",
      clientId: "client-1",
    });
  });

  test("keeps a key without a session pair", () => {
    const plan = planBulkAdd(["River|sk-key"], []);
    expect(plan[0].refreshToken).toBeUndefined();
    expect(plan[0].clientId).toBeUndefined();
  });

  test("drops a partial session pair", () => {
    const missingClient = planBulkAdd(["A|sk-a|refresh-only"], []);
    const missingRefresh = planBulkAdd(["B|sk-b|:client-only"], []);
    expect(missingClient[0].refreshToken).toBeUndefined();
    expect(missingRefresh[0].clientId).toBeUndefined();
  });

  test("avoids existing names", () => {
    const plan = planBulkAdd(["Key|sk-key"], ["Key 1"]);
    expect(plan[0].name).toBe("Key 2");
  });
});
