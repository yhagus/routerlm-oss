import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import type { CatalogProvider } from "@/catalog/schemas/catalog.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import {
  type FakeReply,
  FakeUpstream,
  openAiResponsesFixture,
  type ReceivedRequest,
} from "../support/fake-upstream.js";
import { insertApiKey, insertOpenAiResponsesModel, UPSTREAM_KEY } from "../support/inference.js";
import {
  ACCOUNT_ID,
  accessToken,
  addCodexLoginAccount,
  CLI_VERSION,
  offerCodexOauthLogin,
  TOKEN_PATH,
  tokensReply,
} from "../support/openai-codex-oauth.js";
import {
  FIVE_HOURS_IN_SECONDS,
  rateLimitOf,
  USAGE_PATH,
  usageAtPercentReply,
  usageReply,
  usageWindow,
  WEEK_IN_SECONDS,
} from "../support/openai-codex-usage.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const RESPONSES_PATH = "/v1/responses";
const HOUR_SECONDS = 3600;
const HOUR_MS = HOUR_SECONDS * 1000;
/** Under the 300 seconds below which every OAuth Login is refreshed. */
const SHORT_LIFETIME_SECONDS = 60;
const REFRESH_TOKEN = "codex-refresh-token-0123";

// The Codex backend always answers as a stream (the Catalog's alwaysStreams quirk).
const STREAMED_RESPONSE: FakeReply = {
  kind: "stream",
  events: openAiResponsesFixture("upstream-stream-tool-call.sse"),
};

function usageLimitReached(resetsAt: Date): FakeReply {
  return {
    kind: "json",
    status: 429,
    body: {
      error: {
        type: "usage_limit_reached",
        message: "The usage limit has been reached",
        plan_type: "pro",
        resets_at: Math.floor(resetsAt.getTime() / 1000),
      },
    },
  };
}

