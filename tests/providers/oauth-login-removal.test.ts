import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { addProviderAccount, UPSTREAM_KEY } from "../support/inference.js";
import { addOauthLoginAccount } from "../support/kimi-oauth.js";
import { createTestApp, setUpFirstUser } from "../support/test-app.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

const OPERATOR = { email: "ops@example.com", password: "ops password" };
const HOUR_SECONDS = 3600;

const OAUTH_LOGIN = {
  flow: "kimi-code",
  authHosts: { global: "https://auth.acme.example", china: "https://auth.acme.example.cn" },
  clientId: "acme-cli",
  cliVersion: "1.0.0",
};

const ACME = {
  slug: "acme",
  name: "Acme AI",
  protocol: "openai-chat",
  baseUrl: "https://api.acme.example/v1",
  authStyle: "bearer",
  oauthLogin: OAUTH_LOGIN,
};

describe("Removing a Provider's OAuth Login (e2e)", () => {
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
    const created = await request(app.getHttpServer())
      .post("/api/providers")
      .set("Cookie", cookie)
      .send(ACME)
      .expect(201);
    providerId = created.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function updateProvider(changes: object) {
    return request(app.getHttpServer())
      .patch(`/api/providers/${providerId}`)
      .set("Cookie", cookie)
      .send(changes);
  }

  it("refuses while Provider Accounts sign in with OAuth, disabled ones included", async () => {
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: HOUR_SECONDS });
    const disabledAccountId = await addOauthLoginAccount(app, db, providerId, {
      lifetimeSeconds: HOUR_SECONDS,
    });
    await db
      .update(providerAccounts)
      .set({ isEnabled: false })
      .where(eq(providerAccounts.id, disabledAccountId));

    const refused = await updateProvider({ oauthLogin: null }).expect(409);

    expect(refused.body.message).toContain("2 Provider Accounts sign in with OAuth");
  });

  it("removes it when every Provider Account holds an API key", async () => {
    await addProviderAccount(app, db, providerId, { key: UPSTREAM_KEY, priority: 0 });

    const updated = await updateProvider({ oauthLogin: null }).expect(200);

    expect(updated.body.oauthLogin).toBeNull();
  });

  it("still takes a new CLI version while OAuth Login accounts exist", async () => {
    await addOauthLoginAccount(app, db, providerId, { lifetimeSeconds: HOUR_SECONDS });

    const updated = await updateProvider({
      oauthLogin: { ...OAUTH_LOGIN, cliVersion: "1.1.0" },
    }).expect(200);

    expect(updated.body.oauthLogin.cliVersion).toBe("1.1.0");
  });
});
