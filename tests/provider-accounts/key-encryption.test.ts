import { randomBytes } from "node:crypto";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { FakeUpstream, openAiChatFixture } from "../support/fake-upstream.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };
// 24 bytes, so every bit of the ciphertext's last base64 character is significant.
const PROVIDER_ACCOUNT_KEY = "sk-live-0123456789abcdef";
const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };

describe("Provider Account keys at rest (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const provider = await request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({
        slug: "acme",
        name: "Acme AI",
        protocol: "openai-chat",
        baseUrl: upstream.baseUrl,
        authStyle: "bearer",
      })
      .expect(201);
    providerId = provider.body.id;
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function createAccount(): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/provider-accounts")
      .set("Cookie", cookie)
      .send({ providerId, name: "Production", key: PROVIDER_ACCOUNT_KEY })
      .expect(201);
    return created.body.id;
  }

  async function storedKeyOf(providerAccountId: string): Promise<string> {
    const [stored] = await db
      .select({ encryptedKey: providerAccounts.encryptedKey })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    return stored.encryptedKey ?? "";
  }

  /** A Model "smart" with one Route to the Provider, and an API Key for it, all made from the dashboard. */
  async function serveModelAndIssueApiKey(): Promise<string> {
    const server = app.getHttpServer();
    const upstreamModel = await request(server)
      .post("/api/upstream-models")
      .set("Cookie", cookie)
      .send({
        providerId,
        upstreamModelId: "acme-large",
        capabilities: [],
        contextSize: 128_000,
        maxOutputTokens: null,
        inputPrice: null,
        outputPrice: null,
        cacheReadPrice: null,
        cacheWritePrice: null,
      })
      .expect(201);
    const model = await request(server)
      .post("/api/models")
      .set("Cookie", cookie)
      .send({ name: "smart" })
      .expect(201);
    await request(server)
      .post(`/api/models/${model.body.id}/routes`)
      .set("Cookie", cookie)
      .send({ upstreamModelId: upstreamModel.body.id })
      .expect(201);
    const apiKey = await request(server)
      .post("/api/api-keys")
      .set("Cookie", cookie)
      .send({ name: "client" })
      .expect(201);
    return apiKey.body.key;
  }

  function chat(apiKey: string) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  /** Replaces the Provider Account's stored key, as a corrupted or foreign row would. */
  async function overwriteStoredKey(
    providerAccountId: string,
    encryptedKey: string,
  ): Promise<void> {
    await db
      .update(providerAccounts)
      .set({ encryptedKey })
      .where(eq(providerAccounts.id, providerAccountId));
    await app.get(SnapshotService).changed();
  }

  it("sends the upstream the key the operator entered, though it is stored encrypted", async () => {
    const providerAccountId = await createAccount();
    const apiKey = await serveModelAndIssueApiKey();
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await chat(apiKey).expect(200);

    expect(upstream.lastRequest.headers.authorization).toBe(`Bearer ${PROVIDER_ACCOUNT_KEY}`);
    expect(await storedKeyOf(providerAccountId)).not.toContain(PROVIDER_ACCOUNT_KEY);
  });

  it("stores the same key differently for each Provider Account", async () => {
    const first = await createAccount();
    const second = await createAccount();

    expect(await storedKeyOf(first)).not.toBe(await storedKeyOf(second));
  });

  it("calls no upstream with a stored key that was tampered with", async () => {
    const providerAccountId = await createAccount();
    const apiKey = await serveModelAndIssueApiKey();
    const encryptedKey = await storedKeyOf(providerAccountId);
    const differentLastCharacter = encryptedKey.at(-1) === "A" ? "B" : "A";
    await overwriteStoredKey(providerAccountId, encryptedKey.slice(0, -1) + differentLastCharacter);

    await chat(apiKey).expect(500);

    expect(upstream.requests).toEqual([]);
  });

  it("calls no upstream with a key stored under another ENCRYPTION_KEY", async () => {
    const providerAccountId = await createAccount();
    const apiKey = await serveModelAndIssueApiKey();
    const otherGateway = new ProviderKeyCipher(randomBytes(32).toString("base64"));
    await overwriteStoredKey(providerAccountId, otherGateway.encrypt(PROVIDER_ACCOUNT_KEY));

    await chat(apiKey).expect(500);

    expect(upstream.requests).toEqual([]);
  });
});