describe("Quota Meters of an OpenAI Codex Provider Account (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  // Plays the Codex backend, `wham/usage` included, and OpenAI's auth host.
  let openAi: FakeUpstream;
  let catalogCodex: CatalogProvider;
  let apiKey: string;
  let cookie: string;
  let providerId: string;
  let token: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    openAi = await FakeUpstream.start();
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const codex = catalog.find((provider) => provider.slug === "openai-codex");
    if (!codex) throw new Error("the Catalog has no OpenAI Codex Provider");
    catalogCodex = codex;
  });

  beforeEach(async () => {
    openAi.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    // The Provider as the Catalog seeds it, but at the fake upstream. Its API
    // key account is the backup: the OAuth Login account runs first.
    ({ providerId } = await insertOpenAiResponsesModel(app, db, {
      modelName: "smart",
      baseUrl: openAi.baseUrl,
    }));
    await db
      .update(providers)
      .set({ quirks: catalogCodex.quirks, quotaReader: catalogCodex.quotaReader ?? null })
      .where(eq(providers.id, providerId));
    await offerCodexOauthLogin(db, providerId, openAi.origin);
    ({ key: apiKey } = await insertApiKey(app, db));
    token = accessToken("granted", HOUR_SECONDS);
  });

  afterAll(async () => {
    await openAi.close();
    await app.close();
  });

  function addLoginAccount(lifetimeSeconds = HOUR_SECONDS): Promise<string> {
    token = accessToken("granted", lifetimeSeconds);
    return addCodexLoginAccount(app, db, providerId, {
      accessToken: token,
      refreshToken: REFRESH_TOKEN,
    });
  }

  function readQuotaNow(providerAccountId: string) {
    return request(app.getHttpServer())
      .post(`/api/provider-accounts/${providerAccountId}/quota-reading`)
      .set("Cookie", cookie)
      .expect(200);
  }

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  async function listedAccount(providerAccountId: string): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get("/api/provider-accounts")
      .set("Cookie", cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === providerAccountId);
  }

  function callsTo(path: string): ReceivedRequest[] {
    return openAi.requests.filter((received) => received.path === path);
  }

  /** The credential each Attempt sent, in order. */
  function attemptedCredentials(): string[] {
    return callsTo(RESPONSES_PATH).map((received) =>
      String(received.headers.authorization).replace("Bearer ", ""),
    );
  }

  it("reads both windows and every additional limit as the Codex CLI", async () => {
    const accountId = await addLoginAccount();
    const fiveHourReset = new Date("2026-11-17T15:00:00Z");
    const weekReset = new Date("2026-11-21T00:00:00Z");
    openAi.replyTo(
      USAGE_PATH,
      usageReply({
        rateLimit: rateLimitOf({
          primary: usageWindow(25, FIVE_HOURS_IN_SECONDS, fiveHourReset),
          secondary: usageWindow(60, WEEK_IN_SECONDS, weekReset),
        }),
        additionalRateLimits: [
          {
            limit_name: "codex_other",
            rate_limit: rateLimitOf({
              primary: usageWindow(10, FIVE_HOURS_IN_SECONDS, fiveHourReset),
            }),
          },
        ],
      }),
    );

    const reading = await readQuotaNow(accountId);

    expect(callsTo(USAGE_PATH)).toHaveLength(1);
    expect(openAi.lastRequest).toMatchObject({
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "chatgpt-account-id": ACCOUNT_ID,
        originator: "codex_cli_rs",
        "user-agent": expect.stringMatching(new RegExp(`^codex_cli_rs/${CLI_VERSION} `)),
        version: CLI_VERSION,
      },
    });
    const percentMeter = {
      unit: "percent",
      limit: 100,
      isUnlimited: false,
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
          windowSeconds: FIVE_HOURS_IN_SECONDS,
          resetsAt: fiveHourReset.toISOString(),
          scope: null,
        },
        {
          ...percentMeter,
          key: "5h:codex_other",
          label: "5-hour limit (codex_other)",
          used: 10,
          remainingPercent: 90,
          windowSeconds: FIVE_HOURS_IN_SECONDS,
          resetsAt: fiveHourReset.toISOString(),
          scope: "codex_other",
        },
        {
          ...percentMeter,
          key: "weekly",
          label: "Weekly limit",
          used: 60,
          remainingPercent: 40,
          windowSeconds: WEEK_IN_SECONDS,
          resetsAt: weekReset.toISOString(),
          scope: null,
        },
      ],
    });
  });

  it("keys a window of another length by its duration and shows no meter for a missing window", async () => {
    const accountId = await addLoginAccount();
    const resetsAt = new Date("2026-11-18T00:00:00Z");
    openAi.replyTo(
      USAGE_PATH,
      usageReply({
        rateLimit: rateLimitOf({ primary: usageWindow(5, 2 * HOUR_SECONDS, resetsAt) }),
      }),
    );

    const reading = await readQuotaNow(accountId);

    expect(reading.body.quotaMeters).toEqual([
      expect.objectContaining({ key: "2h", windowSeconds: 7200, used: 5 }),
    ]);
  });

  it("refreshes a login about to run out before reading the quota", async () => {
    const accountId = await addLoginAccount(SHORT_LIFETIME_SECONDS);
    const renewed = accessToken("renewed", HOUR_SECONDS);
    openAi.replyTo(TOKEN_PATH, tokensReply({ accessToken: renewed }));
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(10, new Date(Date.now() + HOUR_MS)));

    const reading = await readQuotaNow(accountId);

    expect(reading.body.quotaError).toBeNull();
    expect(callsTo(TOKEN_PATH)).toHaveLength(1);
    expect(callsTo(USAGE_PATH)[0].headers.authorization).toBe(`Bearer ${renewed}`);
  });

  it("marks the account Exhausted until resets_at on usage_limit_reached, reads its quota and falls back", async () => {
    const accountId = await addLoginAccount();
    const resetsAt = new Date(Math.floor((Date.now() + 3 * HOUR_MS) / 1000) * 1000);
    // A failed reading leaves the end the refusal set.
    openAi.replyTo(USAGE_PATH, { kind: "json", status: 500, body: {} });
    openAi.reply(usageLimitReached(resetsAt));
    openAi.reply(STREAMED_RESPONSE);

    await chat().expect(200);

    expect(attemptedCredentials()).toEqual([token, UPSTREAM_KEY]);
    expect(await listedAccount(accountId)).toMatchObject({
      cooldownCause: "exhausted",
      cooldownEndsAt: resetsAt.toISOString(),
    });
    await vi.waitFor(() => expect(callsTo(USAGE_PATH)).toHaveLength(1));
  });

  it("starts a Cooldown on any other 429", async () => {
    const accountId = await addLoginAccount();
    openAi.reply({
      kind: "json",
      status: 429,
      body: { error: { type: "rate_limit_exceeded", message: "Slow down" } },
    });
    openAi.reply(STREAMED_RESPONSE);

    await chat().expect(200);

    expect(attemptedCredentials()).toEqual([token, UPSTREAM_KEY]);
    expect(await listedAccount(accountId)).toMatchObject({ cooldownCause: "rate_limited" });
    expect(callsTo(USAGE_PATH)).toHaveLength(0);
  });

  it("keeps routing to an account with a used-up plan that may continue when Exhausted", async () => {
    const accountId = await addLoginAccount();
    await db
      .update(providerAccounts)
      .set({ continueWhenExhausted: true })
      .where(eq(providerAccounts.id, accountId));
    await app.get(SnapshotService).changed();
    openAi.replyTo(USAGE_PATH, usageAtPercentReply(100, new Date(Date.now() + HOUR_MS)));
    await readQuotaNow(accountId);
    openAi.reply(STREAMED_RESPONSE);

    await chat().expect(200);

    expect(attemptedCredentials()).toEqual([token]);
  });
});
