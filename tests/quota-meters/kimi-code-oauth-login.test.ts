import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import type { CatalogProvider } from "@/catalog/schemas/catalog.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { providers } from "@/db/schemas/index.js";
import {
  type FakeReply,
  FakeUpstream,
  type ReceivedRequest,
} from "@tests/support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "@tests/support/inference.js";
import { ALL_LIMITS, USAGES_PATH, usagesReply } from "@tests/support/kimi-code-usages.js";
import {
  ACCESS_TOKEN,
  addOauthLoginAccount,
  offerOauthLogin,
  refreshedTokensReply,
  REFRESH_TOKEN,
  TOKEN_PATH,
} from "@tests/support/kimi-oauth.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const CHAT_PATH = "/v1/chat/completions";
const GLOBAL_TOKEN_PATH = `/global${TOKEN_PATH}`;
const HOUR_SECONDS = 3600;
const SHORT_LIFETIME_SECONDS = 60;
const RENEWED = { accessToken: "access-token-2", refreshToken: "refresh-token-2" };

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

describe("Quota Meters of a Provider Account holding an OAuth Login (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let kimi: FakeUpstream;
  let catalogKimiCode: CatalogProvider;
  let apiKey: string;
  let cookie: string;
  let providerId: string;

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
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: kimi.baseUrl,
    }));
    await db
      .update(providers)
      .set({ quirks: catalogKimiCode.quirks, quotaReader: catalogKimiCode.quotaReader ?? null })
      .where(eq(providers.id, providerId));
    await offerOauthLogin(db, providerId, kimi.origin);
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await kimi.close();
    await app.close();
  });

  function readQuotaNow(providerAccountId: string) {
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

  function callsTo(path: string): ReceivedRequest[] {
    return kimi.requests.filter((received) => received.path === path);
  }

  it("reads the quota with the access token and no CLI identity", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
    });
    kimi.replyTo(USAGES_PATH, usagesReply(ALL_LIMITS));

    const reading = await readQuotaNow(accountId).expect(200);

    expect(reading.body.quotaError).toBeNull();
    expect(reading.body.quotaMeters).toHaveLength(4);
    expect(kimi.requests).toHaveLength(1);
    expect(kimi.lastRequest.headers).toMatchObject({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      accept: "application/json",
    });
    expect(kimi.lastRequest.headers).not.toHaveProperty("x-msh-platform");
    expect(kimi.lastRequest.headers).not.toHaveProperty("x-msh-device-id");
    expect(kimi.lastRequest.headers["user-agent"]).not.toContain("kimi-code-cli");
  });

  it("refreshes a login about to run out before reading the quota", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }));
    kimi.replyTo(USAGES_PATH, usagesReply(ALL_LIMITS));

    const reading = await readQuotaNow(accountId).expect(200);

    expect(reading.body.quotaError).toBeNull();
    expect(callsTo(GLOBAL_TOKEN_PATH).map((refresh) => refresh.body)).toEqual([
      expect.objectContaining({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN }),
    ]);
    expect(callsTo(USAGES_PATH)[0].headers.authorization).toBe(`Bearer ${RENEWED.accessToken}`);
  });

  it("refreshes once when a quota reading and an inference request arrive together", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
    });
    const slowRefreshMs = 300;
    kimi.replyTo(
      GLOBAL_TOKEN_PATH,
      refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }, slowRefreshMs),
    );
    kimi.replyTo(USAGES_PATH, usagesReply(ALL_LIMITS));
    kimi.replyTo(CHAT_PATH, COMPLETION);

    const [reading, chat] = await Promise.all([
      readQuotaNow(accountId),
      request(app.getHttpServer())
        .post(CHAT_PATH)
        .set("Authorization", `Bearer ${apiKey}`)
        .send(TEXT_REQUEST),
    ]);

    expect([reading.status, chat.status]).toEqual([200, 200]);
    expect(reading.body.quotaError).toBeNull();
    expect(callsTo(GLOBAL_TOKEN_PATH)).toHaveLength(1);
    expect(callsTo(USAGES_PATH)[0].headers.authorization).toBe(`Bearer ${RENEWED.accessToken}`);
    expect(callsTo(CHAT_PATH)[0].headers.authorization).toBe(`Bearer ${RENEWED.accessToken}`);
  });

  it("disables the account with a sign-in-again reason when the refresh before a reading is refused", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, {
      kind: "json",
      status: 400,
      body: { error: "invalid_grant" },
    });

    const reading = await readQuotaNow(accountId).expect(200);

    expect(reading.body.quotaError).toEqual(expect.stringContaining("invalid_grant"));
    expect(callsTo(USAGES_PATH)).toHaveLength(0);
    expect(await listedAccount(accountId)).toMatchObject({
      isEnabled: false,
      disabledReason: expect.stringMatching(/^Sign in again/),
    });
  });
});
