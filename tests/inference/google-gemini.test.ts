import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import type { Database } from "@/db/schemas/relations.js";
import { type FakeReply, FakeUpstream } from "@tests/support/fake-upstream.js";
import {
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from "@tests/support/inference.js";
import { createTestApp } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };

const COMPLETION: FakeReply = {
  kind: "json",
  status: 200,
  body: {
    id: "chatcmpl-1",
    object: "chat.completion",
    model: "gemini-3.8-flash",
    choices: [
      { index: 0, message: { role: "assistant", content: "Hello." }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  },
};

describe("Inference from Google Gemini (e2e)", () => {
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

  async function catalogQuirks() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === "google-gemini");
    if (!provider) throw new Error("the Catalog has no Google Gemini Provider");
    return provider.quirks;
  }

  it("answers a chat completion with the Provider's bearer key and the plain max_tokens limit", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ ...TEXT_REQUEST, max_tokens: 64 })
      .expect(200);

    const { headers, body } = upstream.lastRequest;
    expect(response.body.choices[0].message.content).toBe("Hello.");
    expect(headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(body).toMatchObject({ max_tokens: 64 });
    expect(body).not.toHaveProperty("max_completion_tokens");
  });
});
