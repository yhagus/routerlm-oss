import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import {
  anthropicMessagesFixture,
  type FakeReply,
  FakeUpstream,
} from "../support/fake-upstream.js";
import {
  addProviderAccount,
  insertAnthropicMessagesModel,
  insertApiKey,
  setProviderQuirks,
  UPSTREAM_KEY,
} from "../support/inference.js";
import { GENERAL_REMAINS, REMAINS_PATH, remainsReply } from "../support/minimax-m-plan-remains.js";

import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const BACKUP_KEY = "sk-backup-secret-9876543210";
const OPERATOR = { email: "ops@example.com", password: "ops password" };
const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const HOUR_MS = 60 * 60_000;

const SUCCESS: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(anthropicMessagesFixture("upstream-response-tool-call.json")),
};

/** MiniMax's Anthropic-compatible answer once the plan's usage limit is reached, as observed upstream. */
const USAGE_LIMIT_EXCEEDED: FakeReply = {
  kind: "json",
  status: 429,
  body: {
    type: "error",
    error: {
      type: "rate_limit_error",
      message:
        "usage limit exceeded, 5-hour usage limit reached for Token Plan Starter (0/0 used), " +
        "resets at 2026-05-15T15:00:00Z (2056)",
    },
    request_id: "065651beccc4579e5c7e66c939d1987e",
  },
};

/** MiniMax's plan limit with automatic Credit use off, in its native `base_resp` shape. */
const PLAN_LIMIT_REACHED: FakeReply = {
  kind: "json",
  status: 400,
  body: { base_resp: { status_code: 2067, status_msg: "plan limit reached" } },
};

/** An M Plan remains answer with both unscoped windows at `percent`, resetting at the given times. */
function remainsAt(percent: number, fiveHourResetsAt: Date, weeklyResetsAt: Date): FakeReply {
  return remainsReply([
    {
      ...GENERAL_REMAINS,
      end_time: fiveHourResetsAt.getTime(),
      weekly_end_time: weeklyResetsAt.getTime(),
      current_interval_remaining_percent: percent,
      current_weekly_remaining_percent: percent,
    },
  ]);
}

