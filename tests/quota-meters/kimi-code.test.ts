import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import type { CatalogProvider } from "@/catalog/schemas/catalog.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import { type FakeReply, FakeUpstream } from "@tests/support/fake-upstream.js";
import {
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  UPSTREAM_KEY,
} from "@tests/support/inference.js";
import {
  ALL_LIMITS,
  USAGES_PATH,
  usagesAtRatioReply,
  usagesReply,
} from "@tests/support/kimi-code-usages.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const BACKUP_KEY = "sk-backup-secret-9876543210";
const OPERATOR = { email: "ops@example.com", password: "ops password" };
const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const HOUR_MS = 60 * 60_000;

/** What Node's fetch adds to every request; no reader chooses these. */
const FETCH_OWN_HEADERS = new Set([
  "accept-encoding",
  "accept-language",
  "connection",
  "host",
  "sec-fetch-mode",
  "user-agent",
]);

function headersTheGatewayChose(headers: Record<string, unknown>): string[] {
  return Object.keys(headers)
    .filter((name) => !FETCH_OWN_HEADERS.has(name))
    .sort();
}

const COMPLETION: FakeReply = {
  kind: "json",
  status: 200,
  body: {
    id: "chatcmpl-kimi-1",
    object: "chat.completion",
    model: "k3",
    choices: [
      { index: 0, message: { role: "assistant", content: "Hello." }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  },
};

/** Kimi's refusal once the plan's quota is used up. */
const QUOTA_EXCEEDED: FakeReply = {
  kind: "json",
  status: 429,
  body: { error: { type: "exceeded_current_quota_error", message: "Quota used up" } },
};

describe("Quota Meters of a Kimi Code Provider Account (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  // Kimi serves inference and `/usages` under one base URL, so one fake upstream is both.
  let kimi: FakeUpstream;
  let catalogKimiCode: CatalogProvider;
  let apiKey: string;
  let cookie: string;
  let providerId: string;
  let primaryAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    kimi = await FakeUpstream.start();
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const kimiCode = catalog.find((provider) => provider.slug === "kimi-code");
    if (!kimiCode) throw new Error("the Catalog has no Kimi Code Provider");
    catalogKimiCode = kimiCode;
  });

  beforeEach(async () => {
    kimi.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    // The Provider as the Catalog seeds it, but at the fake upstream.
    const inserted = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: kimi.baseUrl,
    });
    ({ providerId, providerAccountId: primaryAccountId } = inserted);
    await db
      .update(providers)
      .set({ quirks: catalogKimiCode.quirks, quotaReader: catalogKimiCode.quotaReader ?? null })
      .where(eq(providers.id, providerId));
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await kimi.close();
    await app.close();
  });

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  async function readQuotaNow(reply: FakeReply): Promise<request.Response> {
    kimi.replyTo(USAGES_PATH, reply);
    return request(app.getHttpServer())
      .post(`/api/provider-accounts/${primaryAccountId}/quota-reading`)
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
    return kimi.requests
      .filter((received) => received.path !== USAGES_PATH)
      .map((received) => String(received.headers.authorization).replace("Bearer ", ""));
  }

  it("stores a meter for each of the four limits Kimi reports, ignoring limits and boosterWallet", async () => {
    const reading = await readQuotaNow(usagesReply(ALL_LIMITS));

    expect(kimi.lastRequest).toMatchObject({
      method: "GET",
      path: USAGES_PATH,
      headers: { authorization: `Bearer ${UPSTREAM_KEY}`, accept: "application/json" },
    });
    expect(headersTheGatewayChose(kimi.lastRequest.headers)).toEqual(["accept", "authorization"]);
    expect(kimi.lastRequest.headers["user-agent"]).not.toContain("routerlm");
    const percentMeter = {
      unit: "percent",
      limit: 100,
      isUnlimited: false,
      scope: null,
      observedAt: expect.any(String),
    };
    expect(reading.body).toEqual({
      quotaCheckedAt: expect.any(String),
      quotaError: null,
      quotaMeters: [
        {
          ...percentMeter,
          key: "5h",
          label: "5-hour limit",
          used: 25,
          remainingPercent: 75,
          windowSeconds: 18_000,
          resetsAt: "2026-11-15T16:00:00.000Z",
        },
        {
          ...percentMeter,
          key: "7d",
          label: "7-day limit",
          used: 50,
          remainingPercent: 50,
          windowSeconds: 604_800,
          resetsAt: "2026-11-20T00:00:00.000Z",
        },
        {
          ...percentMeter,
          key: "month-code",
          label: "Monthly code limit",
          used: 75,
          remainingPercent: 25,
          windowSeconds: null,
          resetsAt: "2026-11-30T16:00:00.000Z",
        },
        {
          ...percentMeter,
          key: "month-total",
          label: "Monthly limit",
          used: 12.5,
          remainingPercent: 87.5,
          windowSeconds: null,
          resetsAt: "2026-11-30T16:00:00.000Z",
        },
      ],
      usageResets: null,
    });
  });

  it("shows only the limits the plan reports, and drops a meter Kimi stops reporting", async () => {
    await readQuotaNow(usagesReply(ALL_LIMITS));

    const reading = await readQuotaNow(
      usagesReply({ limit_5h: ALL_LIMITS.limit_5h, limit_7d: ALL_LIMITS.limit_7d }),
    );

    expect(reading.body.quotaError).toBeNull();
    expect(reading.body.quotaMeters).toEqual([
      expect.objectContaining({ key: "5h" }),
      expect.objectContaining({ key: "7d" }),
    ]);
  });

  it("reads a used ratio sent as a numeric string", async () => {
    const reading = await readQuotaNow(
      usagesReply({ limit_5h: { used_ratio: "0.4", reset_time: "2026-11-15T16:00:00Z" } }),
    );

    expect(reading.body.quotaMeters).toEqual([
      expect.objectContaining({ key: "5h", used: 40, remainingPercent: 60 }),
    ]);
  });

  it("keeps the last meters and records the error when Kimi refuses the credential", async () => {
    await readQuotaNow(usagesReply(ALL_LIMITS));

    const failed = await readQuotaNow({
      kind: "json",
      status: 401,
      body: { error: { type: "invalid_authentication_error", message: "Invalid Authentication" } },
    });

    expect(failed.body.quotaError).toEqual(expect.stringContaining("401"));
    expect(failed.body.quotaMeters).toHaveLength(4);
  });

  it("skips an account with one limit used up until that limit resets", async () => {
    const weekResetsAt = new Date(Date.now() + 48 * HOUR_MS);
    await readQuotaNow(
      usagesReply({
        ...ALL_LIMITS,
        limit_7d: { used_ratio: 1, reset_time: weekResetsAt.toISOString() },
      }),
    );
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([BACKUP_KEY]);
    expect(await listedPrimaryAccount()).toMatchObject({
      cooldownCause: "exhausted",
      cooldownEndsAt: weekResetsAt.toISOString(),
    });
  });

  it("keeps routing to an account with a limit used up that may continue when Exhausted", async () => {
    await db
      .update(providerAccounts)
      .set({ continueWhenExhausted: true })
      .where(eq(providerAccounts.id, primaryAccountId));
    await readQuotaNow(usagesAtRatioReply(1, new Date(Date.now() + HOUR_MS)));
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it("reads the quota after a quota-exceeded Attempt, which sets when the account is routable again", async () => {
    const resetsAt = new Date(Date.now() + 3 * HOUR_MS);
    kimi.replyTo(USAGES_PATH, usagesAtRatioReply(1, resetsAt));
    kimi.reply(QUOTA_EXCEEDED);
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
    await vi.waitFor(async () => {
      expect(await listedPrimaryAccount()).toMatchObject({
        cooldownCause: "exhausted",
        cooldownEndsAt: resetsAt.toISOString(),
        quotaMeters: expect.arrayContaining([
          expect.objectContaining({ key: "5h", remainingPercent: 0 }),
        ]),
      });
    });
  });
});
