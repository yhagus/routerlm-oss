import { readFileSync } from "node:fs";
import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { CATALOG_DIRECTORY, loadCatalog } from "@/catalog/models/load-catalog.js";
import type { CatalogProviderQuirks } from "@/catalog/schemas/catalog.schema.js";
import type { Database } from "@/db/schemas/relations.js";
import { type FakeReply, FakeUpstream } from "../support/fake-upstream.js";
import {
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from "../support/inference.js";
import { createTestApp } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

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

describe("Inference from OpenCode Go (e2e)", () => {
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
    const provider = catalog.find((entry) => entry.slug === "opencode-go");
    if (!provider) throw new Error("the Catalog has no OpenCode Go Provider");
    return provider.quirks;
  }

  function chat() {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`);
  }

  it("forwards the user agent and session the client sent, not the client's credential", async () => {
    await chat()
      .set("User-Agent", "opencode/1.14.0")
      .set("x-opencode-session", "ses_42")
      .send(TEXT_REQUEST)
      .expect(200);

    const { headers } = upstream.lastRequest;
    expect(headers["user-agent"]).toBe("opencode/1.14.0");
    expect(headers["x-opencode-session"]).toBe("ses_42");
    expect(headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
  });

  it("sends no session header when the client sent none, and keeps the gateway's user agent", async () => {
    await chat().set("User-Agent", "").send(TEXT_REQUEST).expect(200);

    const { headers } = upstream.lastRequest;
    expect(headers).not.toHaveProperty("x-opencode-session");
    expect(headers["user-agent"]).toBe(`routerlm/${String(GATEWAY_VERSION)}`);
  });

  it("forwards no header the quirk doesn't name", async () => {
    await chat().set("x-request-source", "ci").send(TEXT_REQUEST).expect(200);

    expect(upstream.lastRequest.headers).not.toHaveProperty("x-request-source");
  });
});
