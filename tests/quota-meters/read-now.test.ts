import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providers } from "@/db/schemas/index.js";
import { FakeUpstream } from "../support/fake-upstream.js";
import {
  GENERAL_REMAINS,
  INVALID_KEY_REPLY,
  REMAINS_PATH,
  remainsAtPercentReply,
  remainsReply,
} from "../support/minimax-m-plan-remains.js";

// The reader's timeout comes from the environment, which ConfigModule reads
// when the app module is first imported.
process.env.QUOTA_READER_TIMEOUT_MS = "300";
const fakeUpstream = await FakeUpstream.start();
const { createTestApp, setUpFirstUser } = await import("../support/test-app.js");
const { deleteAllUpstreamData } = await import("../support/upstream.js");

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const M_PLAN_KEY = "sk-cp-0123456789abcdefWXYZ";

describe("Reading a Provider Account's Quota Meters now (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    fakeUpstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
    await fakeUpstream.close();
  });

  async function createAccount(quotaReader: "minimax-m-plan" | null): Promise<string> {
    const [provider] = await db
      .insert(providers)
      .values({
        slug: "plan",
        name: "Plan",
        protocol: "anthropic-messages",
        baseUrl: "https://api.plan.example/anthropic",
        authStyle: "bearer",
        quirks: { quotaBaseUrl: fakeUpstream.baseUrl },
        quotaReader,
      })
      .returning({ id: providers.id });
    const created = await request(app.getHttpServer())
      .post("/api/provider-accounts")
      .set("Cookie", cookie)
      .send({ providerId: provider.id, name: "Main", key: M_PLAN_KEY })
      .expect(201);
    return created.body.id;
  }

  function readNow(providerAccountId: string): request.Test {
    return request(app.getHttpServer())
      .post(`/api/provider-accounts/${providerAccountId}/quota-reading`)
      .set("Cookie", cookie);
  }

  async function listedAccount(providerAccountId: string): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get("/api/provider-accounts")
      .set("Cookie", cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === providerAccountId);
  }

  it("stores the 5-hour and weekly meters from the M Plan remains endpoint", async () => {
    const providerAccountId = await createAccount("minimax-m-plan");
    fakeUpstream.reply(remainsReply());

    const reading = await readNow(providerAccountId).expect(200);

    expect(fakeUpstream.lastRequest).toMatchObject({
      method: "GET",
      path: REMAINS_PATH,
      headers: { authorization: `Bearer ${M_PLAN_KEY}` },
    });
    const expectedMeters = [
      {
        key: "5h",
        label: "5-hour window",
        unit: "percent",
        used: null,
        limit: null,
        remainingPercent: 75,
        isUnlimited: false,
        windowSeconds: 18_000,
        resetsAt: "2026-11-15T11:16:10.993Z",
        scope: null,
        observedAt: expect.any(String),
      },
      {
        key: "weekly",
        label: "Weekly window",
        unit: "percent",
        used: null,
        limit: null,
        remainingPercent: 48,
        isUnlimited: false,
        windowSeconds: 604_800,
        resetsAt: "2026-11-19T03:46:10.506Z",
        scope: null,
        observedAt: expect.any(String),
      },
    ];
    expect(reading.body).toEqual({
      quotaCheckedAt: expect.any(String),
      quotaError: null,
      quotaMeters: expectedMeters,
    });
    expect(await listedAccount(providerAccountId)).toMatchObject({
      continueWhenExhausted: false,
      quotaError: null,
      quotaMeters: expectedMeters,
    });
  });

  it("replaces the meters on the next reading instead of adding rows", async () => {
    const providerAccountId = await createAccount("minimax-m-plan");
    fakeUpstream.reply(remainsReply());
    fakeUpstream.reply(remainsAtPercentReply(30));

    await readNow(providerAccountId).expect(200);
    const second = await readNow(providerAccountId).expect(200);

    expect(second.body.quotaMeters).toEqual([
      expect.objectContaining({ key: "5h", remainingPercent: 30 }),
      expect.objectContaining({ key: "weekly", remainingPercent: 30 }),
    ]);
  });

  it("gives a model group its own scoped meters, with counts and unlimited windows", async () => {
    const providerAccountId = await createAccount("minimax-m-plan");
    fakeUpstream.reply(
      remainsReply([
        GENERAL_REMAINS,
        {
          ...GENERAL_REMAINS,
          model_name: "video",
          current_interval_status: 3,
          current_weekly_total_count: 20,
          current_weekly_usage_count: 5,
          current_weekly_remaining_percent: 75,
        },
      ]),
    );

    const reading = await readNow(providerAccountId).expect(200);

    expect(reading.body.quotaMeters).toEqual([
      expect.objectContaining({ key: "5h", scope: null }),
      expect.objectContaining({
        key: "5h:video",
        label: "5-hour window (video)",
        scope: "video",
        isUnlimited: true,
      }),
      expect.objectContaining({ key: "weekly", scope: null }),
      expect.objectContaining({
        key: "weekly:video",
        label: "Weekly window (video)",
        scope: "video",
        unit: "count",
        used: 5,
        limit: 20,
        remainingPercent: 75,
        isUnlimited: false,
      }),
    ]);
  });

  it("keeps the last meters and records the error when MiniMax refuses the key", async () => {
    const providerAccountId = await createAccount("minimax-m-plan");
    fakeUpstream.reply(remainsReply());
    fakeUpstream.reply(INVALID_KEY_REPLY);

    await readNow(providerAccountId).expect(200);
    const failed = await readNow(providerAccountId).expect(200);

    expect(failed.body).toEqual({
      quotaCheckedAt: expect.any(String),
      quotaError: expect.stringContaining("1004"),
      quotaMeters: [
        expect.objectContaining({ key: "5h", remainingPercent: 75 }),
        expect.objectContaining({ key: "weekly", remainingPercent: 48 }),
      ],
    });
    expect(await listedAccount(providerAccountId)).toMatchObject({
      isEnabled: true,
      disabledReason: null,
      cooldownEndsAt: null,
      quotaError: expect.stringContaining("1004"),
    });
  });

  it("keeps the last meters and records the error when the remains endpoint times out", async () => {
    const providerAccountId = await createAccount("minimax-m-plan");
    fakeUpstream.reply(remainsReply());
    fakeUpstream.reply({ kind: "hang" });

    await readNow(providerAccountId).expect(200);
    const failed = await readNow(providerAccountId).expect(200);

    expect(failed.body.quotaError).toEqual(expect.stringMatching(/timed out/i));
    expect(failed.body.quotaMeters).toHaveLength(2);
    expect(await listedAccount(providerAccountId)).toMatchObject({ isEnabled: true });
  });

  it("refuses to read an account whose Provider has no quota reader", async () => {
    const providerAccountId = await createAccount(null);

    await readNow(providerAccountId).expect(400);

    expect(fakeUpstream.requests).toEqual([]);
  });

  it("lets the operator keep an account serving while Exhausted", async () => {
    const providerAccountId = await createAccount("minimax-m-plan");

    const updated = await request(app.getHttpServer())
      .patch(`/api/provider-accounts/${providerAccountId}`)
      .set("Cookie", cookie)
      .send({ continueWhenExhausted: true })
      .expect(200);

    expect(updated.body).toMatchObject({ continueWhenExhausted: true });
  });
});
