import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import {
  type FakeReply,
  FakeUpstream,
  type ReceivedRequest,
} from "@tests/support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel, UPSTREAM_KEY } from "@tests/support/inference.js";
import {
  ACCESS_TOKEN,
  addOauthLoginAccount,
  CLI_VERSION,
  CLIENT_ID,
  DEVICE_ID,
  offerOauthLogin,
  REFRESH_TOKEN,
  refreshedTokensReply,
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

const UNAUTHORIZED: FakeReply = {
  kind: "json",
  status: 401,
  body: { error: { type: "invalid_authentication_error", message: "Token expired" } },
};

const UNAVAILABLE: FakeReply = { kind: "json", status: 503, body: { error: "unavailable" } };

const INVALID_GRANT: FakeReply = { kind: "json", status: 400, body: { error: "invalid_grant" } };

describe("Inference from a Provider Account holding an OAuth Login (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let kimi: FakeUpstream;
  let apiKey: string;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    kimi = await FakeUpstream.start();
  });

  beforeEach(async () => {
    kimi.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: kimi.baseUrl,
    }));
    await offerOauthLogin(db, providerId, kimi.origin);
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

  async function listedAccount(providerAccountId: string): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get("/api/provider-accounts")
      .set("Cookie", cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === providerAccountId);
  }

  function chatCalls(): ReceivedRequest[] {
    return kimi.requests.filter((received) => received.path === CHAT_PATH);
  }

  function attemptedCredentials(): string[] {
    return chatCalls().map((received) =>
      String(received.headers.authorization).replace("Bearer ", ""),
    );
  }

  function refreshes(): ReceivedRequest[] {
    return kimi.requests.filter((received) => received.path.endsWith(TOKEN_PATH));
  }

  it("serves with the access token, presenting the CLI with the account's device id", async () => {
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: HOUR_SECONDS });
    kimi.reply(COMPLETION);

    const response = await chat().expect(200);

    expect(response.body.choices[0].message.content).toBe("Hello.");
    expect(kimi.requests).toHaveLength(1);
    expect(kimi.lastRequest.path).toBe(CHAT_PATH);
    expect(kimi.lastRequest.headers).toMatchObject({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      "user-agent": `kimi-code-cli/${CLI_VERSION}`,
      "x-msh-platform": "kimi_code_cli",
      "x-msh-version": CLI_VERSION,
      "x-msh-device-id": DEVICE_ID,
      "x-msh-device-name": "routerlm",
      "x-msh-device-model": expect.any(String),
      "x-msh-os-version": expect.any(String),
    });
  });

  it("refreshes a login with under 300 seconds left, and serves with the new access token", async () => {
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: SHORT_LIFETIME_SECONDS });
    kimi.replyTo(GLOBAL_TOKEN_PATH, refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }));
    kimi.reply(COMPLETION);

    await chat().expect(200);

    const [refresh] = refreshes();
    expect(refresh.method).toBe("POST");
    expect(refresh.body).toEqual({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    });
    expect(refresh.headers).toMatchObject({
      "user-agent": `kimi-code-cli/${CLI_VERSION}`,
      "x-msh-device-id": DEVICE_ID,
    });
    expect(attemptedCredentials()).toEqual([RENEWED.accessToken]);
  });

  it("refreshes a login past half its lifetime, and leaves a younger one alone", async () => {
    await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
      ageSeconds: HOUR_SECONDS / 2 + 60,
      priority: -2,
    });
    await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
      ageSeconds: HOUR_SECONDS / 2 - 60,
      accessToken: "younger-access-token",
      deviceId: "device-id-of-the-younger-login",
      priority: -1,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }));
    kimi.reply(UNAVAILABLE);
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(refreshes()).toHaveLength(1);
    expect(attemptedCredentials()).toEqual([RENEWED.accessToken, "younger-access-token"]);
  });

  it("refreshes at the auth host of the region the login was granted in", async () => {
    await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
      region: "china",
    });
    kimi.replyTo(
      `/china${TOKEN_PATH}`,
      refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }),
    );
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(refreshes().map((refresh) => refresh.path)).toEqual([`/china${TOKEN_PATH}`]);
    expect(chatCalls()).toHaveLength(1);
  });

  it("stores the rotated tokens: the next request uses them, and the next refresh sends the new refresh token", async () => {
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: SHORT_LIFETIME_SECONDS });
    kimi.replyTo(
      GLOBAL_TOKEN_PATH,
      refreshedTokensReply({ ...RENEWED, expiresIn: SHORT_LIFETIME_SECONDS }),
    );
    kimi.replyTo(
      GLOBAL_TOKEN_PATH,
      refreshedTokensReply({
        accessToken: "access-token-3",
        refreshToken: "refresh-token-3",
        expiresIn: HOUR_SECONDS,
      }),
    );
    kimi.reply(COMPLETION);
    kimi.reply(COMPLETION);
    kimi.reply(COMPLETION);

    await chat().expect(200);
    await chat().expect(200);
    await chat().expect(200);

    expect(refreshes().map((refresh) => refresh.body)).toEqual([
      expect.objectContaining({ refresh_token: REFRESH_TOKEN }),
      expect.objectContaining({ refresh_token: RENEWED.refreshToken }),
    ]);
    expect(attemptedCredentials()).toEqual([
      RENEWED.accessToken,
      "access-token-3",
      "access-token-3",
    ]);
  });

  it("refreshes once for requests that arrive together, and serves them all", async () => {
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: SHORT_LIFETIME_SECONDS });
    const slowRefreshMs = 300;
    kimi.replyTo(
      GLOBAL_TOKEN_PATH,
      refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }, slowRefreshMs),
    );
    kimi.reply(COMPLETION);
    kimi.reply(COMPLETION);
    kimi.reply(COMPLETION);
    kimi.reply(COMPLETION);

    const responses = await Promise.all([chat(), chat(), chat(), chat()]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(refreshes()).toHaveLength(1);
    expect(attemptedCredentials()).toEqual(Array(4).fill(RENEWED.accessToken));
  });

  it("retries a refresh the auth host fails to answer, without disabling the account", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, UNAVAILABLE);
    kimi.replyTo(GLOBAL_TOKEN_PATH, { kind: "reset" });
    kimi.replyTo(GLOBAL_TOKEN_PATH, refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }));
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(refreshes()).toHaveLength(3);
    expect(attemptedCredentials()).toEqual([RENEWED.accessToken]);
    expect(await listedAccount(accountId)).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it("keeps serving with a login that still works while the auth host is down", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
      ageSeconds: HOUR_SECONDS / 2 + 60,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, UNAVAILABLE);
    kimi.replyTo(GLOBAL_TOKEN_PATH, UNAVAILABLE);
    kimi.replyTo(GLOBAL_TOKEN_PATH, UNAVAILABLE);
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(attemptedCredentials()).toEqual([ACCESS_TOKEN]);
    expect(await listedAccount(accountId)).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it("falls back, leaving the account enabled, when an expired login can't be refreshed for now", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
      ageSeconds: 2 * SHORT_LIFETIME_SECONDS,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, UNAVAILABLE);
    kimi.replyTo(GLOBAL_TOKEN_PATH, UNAVAILABLE);
    kimi.replyTo(GLOBAL_TOKEN_PATH, UNAVAILABLE);
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(attemptedCredentials()).toEqual([UPSTREAM_KEY]);
    expect(await listedAccount(accountId)).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it("disables the account with a sign-in-again reason when the auth host refuses the refresh", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, INVALID_GRANT);
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(refreshes()).toHaveLength(1);
    expect(attemptedCredentials()).toEqual([UPSTREAM_KEY]);
    expect(kimi.lastRequest.headers).not.toHaveProperty("x-msh-platform");
    await vi.waitFor(async () =>
      expect(await listedAccount(accountId)).toMatchObject({
        credentialKind: "oauth-login",
        isEnabled: false,
        disabledReason: expect.stringMatching(/^Sign in again/),
      }),
    );
  });

  it.each([401, 403])(
    "disables the account when the auth host answers a refresh with %i",
    async (status) => {
      const accountId = await addOauthLoginAccount(app, db, providerId, {
        lifetimeSeconds: SHORT_LIFETIME_SECONDS,
      });
      kimi.replyTo(GLOBAL_TOKEN_PATH, { kind: "json", status, body: {} });
      kimi.reply(COMPLETION);

      await chat().expect(200);

      await vi.waitFor(async () =>
        expect(await listedAccount(accountId)).toMatchObject({
          isEnabled: false,
          disabledReason: expect.stringMatching(/^Sign in again/),
        }),
      );
    },
  );

  it("refreshes once and tries again when Kimi answers an Attempt with 401", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
    });
    kimi.reply(UNAUTHORIZED);
    kimi.replyTo(GLOBAL_TOKEN_PATH, refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }));
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(refreshes()).toHaveLength(1);
    expect(attemptedCredentials()).toEqual([ACCESS_TOKEN, RENEWED.accessToken]);
    expect(await listedAccount(accountId)).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it("disables the account when Kimi answers 401 to the refreshed login too", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
    });
    kimi.reply(UNAUTHORIZED);
    kimi.replyTo(GLOBAL_TOKEN_PATH, refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }));
    kimi.reply(UNAUTHORIZED);
    kimi.reply(COMPLETION);

    await chat().expect(200);

    expect(refreshes()).toHaveLength(1);
    expect(attemptedCredentials()).toEqual([ACCESS_TOKEN, RENEWED.accessToken, UPSTREAM_KEY]);
    await vi.waitFor(async () =>
      expect(await listedAccount(accountId)).toMatchObject({
        isEnabled: false,
        disabledReason: expect.stringMatching(/^Sign in again/),
      }),
    );
  });
});
