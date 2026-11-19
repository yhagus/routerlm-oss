import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { CONSTELLATIONS } from "@/upstream/models/constellation-name.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const PROVIDER_ACCOUNT_KEY = "sk-acme-0123456789abcdefWXYZ";
const ROTATED_KEY = "sk-acme-rotated-9876543210LMNO";

describe("Provider Accounts (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const provider = await request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", cookie)
      .send({
        slug: "acme",
        name: "Acme AI",
        endpoints: [
          { kind: "chat", protocol: "openai-chat", baseUrl: "https://api.acme.example/v1" },
        ],
        authStyle: "bearer",
      })
      .expect(201);
    providerId = provider.body.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function createAccount(): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/api/provider-accounts")
      .set("Cookie", cookie)
      .send({ providerId, name: "Production", key: PROVIDER_ACCOUNT_KEY, priority: 1 })
      .expect(201);
    return created.body.id;
  }

  it("stores the key as ciphertext and never returns or logs it", async () => {
    const server = app.getHttpServer();
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");

    const created = await request(server)
      .post("/api/provider-accounts")
      .set("Cookie", cookie)
      .send({ providerId, name: "Production", key: PROVIDER_ACCOUNT_KEY, priority: 1 })
      .expect(201);
    const list = await request(server)
      .get("/api/provider-accounts")
      .set("Cookie", cookie)
      .expect(200);
    const rotated = await request(server)
      .patch(`/api/provider-accounts/${created.body.id}`)
      .set("Cookie", cookie)
      .send({ key: ROTATED_KEY })
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({
        providerId,
        name: "Production",
        credentialKind: "api-key",
        keyLastFour: "WXYZ",
        priority: 1,
        isEnabled: true,
        disabledReason: null,
        lastError: null,
        lastErrorAt: null,
      }),
    ]);
    expect(rotated.body.keyLastFour).toBe("LMNO");
    expect(list.body[0]).not.toHaveProperty("encryptedKey");
    const responseText = [created.text, list.text, rotated.text].join("\n");
    expect(responseText).not.toContain(PROVIDER_ACCOUNT_KEY);
    expect(responseText).not.toContain(ROTATED_KEY);
    const loggedText = [...stdout.mock.calls, ...stderr.mock.calls].map(String).join("\n");
    expect(loggedText).not.toContain(PROVIDER_ACCOUNT_KEY);
    expect(loggedText).not.toContain(ROTATED_KEY);
    const [stored] = await db
      .select({ encryptedKey: providerAccounts.encryptedKey })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, created.body.id));
    expect(stored.encryptedKey).not.toContain(ROTATED_KEY);
    expect(app.get(ProviderKeyCipher).decrypt(stored.encryptedKey ?? "")).toBe(ROTATED_KEY);
  });

  it("re-enabling a Provider Account the gateway disabled clears the disabled reason", async () => {
    const id = await createAccount();
    await db
      .update(providerAccounts)
      .set({ isEnabled: false, disabledReason: "Upstream answered 401" })
      .where(eq(providerAccounts.id, id));

    const updated = await request(app.getHttpServer())
      .patch(`/api/provider-accounts/${id}`)
      .set("Cookie", cookie)
      .send({ isEnabled: true })
      .expect(200);

    expect(updated.body).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it("lets the operator keep a Provider Account serving while Exhausted", async () => {
    const id = await createAccount();

    const updated = await request(app.getHttpServer())
      .patch(`/api/provider-accounts/${id}`)
      .set("Cookie", cookie)
      .send({ continueWhenExhausted: true })
      .expect(200);

    expect(updated.body).toMatchObject({ continueWhenExhausted: true });
  });

  it("names a Provider Account after two constellations when no name is given", async () => {
    const server = app.getHttpServer();
    const createWithName = (name?: string) =>
      request(server)
        .post("/api/provider-accounts")
        .set("Cookie", cookie)
        .send({ providerId, name, key: PROVIDER_ACCOUNT_KEY })
        .expect(201);

    const unnamed = await createWithName(undefined);
    const blank = await createWithName("  ");
    const named = await createWithName("Production");

    const [first, second, ...rest] = unnamed.body.name.split(" ");
    expect(rest).toEqual([]);
    expect(CONSTELLATIONS).toContain(first);
    expect(CONSTELLATIONS).toContain(second);
    expect(first).not.toBe(second);
    expect(blank.body.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(named.body.name).toBe("Production");
  });

  it("refuses to rename a Provider Account to a blank name", async () => {
    const id = await createAccount();

    await request(app.getHttpServer())
      .patch(`/api/provider-accounts/${id}`)
      .set("Cookie", cookie)
      .send({ name: "" })
      .expect(400);
  });

  it("refuses a Provider that doesn't exist", async () => {
    await request(app.getHttpServer())
      .post("/api/provider-accounts")
      .set("Cookie", cookie)
      .send({
        providerId: "00000000-0000-4000-8000-000000000000",
        name: "Orphan",
        key: PROVIDER_ACCOUNT_KEY,
      })
      .expect(404);
  });

  it("refuses an API key for a Provider that accepts only OAuth Login", async () => {
    const server = app.getHttpServer();
    await request(server)
      .patch(`/api/providers/${providerId}`)
      .set("Cookie", cookie)
      .send({ credentialKinds: ["oauth-login"] })
      .expect(200);

    const refused = await request(server)
      .post("/api/provider-accounts")
      .set("Cookie", cookie)
      .send({ providerId, name: "Production", key: PROVIDER_ACCOUNT_KEY })
      .expect(409);

    expect(refused.body.message).toContain("OAuth Login");
    const list = await request(server).get("/api/provider-accounts").set("Cookie", cookie);
    expect(list.body).toEqual([]);
  });

  it("deletes a Provider Account", async () => {
    const server = app.getHttpServer();
    const id = await createAccount();

    await request(server).delete(`/api/provider-accounts/${id}`).set("Cookie", cookie).expect(204);

    const list = await request(server)
      .get("/api/provider-accounts")
      .set("Cookie", cookie)
      .expect(200);
    expect(list.body).toEqual([]);
  });
});
