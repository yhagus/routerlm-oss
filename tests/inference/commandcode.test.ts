import { readFileSync } from "node:fs";
import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog";
import type { CatalogProviderQuirks } from "@/catalog/schemas/catalog.schema";
import type { Database } from "@/db/schemas/relations";
import { type FakeReply, FakeUpstream } from "@tests/support/fake-upstream";
import {
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from "@tests/support/inference";
import { createTestApp } from "@tests/support/test-app";
import { deleteAllUpstreamData } from "@tests/support/upstream";

const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const GATEWAY_VERSION: unknown = JSON.parse(readFileSync("./package.json", "utf8")).version;

const COMPLETION: FakeReply = {
  kind: "json",
  status: 200,
  body: {
    id: "chatcmpl-1",
    object: "chat.completion",
    model: "upstream-model",
    choices: [
      { index: 0, message: { role: "assistant", content: "Hello." }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  },
};

describe("Inference from Command Code (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    const { providerId } = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
    });
    await setProviderQuirks(app, db, providerId, await catalogQuirks());
    ({ key: apiKey } = await insertApiKey(app, db));
    upstream.reply(COMPLETION);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function catalogQuirks(): Promise<CatalogProviderQuirks> {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "commandcode");
    if (!provider) throw new Error("the Catalog has no Command Code Provider");
    return provider.quirks;
  }

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`);
  }

  it("sends the gateway's own identity and the client's headers stay behind", async () => {
    await chat()
      .set("User-Agent", "opencode/1.14.0")
      .set("x-opencode-session", "ses_42")
      .send(TEXT_REQUEST)
      .expect(200);

    const { headers } = upstream.lastRequest;
    expect(headers["user-agent"]).toBe(`routerlm/${String(GATEWAY_VERSION)}`);
    expect(headers).not.toHaveProperty("x-opencode-session");
    expect(headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
  });
});
