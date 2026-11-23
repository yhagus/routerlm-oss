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
  const ANOTHER_DAY = today === 1 ? 2 : 1;
  const EARLY_ON_ANOTHER_DAY = [{ weekdays: [ANOTHER_DAY], start: "00:00", end: "06:00" }];
  const LATE_ON_ANOTHER_DAY = [{ weekdays: [ANOTHER_DAY], start: "18:00", end: "24:00" }];

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

  async function createWindow(
    name: string,
    ranges: object[] = EARLY_ON_ANOTHER_DAY,
    fields: { timeZone?: string; isEnabled?: boolean } = {},
  ): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/pricing-windows")
      .set("Cookie", cookie)
      .send({ name, timeZone, ranges, ...fields })
      .expect(201);
    return created.body.id;
  }

  function patchWindow(pricingWindowId: string, changes: object): request.Test {
    return request(app.getHttpServer())
      .patch(`/api/pricing-windows/${pricingWindowId}`)
      .set("Cookie", cookie)
      .send(changes);
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

  it("attaches Pricing Windows with their Window Prices, and lists them by window name", async () => {
    const nightId = await createWindow("Night");
    const weekendId = await createWindow("Weekend", LATE_ON_ANOTHER_DAY);

    await putWindowPrices(chatModelId, [
      { pricingWindowId: weekendId, outputPrice: 2 },
      { pricingWindowId: nightId, inputPrice: 0.5, cacheReadPrice: 0.05 },
    ]).expect(200);

    expect(await windowPricesOf(chatModelId)).toEqual([
      expect.objectContaining({
        pricingWindowId: nightId,
        name: "Night",
        inputPrice: 0.5,
        outputPrice: null,
        cacheReadPrice: 0.05,
        cacheWritePrice: null,
      }),
      expect.objectContaining({
        pricingWindowId: weekendId,
        name: "Weekend",
        timeZone,
        ranges: LATE_ON_ANOTHER_DAY,
        inputPrice: null,
        outputPrice: 2,
        cacheReadPrice: null,
        cacheWritePrice: null,
      }),
    ]);
  });

  it("replaces the whole list: changes prices and detaches", async () => {
    const nightId = await createWindow("Night");
    const weekendId = await createWindow("Weekend", LATE_ON_ANOTHER_DAY);
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

  it("gives each Upstream Model in the list its Pricing Windows, and which is active now", async () => {
    const offPeakId = await createWindow("Off-Peak", ACTIVE_NOW);
    const weekendId = await createWindow("Weekend", LATE_ON_ANOTHER_DAY);
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
            pricingWindowId: offPeakId,
            name: "Off-Peak",
            isEnabled: true,
            isActiveNow: true,
            inputPrice: 0.5,
          }),
          expect.objectContaining({
            pricingWindowId: weekendId,
            name: "Weekend",
            isEnabled: true,
            isActiveNow: false,
            inputPrice: 0.7,
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

  describe("never overlapping", () => {
    const WEEKDAY_OFF_PEAK = [{ weekdays: [1, 2, 3, 4, 5], start: "16:00", end: "08:00" }];
    const WEEKENDS = [{ weekdays: [6, 7], start: "08:00", end: "24:00" }];

    it("accepts weekday off-peak hours and weekends, which never share a moment", async () => {
      const offPeakId = await createWindow("Off-Peak", WEEKDAY_OFF_PEAK, { timeZone: "UTC" });
      const weekendId = await createWindow("Weekend", WEEKENDS, { timeZone: "UTC" });

      await putWindowPrices(chatModelId, [
        { pricingWindowId: offPeakId, inputPrice: 0.5 },
        { pricingWindowId: weekendId, inputPrice: 0.7 },
      ]).expect(200);
    });

    it("refuses two windows whose hours overlap, naming both", async () => {
      const offPeakId = await createWindow("Off-Peak", WEEKDAY_OFF_PEAK, { timeZone: "UTC" });
      const allSaturdayId = await createWindow(
        "All Saturday",
        [{ weekdays: [6], start: "00:00", end: "24:00" }],
        { timeZone: "UTC" },
      );

      // Friday's off-peak range crosses midnight into Saturday (ADR 0038).
      const refused = await putWindowPrices(chatModelId, [
        { pricingWindowId: offPeakId, inputPrice: 0.5 },
        { pricingWindowId: allSaturdayId, inputPrice: 0.7 },
      ]).expect(400);

      expect(refused.body.message).toBe(
        'The Window Prices for "Off-Peak" and "All Saturday" can apply at the same moment; only one may apply at a time',
      );
    });

    it("refuses the same Pricing Window twice", async () => {
      const nightId = await createWindow("Night");

      const refused = await putWindowPrices(chatModelId, [
        { pricingWindowId: nightId, inputPrice: 0.5 },
        { pricingWindowId: nightId, outputPrice: 2 },
      ]).expect(400);

      expect(refused.body.message).toBe(
        'The Window Prices for "Night" and "Night" can apply at the same moment; only one may apply at a time',
      );
    });

    it("refuses windows in two time zones that only overlap while one of them is on summer time", async () => {
      // 09:00 in London is 09:00 UTC in winter and 08:00 UTC in summer.
      const londonMorningId = await createWindow(
        "London Morning",
        [{ weekdays: [1], start: "09:00", end: "10:00" }],
        { timeZone: "Europe/London" },
      );
      const utcEarlyId = await createWindow(
        "UTC Early",
        [{ weekdays: [1], start: "08:00", end: "09:00" }],
        { timeZone: "UTC" },
      );

      await putWindowPrices(chatModelId, [
        { pricingWindowId: londonMorningId, inputPrice: 0.5 },
        { pricingWindowId: utcEarlyId, inputPrice: 0.7 },
      ]).expect(400);
    });

    it("counts a disabled window", async () => {
      const nightId = await createWindow("Night");
      const disabledId = await createWindow("Disabled Night", EARLY_ON_ANOTHER_DAY, {
        isEnabled: false,
      });

      await putWindowPrices(chatModelId, [
        { pricingWindowId: nightId, inputPrice: 0.5 },
        { pricingWindowId: disabledId, inputPrice: 0.7 },
      ]).expect(400);
    });

    it("refuses a window's new ranges that would overlap another window on an Upstream Model, naming it", async () => {
      const offPeakId = await createWindow("Off-Peak", WEEKDAY_OFF_PEAK, { timeZone: "UTC" });
      const weekendId = await createWindow("Weekend", WEEKENDS, { timeZone: "UTC" });
      await putWindowPrices(chatModelId, [
        { pricingWindowId: offPeakId, inputPrice: 0.5 },
        { pricingWindowId: weekendId, inputPrice: 0.7 },
      ]).expect(200);

      const refused = await patchWindow(weekendId, {
        ranges: [{ weekdays: [5, 6, 7], start: "00:00", end: "24:00" }],
      }).expect(400);

      expect(refused.body.message).toBe(
        "Window Prices would overlap on the Upstream Models acme-large (Acme AI), so this Pricing Window's schedule can't change; change their Window Prices first",
      );
    });

    it("refuses a window's new time zone that would overlap another window on an Upstream Model", async () => {
      const lateFridayId = await createWindow(
        "Late Friday",
        [{ weekdays: [5], start: "22:00", end: "24:00" }],
        { timeZone: "UTC" },
      );
      const weekendId = await createWindow(
        "Whole Weekend",
        [{ weekdays: [6, 7], start: "00:00", end: "24:00" }],
        { timeZone: "UTC" },
      );
      await putWindowPrices(chatModelId, [
        { pricingWindowId: lateFridayId, inputPrice: 0.5 },
        { pricingWindowId: weekendId, inputPrice: 0.7 },
      ]).expect(200);

      // Friday 22:00 in New York is Saturday 03:00 UTC.
      await patchWindow(lateFridayId, { timeZone: "America/New_York" }).expect(400);
    });
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
    const weekendId = await createWindow("Weekend", LATE_ON_ANOTHER_DAY);
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
    const weekendId = await createWindow("Weekend", LATE_ON_ANOTHER_DAY);
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
