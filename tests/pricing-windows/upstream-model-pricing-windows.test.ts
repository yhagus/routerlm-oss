import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  deleteAllPricingWindows,
  utcWallClockInDays,
  zoneAtNoonNow,
} from "@tests/support/pricing-windows.js";
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

  describe("Validity Periods", () => {
    const WHOLE_WEEK = [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "24:00" }];

    function createWholeWeekWindow(name = "Whole Week"): Promise<string> {
      return createWindow(name, WHOLE_WEEK, { timeZone: "UTC" });
    }

    it("attaches one window for several periods, and lists them by start with their status", async () => {
      const wholeWeekId = await createWholeWeekWindow();
      const lastWeek = utcWallClockInDays(-7);
      const yesterday = utcWallClockInDays(-1);
      const tomorrow = utcWallClockInDays(1);
      const nextWeek = utcWallClockInDays(7);

      await putWindowPrices(chatModelId, [
        { pricingWindowId: wholeWeekId, inputPrice: 0.3, validFrom: nextWeek },
        {
          pricingWindowId: wholeWeekId,
          inputPrice: 0.5,
          validFrom: yesterday,
          validUntil: tomorrow,
        },
        { pricingWindowId: wholeWeekId, inputPrice: 0.7, validUntil: lastWeek },
      ]).expect(200);

      expect(await windowPricesOf(chatModelId)).toEqual([
        expect.objectContaining({
          inputPrice: 0.7,
          validFrom: null,
          validUntil: lastWeek,
          status: "expired",
        }),
        expect.objectContaining({
          inputPrice: 0.5,
          validFrom: yesterday,
          validUntil: tomorrow,
          status: "active",
        }),
        expect.objectContaining({
          inputPrice: 0.3,
          validFrom: nextWeek,
          validUntil: null,
          status: "scheduled",
        }),
      ]);
    });

    it("lists Window Prices inside their period as inactive while their window isn't active", async () => {
      const lateId = await createWindow("Late", LATE_ON_ANOTHER_DAY);

      await putWindowPrices(chatModelId, [
        { pricingWindowId: lateId, inputPrice: 0.5, validUntil: utcWallClockInDays(7) },
      ]).expect(200);

      expect(await windowPricesOf(chatModelId)).toEqual([
        expect.objectContaining({ status: "inactive", isActiveNow: false }),
      ]);
    });

    it("refuses a period whose start isn't before its end", async () => {
      const wholeWeekId = await createWholeWeekWindow();

      const refused = await putWindowPrices(chatModelId, [
        {
          pricingWindowId: wholeWeekId,
          inputPrice: 0.5,
          validFrom: "2027-01-01T00:00",
          validUntil: "2027-01-01T00:00",
        },
      ]).expect(400);

      expect(refused.body.message).toEqual(["0: A Validity Period's start must be before its end"]);
    });

    it("refuses one window twice for periods that overlap, naming both periods", async () => {
      const wholeWeekId = await createWholeWeekWindow();

      const refused = await putWindowPrices(chatModelId, [
        {
          pricingWindowId: wholeWeekId,
          inputPrice: 0.5,
          validFrom: "2026-12-01T00:00",
          validUntil: "2027-01-01T00:00",
        },
        { pricingWindowId: wholeWeekId, inputPrice: 0.7, validFrom: "2026-12-31T23:59" },
      ]).expect(400);

      expect(refused.body.message).toBe(
        'The Window Prices for "Whole Week" (from 2026-12-01 00:00 until 2027-01-01 00:00) and "Whole Week" (from 2026-12-31 23:59) can apply at the same moment; only one may apply at a time',
      );
    });

    it("refuses open-ended Window Prices whose hours overlap a dated sale", async () => {
      const offPeakId = await createWindow(
        "Off-Peak",
        [{ weekdays: [1, 2, 3, 4, 5], start: "16:00", end: "08:00" }],
        { timeZone: "UTC" },
      );
      const wholeWeekId = await createWholeWeekWindow();

      const refused = await putWindowPrices(chatModelId, [
        { pricingWindowId: offPeakId, inputPrice: 0.5 },
        { pricingWindowId: wholeWeekId, inputPrice: 0.3, validUntil: "2027-01-01T00:00" },
      ]).expect(400);

      expect(refused.body.message).toBe(
        'The Window Prices for "Off-Peak" and "Whole Week" (until 2027-01-01 00:00) can apply at the same moment; only one may apply at a time',
      );
    });

    it("accepts overlapping hours whose periods meet only at the exclusive end", async () => {
      const offPeakId = await createWindow(
        "Off-Peak",
        [{ weekdays: [1, 2, 3, 4, 5], start: "16:00", end: "08:00" }],
        { timeZone: "UTC" },
      );
      const wholeWeekId = await createWholeWeekWindow();

      await putWindowPrices(chatModelId, [
        { pricingWindowId: offPeakId, inputPrice: 0.5, validFrom: "2027-01-01T00:00" },
        { pricingWindowId: wholeWeekId, inputPrice: 0.3, validUntil: "2027-01-01T00:00" },
      ]).expect(200);
    });

    it("accepts a short sale beside off-peak hours it doesn't reach", async () => {
      const offPeakId = await createWindow(
        "Off-Peak",
        [{ weekdays: [1, 2, 3, 4, 5], start: "16:00", end: "08:00" }],
        { timeZone: "UTC" },
      );
      const wholeWeekId = await createWholeWeekWindow();

      // Wednesday 2 December 2026, 09:00 to 15:00 UTC: between two off-peak stretches.
      await putWindowPrices(chatModelId, [
        { pricingWindowId: offPeakId, inputPrice: 0.5 },
        {
          pricingWindowId: wholeWeekId,
          inputPrice: 0.3,
          validFrom: "2026-12-02T09:00",
          validUntil: "2026-12-02T15:00",
        },
      ]).expect(200);
    });

    it("refuses a window's new time zone that moves its period into another's", async () => {
      const decemberId = await createWholeWeekWindow("December");
      const januaryId = await createWholeWeekWindow("January");
      await putWindowPrices(chatModelId, [
        { pricingWindowId: decemberId, inputPrice: 0.5, validUntil: "2027-01-01T00:00" },
        { pricingWindowId: januaryId, inputPrice: 0.7, validFrom: "2027-01-01T00:00" },
      ]).expect(200);

      // Midnight in New York is 05:00 UTC, five hours into January.
      const refused = await patchWindow(decemberId, { timeZone: "America/New_York" }).expect(400);

      expect(refused.body.message).toBe(
        "Window Prices would overlap on the Upstream Models acme-large (Acme AI), so this Pricing Window's schedule can't change; change their Window Prices first",
      );
    });

    it("counts an Upstream Model that attaches a window twice once, and names that window once", async () => {
      const wholeWeekId = await createWholeWeekWindow();
      await putWindowPrices(chatModelId, [
        { pricingWindowId: wholeWeekId, inputPrice: 0.5, validUntil: "2027-01-01T00:00" },
        { pricingWindowId: wholeWeekId, inputPrice: 0.7, validFrom: "2027-02-01T00:00" },
      ]).expect(200);

      expect(await listPricingWindows()).toEqual([
        expect.objectContaining({ id: wholeWeekId, attachedUpstreamModelCount: 1 }),
      ]);
      const refused = await request(app.getHttpServer())
        .patch(`/api/upstream-models/${chatModelId}`)
        .set("Cookie", cookie)
        .send({ kind: "image", contextSize: null })
        .expect(400);
      expect(refused.body.message).toBe(
        "The Pricing Windows Whole Week give this Upstream Model Window Prices, so its Kind can't change; detach them first",
      );
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
