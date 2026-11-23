import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { deleteAllPricingWindows, zoneAtNoonNow } from "@tests/support/pricing-windows.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const CHAT_MODEL = {
  upstreamModelId: "acme-large",
  capabilities: [],
  contextSize: 100_000,
  maxOutputTokens: null,
  inputPrice: 1,
  outputPrice: 4,
  cacheReadPrice: 0.1,
  cacheWritePrice: null,
};

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("Window Prices on Upstream Models (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;
  let providerId: string;
  let chatModelId: string;

  // In this zone the wall clock reads 12:xx right now.
  const { timeZone, today } = zoneAtNoonNow();
  const ACTIVE_NOW = [{ weekdays: [today], start: "11:00", end: "14:00" }];
  const NEVER_TODAY = [{ weekdays: [today === 1 ? 2 : 1], start: "00:00", end: "24:00" }];

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    await deleteAllPricingWindows(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const provider = await request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({
        slug: "acme",
        name: "Acme AI",
        endpoints: [
          { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.acme.example/v1" },
          { kind: "image", protocol: "dashscope-image", baseUrl: "https://api.acme.example" },
        ],
        authStyle: "bearer",
      })
      .expect(201);
    providerId = provider.body.id;
    chatModelId = await createUpstreamModel(CHAT_MODEL);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUpstreamModel(body: object): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({ providerId, ...body })
      .expect(201);
    return created.body.id;
  }

  async function createWindow(name: string, ranges: object[] = NEVER_TODAY): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/pricing-windows")
      .set("Cookie", cookie)
      .send({ name, timeZone, ranges })
      .expect(201);
    return created.body.id;
  }

  function putWindowPrices(upstreamModelId: string, entries: object[]): request.Test {
    return request(app.getHttpServer())
      .put(`/api/upstream-models/${upstreamModelId}/pricing-windows`)
      .set("Cookie", cookie)
      .send(entries);
  }

  async function windowPricesOf(upstreamModelId: string): Promise<unknown> {
    const response = await request(app.getHttpServer())
      .get(`/api/upstream-models/${upstreamModelId}/pricing-windows`)
      .set("Cookie", cookie)
      .expect(200);
    return response.body;
  }

  async function listPricingWindows(): Promise<unknown> {
    const response = await request(app.getHttpServer())
      .get("/api/pricing-windows")
      .set("Cookie", cookie)
      .expect(200);
    return response.body;
  }

  it("attaches Pricing Windows in order with their Window Prices, and lists them", async () => {
    const nightId = await createWindow("Night");
    const weekendId = await createWindow("Weekend");

    await putWindowPrices(chatModelId, [
      { pricingWindowId: weekendId, outputPrice: 2 },
      { pricingWindowId: nightId, inputPrice: 0.5, cacheReadPrice: 0.05 },
    ]).expect(200);

    expect(await windowPricesOf(chatModelId)).toEqual([
      expect.objectContaining({
        pricingWindowId: weekendId,
        name: "Weekend",
        timeZone,
        ranges: NEVER_TODAY,
        inputPrice: null,
        outputPrice: 2,
        cacheReadPrice: null,
        cacheWritePrice: null,
      }),
      expect.objectContaining({
        pricingWindowId: nightId,
        name: "Night",
        inputPrice: 0.5,
        outputPrice: null,
        cacheReadPrice: 0.05,
        cacheWritePrice: null,
      }),
    ]);
  });

  it("replaces the whole list: reorders, changes prices and detaches", async () => {
    const nightId = await createWindow("Night");
    const weekendId = await createWindow("Weekend");
    await putWindowPrices(chatModelId, [
      { pricingWindowId: nightId, inputPrice: 0.5 },
      { pricingWindowId: weekendId, inputPrice: 0.7 },
    ]).expect(200);

    const replaced = await putWindowPrices(chatModelId, [
      { pricingWindowId: weekendId, inputPrice: 0.6 },
    ]).expect(200);

    expect(replaced.body).toEqual([
      expect.objectContaining({ pricingWindowId: weekendId, inputPrice: 0.6 }),
    ]);
    expect(await windowPricesOf(chatModelId)).toEqual(replaced.body);
  });

  it("counts the Upstream Models a Pricing Window is attached to", async () => {
    const nightId = await createWindow("Night");
    const otherModelId = await createUpstreamModel({
      ...CHAT_MODEL,
      upstreamModelId: "acme-small",
    });
    await putWindowPrices(chatModelId, [{ pricingWindowId: nightId, inputPrice: 0.5 }]).expect(200);
    await putWindowPrices(otherModelId, [{ pricingWindowId: nightId, inputPrice: 0.2 }]).expect(
      200,
    );

    expect(await listPricingWindows()).toEqual([
      expect.objectContaining({ id: nightId, attachedUpstreamModelCount: 2 }),
    ]);
  });

  it("gives each Upstream Model in the list its ordered Pricing Windows, and which is active now", async () => {
    const offPeakId = await createWindow("Off-Peak", ACTIVE_NOW);
    const weekendId = await createWindow("Weekend");
    await putWindowPrices(chatModelId, [
      { pricingWindowId: weekendId, inputPrice: 0.7 },
      { pricingWindowId: offPeakId, inputPrice: 0.5 },
    ]).expect(200);

    const list = await request(app.getHttpServer())
      .get("/api/upstream-models")
      .set("Cookie", cookie)
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({
        id: chatModelId,
        pricingWindows: [
          expect.objectContaining({
            pricingWindowId: weekendId,
            name: "Weekend",
            isEnabled: true,
            isActiveNow: false,
            inputPrice: 0.7,
          }),
          expect.objectContaining({
            pricingWindowId: offPeakId,
            name: "Off-Peak",
            isEnabled: true,
            isActiveNow: true,
            inputPrice: 0.5,
          }),
        ],
      }),
    ]);
  });

  it("refuses Pricing Windows on an Upstream Model that isn't of the chat Kind", async () => {
    const nightId = await createWindow("Night");
    const imageModelId = await createUpstreamModel({
      ...CHAT_MODEL,
      upstreamModelId: "acme-paint",
      kind: "image",
      contextSize: null,
    });

    const refused = await putWindowPrices(imageModelId, [
      { pricingWindowId: nightId, inputPrice: 0.5 },
    ]).expect(400);

    expect(refused.body.message).toBe(
      "Only a chat Upstream Model has Pricing Windows; this one is of the Kind image",
    );
  });

  it("refuses a Pricing Window that doesn't exist", async () => {
    const refused = await putWindowPrices(chatModelId, [
      { pricingWindowId: MISSING_ID, inputPrice: 0.5 },
    ]).expect(404);

    expect(refused.body.message).toBe("Pricing Window not found");
  });

  it("refuses the same Pricing Window twice", async () => {
    const nightId = await createWindow("Night");

    const refused = await putWindowPrices(chatModelId, [
      { pricingWindowId: nightId, inputPrice: 0.5 },
      { pricingWindowId: nightId, outputPrice: 2 },
    ]).expect(400);

    expect(refused.body.message).toEqual(["Attach each Pricing Window once"]);
  });

  it("refuses a Pricing Window with no price of its own", async () => {
    const nightId = await createWindow("Night");

    const refused = await putWindowPrices(chatModelId, [
      { pricingWindowId: nightId, inputPrice: null },
    ]).expect(400);

    expect(refused.body.message).toEqual(["0: Give the Pricing Window at least one price"]);
  });

  it("answers 404 for an Upstream Model that doesn't exist", async () => {
    await request(app.getHttpServer())
      .get(`/api/upstream-models/${MISSING_ID}/pricing-windows`)
      .set("Cookie", cookie)
      .expect(404);
    await putWindowPrices(MISSING_ID, []).expect(404);
  });

  it("refuses to change the Kind of an Upstream Model with Pricing Windows, naming them", async () => {
    const nightId = await createWindow("Night");
    const weekendId = await createWindow("Weekend");
    await putWindowPrices(chatModelId, [
      { pricingWindowId: nightId, inputPrice: 0.5 },
      { pricingWindowId: weekendId, inputPrice: 0.7 },
    ]).expect(200);

    const refused = await request(app.getHttpServer())
      .patch(`/api/upstream-models/${chatModelId}`)
      .set("Cookie", cookie)
      .send({ kind: "image", contextSize: null })
      .expect(400);

    expect(refused.body.message).toBe(
      "The Pricing Windows Night, Weekend give this Upstream Model Window Prices, so its Kind can't change; detach them first",
    );
  });

  it("removes a deleted Pricing Window's Window Prices from every Upstream Model", async () => {
    const nightId = await createWindow("Night");
    const weekendId = await createWindow("Weekend");
    await putWindowPrices(chatModelId, [
      { pricingWindowId: nightId, inputPrice: 0.5 },
      { pricingWindowId: weekendId, inputPrice: 0.7 },
    ]).expect(200);

    await request(app.getHttpServer())
      .delete(`/api/pricing-windows/${nightId}`)
      .set("Cookie", cookie)
      .expect(204);

    expect(await windowPricesOf(chatModelId)).toEqual([
      expect.objectContaining({ pricingWindowId: weekendId }),
    ]);
  });

  it("removes a deleted Upstream Model's Window Prices", async () => {
    const nightId = await createWindow("Night");
    await putWindowPrices(chatModelId, [{ pricingWindowId: nightId, inputPrice: 0.5 }]).expect(200);

    await request(app.getHttpServer())
      .delete(`/api/upstream-models/${chatModelId}`)
      .set("Cookie", cookie)
      .expect(204);

    expect(await listPricingWindows()).toEqual([
      expect.objectContaining({ id: nightId, attachedUpstreamModelCount: 0 }),
    ]);
  });
});
