// Request details: the table keeps at most observabilityMaxRecords rows over
// many flushes, and an update of a stored detail does not count as a new row.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime, type Runtime } from "../src/runtime";
import { flushRequestDetails, saveRequestDetail } from "../src/services/chat/requestDetails";

describe("request detail trim", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    runtime = await createRuntime(loadRuntimeConfig({ BACKEND_HOST: "127.0.0.1", BACKEND_DATABASE_PATH: ":memory:", DATA_DIR: `/tmp/lobakai-request-details-${crypto.randomUUID()}`, REQUIRE_LOGIN: "false" }));
    app = createApp(runtime);
    const response = await app.request("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ observabilityMaxRecords: 5 }) });
    expect(response.status).toBe(200);
  });

  afterEach(() => runtime?.close());

  const detail = (index: number, model = "gpt") => ({ id: `detail-${String(index).padStart(2, "0")}`, timestamp: new Date(Date.UTC(2026, 2, 18, 10, index)).toISOString(), provider: "openai", model, status: "success" });

  async function storedIds(): Promise<{ ids: string[]; total: number }> {
    const body = await (await app.request("/api/usage/request-details?pageSize=100")).json() as { details: Array<{ id: string }>; pagination: { totalItems: number } };
    return { ids: body.details.map((item) => item.id).sort(), total: body.pagination.totalItems };
  }

  test("the table stays at the max-records setting after many flushes", async () => {
    for (let flush = 0; flush < 4; flush += 1) {
      for (let index = flush * 3; index < flush * 3 + 3; index += 1) saveRequestDetail(runtime, detail(index));
      flushRequestDetails(runtime);
      expect((await storedIds()).total).toBeLessThanOrEqual(5);
    }
    expect(await storedIds()).toEqual({ ids: ["detail-07", "detail-08", "detail-09", "detail-10", "detail-11"], total: 5 });
  });

  test("an update of a stored detail keeps the other rows", async () => {
    for (let index = 0; index < 5; index += 1) saveRequestDetail(runtime, detail(index));
    flushRequestDetails(runtime);
    saveRequestDetail(runtime, detail(4, "gpt-updated"));
    flushRequestDetails(runtime);
    expect(await storedIds()).toEqual({ ids: ["detail-00", "detail-01", "detail-02", "detail-03", "detail-04"], total: 5 });
    saveRequestDetail(runtime, detail(5));
    flushRequestDetails(runtime);
    expect(await storedIds()).toEqual({ ids: ["detail-01", "detail-02", "detail-03", "detail-04", "detail-05"], total: 5 });
    const updated = await (await app.request("/api/usage/request-details/detail-04")).json() as { model: string };
    expect(updated.model).toBe("gpt-updated");
  });
});