describe("Exhausted Provider Accounts (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let inferenceUpstream: FakeUpstream;
  // The quota reader asks its own fake upstream, so its replies never take the
  // place of an inference reply queued on the other one.
  let quotaUpstream: FakeUpstream;
  let providerId: string;
  let apiKey: string;
  let cookie: string;
  let primaryAccountId: string;
  let backupAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    inferenceUpstream = await FakeUpstream.start();
    quotaUpstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    inferenceUpstream.reset();
    quotaUpstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const inserted = await insertAnthropicMessagesModel(app, db, {
      modelName: "smart",
      baseUrl: inferenceUpstream.baseUrl,
    });
    ({ providerAccountId: primaryAccountId, providerId } = inserted);
    await db
      .update(providers)
      .set({ quotaReader: "minimax-m-plan" })
      .where(eq(providers.id, providerId));
    await setProviderQuirks(app, db, providerId, {
      quotaBaseUrl: quotaUpstream.baseUrl,
      exhaustedErrorCodes: [2056, 2067],
    });
    backupAccountId = await addProviderAccount(app, db, providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await inferenceUpstream.close();
    await quotaUpstream.close();
    await app.close();
  });

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  async function readQuotaNow(
    reply: FakeReply,
    providerAccountId = primaryAccountId,
  ): Promise<void> {
    quotaUpstream.reply(reply);
    await request(app.getHttpServer())
      .post(`/api/provider-accounts/${providerAccountId}/quota-reading`)
      .set("Cookie", cookie)
      .expect(200);
  }

  async function listedPrimaryAccount(): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get("/api/provider-accounts")
      .set("Cookie", cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === primaryAccountId);
  }

  /** Which Provider Account each Attempt used, by the key it sent. */
  function attemptedKeys(): string[] {
    return inferenceUpstream.requests.map((received) => String(received.headers["x-api-key"]));
  }

  it("skips an account whose reading is at 0% until its last exhausted window resets", async () => {
    const fiveHourResetsAt = new Date(Date.now() + HOUR_MS);
    const weeklyResetsAt = new Date(Date.now() + 48 * HOUR_MS);
    await readQuotaNow(remainsAt(0, fiveHourResetsAt, weeklyResetsAt));
    inferenceUpstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([BACKUP_KEY]);
    expect(await listedPrimaryAccount()).toMatchObject({
      cooldownCause: "exhausted",
      cooldownEndsAt: weeklyResetsAt.toISOString(),
    });
  });

  it.each<[string, FakeReply]>([
    ["usage limit exceeded (2056)", USAGE_LIMIT_EXCEEDED],
    ["plan limit reached (2067)", PLAN_LIMIT_REACHED],
  ])(
    "falls back after a %s Attempt, and a reading triggered by it sets when the account is routable again",
    async (_error, exhaustedReply) => {
      const weeklyResetsAt = new Date(Date.now() + 48 * HOUR_MS);
      quotaUpstream.reply(remainsAt(0, new Date(Date.now() + HOUR_MS), weeklyResetsAt));
      inferenceUpstream.reply(exhaustedReply);
      inferenceUpstream.reply(SUCCESS);

      await chat().expect(200);

      expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
      expect(await listedPrimaryAccount()).toMatchObject({ cooldownCause: "exhausted" });
      await vi.waitFor(async () => {
        expect(quotaUpstream.lastRequest.path).toBe(REMAINS_PATH);
        expect(await listedPrimaryAccount()).toMatchObject({
          cooldownCause: "exhausted",
          cooldownEndsAt: weeklyResetsAt.toISOString(),
        });
      });
    },
  );

  it("treats a 2056 refusal as a rate limit at a Provider whose data names no exhausted error codes", async () => {
    await setProviderQuirks(app, db, providerId, { quotaBaseUrl: quotaUpstream.baseUrl });
    inferenceUpstream.reply(USAGE_LIMIT_EXCEEDED);
    inferenceUpstream.reply(SUCCESS);

    await chat().expect(200);

    expect(await listedPrimaryAccount()).toMatchObject({ cooldownCause: "rate_limited" });
    expect(quotaUpstream.requests).toEqual([]);
  });

  it("answers 429 when every Provider Account is Exhausted", async () => {
    const inAnHour = new Date(Date.now() + HOUR_MS);
    await readQuotaNow(remainsAt(0, inAnHour, inAnHour));
    await readQuotaNow(remainsAt(0, inAnHour, inAnHour), backupAccountId);

    const response = await chat().expect(429);

    expect(response.body.error).toMatchObject({
      code: "upstream_rate_limited",
      message: expect.stringContaining("Exhausted"),
    });
    expect(inferenceUpstream.requests).toEqual([]);
  });

  it("answers 429 when the last Provider Account left is refused as Exhausted", async () => {
    const inAnHour = new Date(Date.now() + HOUR_MS);
    await readQuotaNow(remainsAt(0, inAnHour, inAnHour), backupAccountId);
    inferenceUpstream.reply(USAGE_LIMIT_EXCEEDED);

    const response = await chat().expect(429);

    expect(response.body.error.message).toContain("Exhausted");
  });

  it("keeps routing to an account at 0% that may continue when Exhausted", async () => {
    await db
      .update(providerAccounts)
      .set({ continueWhenExhausted: true })
      .where(eq(providerAccounts.id, primaryAccountId));
    const inAnHour = new Date(Date.now() + HOUR_MS);
    await readQuotaNow(remainsAt(0, inAnHour, inAnHour));
    inferenceUpstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it("routes to an Exhausted account again once a reading shows quota", async () => {
    const inAnHour = new Date(Date.now() + HOUR_MS);
    await readQuotaNow(remainsAt(0, inAnHour, inAnHour));
    await readQuotaNow(remainsAt(20, inAnHour, inAnHour));
    inferenceUpstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
    expect(await listedPrimaryAccount()).toMatchObject({ cooldownCause: null });
  });

  it("routes to an Exhausted account again once its meter at 0% has reset", async () => {
    const inAnHour = new Date(Date.now() + HOUR_MS);
    const anHourAgo = new Date(Date.now() - HOUR_MS);
    await readQuotaNow(remainsAt(0, inAnHour, inAnHour));
    await readQuotaNow(remainsAt(0, anHourAgo, anHourAgo));
    inferenceUpstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });
});
