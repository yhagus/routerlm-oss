import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { upstreamModels } from "@/db/schemas/index.js";
import { type FakeReply, FakeUpstream, type ReceivedRequest } from "../support/fake-upstream.js";
import { insertOpenAiChatModel, UPSTREAM_KEY } from "../support/inference.js";
import {
  ACCESS_TOKEN,
  addOauthLoginAccount,
  offerOauthLogin,
  refreshedTokensReply,
  TOKEN_PATH,
} from "../support/kimi-oauth.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const GLOBAL_TOKEN_PATH = `/global${TOKEN_PATH}`;
const HOUR_SECONDS = 3600;
/** Under the 300 seconds below which every OAuth Login is refreshed. */
const SHORT_LIFETIME_SECONDS = 60;
const RENEWED = { accessToken: "access-token-2", refreshToken: "refresh-token-2" };

const COMPLETION: FakeReply = {
  kind: "json",
  status: 200,
  body: {
    id: "chatcmpl-kimi-1",
    object: "chat.completion",
    model: "k3",
    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 1 },
  },
};
const UNAUTHORIZED: FakeReply = {
  kind: "json",
  status: 401,
  body: { error: { type: "invalid_authentication_error", message: "Token expired" } },
};
const INVALID_GRANT: FakeReply = { kind: "json", status: 400, body: { error: "invalid_grant" } };

interface ProbeResultBody {
  providerAccountId: string;
  ok: boolean;
  upstreamStatus: number | null;
  failureReason: string | null;
}

describe("Probe of an Upstream Model with an OAuth Login account (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  // Plays the Provider's API and its auth host.
  let kimi: FakeUpstream;
  let adaCookie: string;
  let providerId: string;
  let upstreamModelRowId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    kimi = await FakeUpstream.start();
  });

  beforeEach(async () => {
    kimi.reset();
    await deleteAllUpstreamData(db);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: kimi.baseUrl,
    }));
    await offerOauthLogin(db, providerId, kimi.origin);
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
    // The API key account is probed too, in parallel.
    kimi.replyWithCredential(UPSTREAM_KEY, COMPLETION);
  });

  afterAll(async () => {
    await kimi.close();
    await app.close();
  });

  async function probedAccount(providerAccountId: string): Promise<ProbeResultBody | undefined> {
    const response = await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/probe`)
      .set("Cookie", adaCookie)
      .expect(200);
    return response.body.results.find(
      (result: ProbeResultBody) => result.providerAccountId === providerAccountId,
    );
  }

  async function listedAccount(providerAccountId: string): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get("/api/provider-accounts")
      .set("Cookie", adaCookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === providerAccountId);
  }

  function refreshes(): ReceivedRequest[] {
    return kimi.requests.filter((received) => received.path.endsWith(TOKEN_PATH));
  }

  it("refreshes a login the upstream answers with 401 and tries once more", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
    });
    kimi.replyWithCredential(ACCESS_TOKEN, UNAUTHORIZED);
    kimi.replyTo(GLOBAL_TOKEN_PATH, refreshedTokensReply({ ...RENEWED, expiresIn: HOUR_SECONDS }));
    kimi.replyWithCredential(RENEWED.accessToken, COMPLETION);

    const result = await probedAccount(accountId);

    expect(result).toMatchObject({ ok: true, upstreamStatus: 200, failureReason: null });
    expect(refreshes()).toHaveLength(1);
  });

  it("reports a login the auth host refuses to refresh as failed, and leaves the account enabled", async () => {
    const accountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: SHORT_LIFETIME_SECONDS,
    });
    kimi.replyTo(GLOBAL_TOKEN_PATH, INVALID_GRANT);

    const result = await probedAccount(accountId);

    expect(result).toMatchObject({ ok: false, failureReason: "unauthorized" });
    expect(refreshes()).toHaveLength(1);
    expect(await listedAccount(accountId)).toMatchObject({ isEnabled: true, disabledReason: null });
  });
});
