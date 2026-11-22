import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import { type CatalogProvider, chatEndpointOf } from "@/catalog/schemas/catalog.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { type FakeReply, FakeUpstream } from "@tests/support/fake-upstream.js";
import {
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from "@tests/support/inference.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const BACKUP_KEY = "sk-backup-secret-9876543210";
const OPERATOR = { email: "ops@example.com", password: "ops password" };
const TEXT_REQUEST = {
  model: "smart",
  messages: [{ role: "user", content: "Hi" }],
};

const COMPLETION: FakeReply = {
  kind: "json",
  status: 200,
  body: {
    id: "chatcmpl-1",
    object: "chat.completion",
    model: "glm-5.3",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  },
};

/** Z.ai's answer once a Coding Plan's usage limit is used up: the code is a string. */
const USAGE_LIMIT_REACHED: FakeReply = {
  kind: "json",
  status: 429,
  body: { error: { code: "1308", message: "Usage limit reached for 5 hour." } },
};

/** Z.ai's answer to too many concurrent requests: a rate limit, not a used-up plan. */
const RATE_LIMITED: FakeReply = {
  kind: "json",
  status: 429,
  body: {
    error: { code: "1302", message: "High concurrency usage of this API." },
  },
};

describe("Inference from the Z.ai GLM Coding Plan (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let codingPlan: CatalogProvider;
  let apiKey: string;
  let cookie: string;
  let primaryAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "zai-coding-plan");
    if (!provider) throw new Error("the Catalog has no Z.ai GLM Coding Plan Provider");
    codingPlan = provider;
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const inserted = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: `${upstream.origin}${codingBasePath()}`,
    });
    primaryAccountId = inserted.providerAccountId;
    await setProviderQuirks(app, db, inserted.providerId, codingPlan.quirks);
    await addProviderAccount(app, db, inserted.providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  /** The path of the Coding Plan's base URL, served by the fake upstream's origin. */
  function codingBasePath(): string {
    const endpoint = chatEndpointOf(codingPlan.endpoints);
    if (!endpoint) throw new Error("the Z.ai GLM Coding Plan has no chat endpoint");
    return new URL(endpoint.baseUrl).pathname;
  }

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  async function listedPrimaryAccount(): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get("/api/provider-accounts")
      .set("Cookie", cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === primaryAccountId);
  }

  it("sends a chat request to the coding base path with the account's key as a Bearer token", async () => {
    upstream.reply(COMPLETION);

    await chat().expect(200);

    expect(upstream.lastRequest.path).toBe("/api/coding/paas/v4/chat/completions");
    expect(upstream.lastRequest.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
  });

  it("marks the account Exhausted when Z.ai says its usage limit is reached", async () => {
    upstream.reply(USAGE_LIMIT_REACHED);
    upstream.reply(COMPLETION);

    await chat().expect(200);

    expect(await listedPrimaryAccount()).toMatchObject({
      cooldownCause: "exhausted",
    });
  });

  it("puts the account in a Cooldown when Z.ai rate-limits it", async () => {
    upstream.reply(RATE_LIMITED);
    upstream.reply(COMPLETION);

    await chat().expect(200);

    expect(await listedPrimaryAccount()).toMatchObject({
      cooldownCause: "rate_limited",
    });
  });
});
