import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations";
import {
  deleteAllPricingWindows,
  weekdayBefore,
  zoneAtNoonNow,
} from "@tests/support/pricing-windows";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app";
import { deleteAllUpstreamData } from "@tests/support/upstream";

const OPERATOR = { email: "ops@example.com", password: "ops password" };

const OFF_PEAK = {
  name: "DeepSeek Off-Peak",
  timeZone: "UTC",
  ranges: [
    { weekdays: [1, 2, 3, 4, 5], start: "10:00", end: "24:00" },
    { weekdays: [6, 7], start: "00:00", end: "24:00" },
  ],
};

describe("Pricing Windows (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    await deleteAllPricingWindows(db);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createWindow(body: object): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/pricing-windows")
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
    return created.body.id;
  }

  async function listWindows(): Promise<unknown[]> {
    const list = await request(app.getHttpServer())
      .get("/api/pricing-windows")
      .set("Cookie", cookie)
      .expect(200);
    return list.body;
  }

  it("creates a Pricing Window, enabled, with an end of 24:00, and lists it", async () => {
    const id = await createWindow(OFF_PEAK);

    expect(await listWindows()).toEqual([
      expect.objectContaining({ id, ...OFF_PEAK, isEnabled: true, attachedUpstreamModelCount: 0 }),
    ]);
  });

  it("edits a Pricing Window's name, time zone and ranges", async () => {
    const id = await createWindow(OFF_PEAK);
    const changes = {
      name: "Night",
      timeZone: "Asia/Shanghai",
      ranges: [{ weekdays: [7], start: "22:00", end: "06:00" }],
    };

    const updated = await request(app.getHttpServer())
      .patch(`/api/pricing-windows/${id}`)
      .set("Cookie", cookie)
      .send(changes)
      .expect(200);

    expect(updated.body).toMatchObject({ id, ...changes, isEnabled: true });
  });

  it.each([
    ["no ranges", { ranges: [] }, "A Pricing Window needs at least one range"],
    [
      "a range with no weekdays",
      { ranges: [{ weekdays: [], start: "01:00", end: "02:00" }] },
      "A range needs at least one weekday",
    ],
    [
      "a range whose start equals its end",
      { ranges: [{ weekdays: [1], start: "08:00", end: "08:00" }] },
      "A range's start can't equal its end",
    ],
    ["an unknown time zone", { timeZone: "Mars/Olympus_Mons" }, "Unknown time zone"],
  ])("refuses a Pricing Window with %s", async (_case, override, message) => {
    const refused = await request(app.getHttpServer())
      .post("/api/pricing-windows")
      .set("Cookie", cookie)
      .send({ ...OFF_PEAK, ...override })
      .expect(400);

    expect(refused.body.message).toEqual([expect.stringContaining(message)]);
  });

  it("refuses a second Pricing Window with the same name, on create and on rename", async () => {
    await createWindow(OFF_PEAK);
    const otherId = await createWindow({ ...OFF_PEAK, name: "Weekend" });

    const created = await request(app.getHttpServer())
      .post("/api/pricing-windows")
      .set("Cookie", cookie)
      .send(OFF_PEAK)
      .expect(409);
    const renamed = await request(app.getHttpServer())
      .patch(`/api/pricing-windows/${otherId}`)
      .set("Cookie", cookie)
      .send({ name: OFF_PEAK.name })
      .expect(409);

    expect(created.body.message).toBe('A Pricing Window named "DeepSeek Off-Peak" already exists');
    expect(renamed.body.message).toBe(created.body.message);
  });

  it("deletes a Pricing Window", async () => {
    const id = await createWindow(OFF_PEAK);

    await request(app.getHttpServer())
      .delete(`/api/pricing-windows/${id}`)
      .set("Cookie", cookie)
      .expect(204);

    expect(await listWindows()).toEqual([]);
  });

  it("answers 404 for a Pricing Window that doesn't exist", async () => {
    const missingId = "00000000-0000-4000-8000-000000000000";
    const server = app.getHttpServer();

    await request(server)
      .patch(`/api/pricing-windows/${missingId}`)
      .set("Cookie", cookie)
      .send({ isEnabled: false })
      .expect(404);
    await request(server)
      .delete(`/api/pricing-windows/${missingId}`)
      .set("Cookie", cookie)
      .expect(404);
  });

  describe("active now", () => {
    const { timeZone, today } = zoneAtNoonNow();
    const yesterday = weekdayBefore(today);

    async function isActiveNow(ranges: object[], isEnabled = true): Promise<unknown> {
      await createWindow({ name: "Window", timeZone, ranges, isEnabled });
      const list = await request(app.getHttpServer())
        .get("/api/pricing-windows")
        .set("Cookie", cookie)
        .expect(200);
      return list.body[0].isActiveNow;
    }

    it("is active during one of its ranges, read in its own time zone", async () => {
      expect(await isActiveNow([{ weekdays: [today], start: "11:00", end: "14:00" }])).toBe(true);
    });

    it("is not active on another weekday at the same time", async () => {
      expect(await isActiveNow([{ weekdays: [yesterday], start: "11:00", end: "14:00" }])).toBe(
        false,
      );
    });

    it("is active in a range that started yesterday and crosses midnight", async () => {
      expect(await isActiveNow([{ weekdays: [yesterday], start: "14:00", end: "13:00" }])).toBe(
        true,
      );
    });

    it("counts a range that crosses midnight from the weekday it starts on", async () => {
      expect(await isActiveNow([{ weekdays: [today], start: "14:00", end: "13:00" }])).toBe(false);
    });

    it("is never active while disabled", async () => {
      expect(await isActiveNow([{ weekdays: [today], start: "11:00", end: "14:00" }], false)).toBe(
        false,
      );
    });
  });

  it("refuses the dashboard API without a session", async () => {
    await request(app.getHttpServer()).get("/api/pricing-windows").expect(401);
  });
});
