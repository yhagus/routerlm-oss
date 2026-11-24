import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { type FakeReply, FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import {
  addOpenAiChatRoute,
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  UPSTREAM_KEY,
} from "@tests/support/inference.js";
import { LOCAL_COPY_MAX_AGE_MS } from "@/upstream/providers/cooldown-store.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { createTestApp, setUpFirstUser } from "@tests/support/test-app.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";
import { endCooldownElsewhere, startCooldownElsewhere } from "@tests/support/redis-state.js";

const BACKUP_KEY = "sk-backup-secret-9876543210";
const TEXT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const FAST_TIMEOUTS = { connectTimeoutMs: 300, firstTokenTimeoutMs: 300, totalTimeoutMs: 600 };

const SUCCESS: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
};
const STREAM_SUCCESS: FakeReply = {
  kind: "stream",
  events: openAiChatFixture("upstream-stream-tool-call.sse"),
};
const RATE_LIMITED: FakeReply = { kind: "json", status: 429, body: { error: "slow down" } };
const FORBIDDEN: FakeReply = { kind: "json", status: 403, body: { error: "forbidden" } };
const SERVER_ERROR: FakeReply = { kind: "json", status: 503, body: { error: "overloaded" } };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Fallback (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let modelId: string;
  let providerId: string;
  let primaryAccountId: string;
  let backupAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    const inserted = await insertOpenAiChatModel(app, db, {
      modelName: "smart",
      baseUrl: upstream.baseUrl,
      ...FAST_TIMEOUTS,
    });
    ({ modelId, providerId, providerAccountId: primaryAccountId } = inserted);
    backupAccountId = await addProviderAccount(app, db, providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function chat(body: object = TEXT_REQUEST) {
    return request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${apiKey}`)
      .send(body);
  }

  function attemptedKeys(): string[] {
    return upstream.requests.map((received) =>
      String(received.headers.authorization).replace("Bearer ", ""),
    );
  }

  it.each<[string, FakeReply]>([
    ["429 without Retry-After", RATE_LIMITED],
    ["429 with Retry-After", { ...RATE_LIMITED, headers: { "retry-after": "120" } }],
    ["5xx", SERVER_ERROR],
    ["upstream that never answers", { kind: "hang" }],
    ["total timeout", { kind: "headers-only" }],
    ["connection reset", { kind: "reset" }],
  ])("falls back to the next Provider Account after a %s", async (_failure, failedReply) => {
    upstream.reply(failedReply);
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
  });

  it("waits past the connect timeout for a non-stream answer that arrives within the total timeout", async () => {
    upstream.reply({ ...SUCCESS, delayMs: FAST_TIMEOUTS.connectTimeoutMs + 100 });

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it.each<[string, FakeReply]>([
    ["5xx", SERVER_ERROR],
    ["429", RATE_LIMITED],
  ])(
    "falls back to the next Provider Account when a stream request gets a %s",
    async (_failure, failedReply) => {
      upstream.reply(failedReply);
      upstream.reply(STREAM_SUCCESS);

      const response = await chat({ ...TEXT_REQUEST, stream: true }).expect(200);

      expect(response.text).toContain("data: [DONE]");
      expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
    },
  );

  it("falls back to the next Provider Account when a stream sends no first token in time", async () => {
    upstream.reply({ kind: "headers-only" });
    upstream.reply(STREAM_SUCCESS);

    const response = await chat({ ...TEXT_REQUEST, stream: true }).expect(200);

    expect(response.text).toContain("data: [DONE]");
    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
  });

  it("skips a Provider Account in Cooldown, and the dashboard shows its Cooldown and last error", async () => {
    upstream.reply({ ...RATE_LIMITED, headers: { "retry-after": "120" } });
    upstream.reply(SUCCESS);
    upstream.reply(SUCCESS);

    await chat().expect(200);
    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY, BACKUP_KEY]);
    const cookie = await setUpFirstUser(app, {
      email: "ops@example.com",
      password: "ops password",
    });
    await vi.waitFor(async () => {
      const listed = await request(app.getHttpServer())
        .get("/api/provider-accounts")
        .set("Cookie", cookie)
        .expect(200);
      const primary = listed.body.find(
        (account: { id: string }) => account.id === primaryAccountId,
      );
      const secondsLeft = (Date.parse(primary.cooldownEndsAt) - Date.now()) / 1000;
      expect(secondsLeft).toBeGreaterThan(100);
      expect(secondsLeft).toBeLessThanOrEqual(120);
      expect(primary.lastError).toContain("rate_limited");
    });
  });

  it("skips a Provider Account that another process put in Cooldown within a second", async () => {
    upstream.reply(SUCCESS);
    upstream.reply(SUCCESS);
    await chat().expect(200);
    const endsAt = Date.now() + 60_000;

    await startCooldownElsewhere(app, primaryAccountId, endsAt);
    await sleep(LOCAL_COPY_MAX_AGE_MS);
    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
  });

  it("disables the Provider Account with a reason on 401, until an operator re-enables it", async () => {
    upstream.reply({ kind: "json", status: 401, body: { error: "bad key" } });
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
    await vi.waitFor(async () => {
      const primary = await primaryAccount();
      expect(primary.isEnabled).toBe(false);
      expect(primary.disabledReason).toContain("401");
    });
  });

  it("starts a Cooldown on one 403 and falls back, leaving the Provider Account enabled", async () => {
    upstream.reply(FORBIDDEN);
    upstream.reply(SUCCESS);
    upstream.reply(SUCCESS);

    await chat().expect(200);
    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY, BACKUP_KEY]);
    await vi.waitFor(async () => {
      const primary = await primaryAccount();
      expect(primary.lastError).toContain("unauthorized");
    });
    expect((await primaryAccount()).isEnabled).toBe(true);
  });

  it("disables the Provider Account on the third consecutive 403, naming repeated refusals", async () => {
    for (let refusal = 1; refusal <= 3; refusal++) {
      upstream.reply(FORBIDDEN);
      upstream.reply(SUCCESS);
      await chat().expect(200);
      await endCooldown(primaryAccountId);
    }

    await vi.waitFor(async () => {
      const primary = await primaryAccount();
      expect(primary.isEnabled).toBe(false);
      expect(primary.disabledReason).toContain("repeated refusals");
    });
  });

  it("counts 403s from zero again after an operator re-enables a Provider Account that 403s disabled", async () => {
    for (let refusal = 1; refusal <= 3; refusal++) {
      upstream.reply(FORBIDDEN);
      upstream.reply(SUCCESS);
      await chat().expect(200);
      await endCooldown(primaryAccountId);
    }
    await vi.waitFor(async () => {
      expect((await primaryAccount()).isEnabled).toBe(false);
    });
    await db
      .update(providerAccounts)
      .set({ isEnabled: true })
      .where(eq(providerAccounts.id, primaryAccountId));
    await app.get(SnapshotService).changed();

    upstream.reply(FORBIDDEN);
    upstream.reply(SUCCESS);
    await chat().expect(200);

    await vi.waitFor(async () => {
      expect((await primaryAccount()).lastError).toContain("unauthorized");
    });
    expect((await primaryAccount()).isEnabled).toBe(true);
  });

  it("counts 403s from zero again after a successful Attempt", async () => {
    upstream.reply(FORBIDDEN);
    upstream.reply(SUCCESS);
    await chat().expect(200);
    await endCooldown(primaryAccountId);
    upstream.reply(SUCCESS);
    await chat().expect(200);
    for (let refusal = 1; refusal <= 2; refusal++) {
      upstream.reply(FORBIDDEN);
      upstream.reply(SUCCESS);
      await chat().expect(200);
      await endCooldown(primaryAccountId);
    }

    await vi.waitFor(async () => {
      expect((await primaryAccount()).lastError).toContain("unauthorized");
    });
    expect((await primaryAccount()).isEnabled).toBe(true);
  });

  it("ends the request with invalid_request on another 4xx, without another Attempt", async () => {
    upstream.reply({ kind: "json", status: 422, body: { error: "bad schema" } });
    upstream.reply(SUCCESS);

    const response = await chat().expect(400);

    expect(response.body.error.code).toBe("invalid_request");
    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it("moves to the next Route once every Provider Account of the first one failed", async () => {
    await addOpenAiChatRoute(app, db, modelId, {
      baseUrl: upstream.baseUrl,
      providerSlug: "acme-second-route",
      priority: 1,
    });
    upstream.reply(SERVER_ERROR);
    upstream.reply(SERVER_ERROR);
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY, UPSTREAM_KEY]);
  });

  it.each<[string, FakeReply, FakeReply, number, string]>([
    ["all rate limited", RATE_LIMITED, RATE_LIMITED, 429, "upstream_rate_limited"],
    ["all timed out", { kind: "hang" }, { kind: "headers-only" }, 504, "upstream_timeout"],
    ["failed in different ways", RATE_LIMITED, SERVER_ERROR, 502, "upstream_error"],
  ])(
    "answers the exhausted request when the Attempts %s",
    async (_case, first, second, status, code) => {
      upstream.reply(first);
      upstream.reply(second);

      const response = await chat().expect(status);

      expect(response.body.error.code).toBe(code);
    },
  );

  it.each<[string, FakeReply, FakeReply, number, string]>([
    ["rate limits", RATE_LIMITED, RATE_LIMITED, 429, "upstream_rate_limited"],
    ["server errors", SERVER_ERROR, SERVER_ERROR, 502, "upstream_error"],
    ["a rate limit and a server error", RATE_LIMITED, SERVER_ERROR, 502, "upstream_error"],
  ])(
    "answers without an Attempt when every Provider Account is in Cooldown after %s",
    async (_causes, first, second, status, code) => {
      upstream.reply(first);
      upstream.reply(second);
      await chat().expect(status);

      const response = await chat().expect(status);

      expect(response.body.error.code).toBe(code);
      expect(upstream.requests).toHaveLength(2);
    },
  );

  async function primaryAccount() {
    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, primaryAccountId));
    return account;
  }

  async function endCooldown(providerAccountId: string): Promise<void> {
    await endCooldownElsewhere(app, providerAccountId);
    await sleep(LOCAL_COPY_MAX_AGE_MS);
  }

  async function disableProviderAccount(providerAccountId: string): Promise<void> {
    await db
      .update(providerAccounts)
      .set({ isEnabled: false })
      .where(eq(providerAccounts.id, providerAccountId));
    await app.get(SnapshotService).changed();
  }

  it("skips a disabled Provider Account", async () => {
    await disableProviderAccount(primaryAccountId);
    upstream.reply(SUCCESS);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([BACKUP_KEY]);
  });

  it("answers 502 upstream_error when no Provider Account could be tried", async () => {
    await disableProviderAccount(primaryAccountId);
    await disableProviderAccount(backupAccountId);

    const response = await chat().expect(502);

    expect(response.body.error.code).toBe("upstream_error");
    expect(upstream.requests).toHaveLength(0);
  });

  async function addProviderAccountsUpTo(total: number): Promise<void> {
    for (let priority = 2; priority < total; priority += 1) {
      await addProviderAccount(app, db, providerId, { key: `${BACKUP_KEY}-${priority}`, priority });
    }
  }

  function queueReplies(reply: FakeReply, count: number): void {
    for (let attempt = 0; attempt < count; attempt += 1) {
      upstream.reply(reply);
    }
  }

  it("makes at most 5 Attempts per request", async () => {
    await addProviderAccountsUpTo(6);
    queueReplies(SERVER_ERROR, 6);

    await chat().expect(502);

    expect(upstream.requests).toHaveLength(5);
  });

  it("ends a stream that breaks after its first chunk with an error event, without Fallback", async () => {
    const firstChunk = openAiChatFixture("upstream-stream-tool-call.sse").split("\n\n")[0] + "\n\n";
    upstream.reply({ kind: "stream-then-reset", events: firstChunk });
    upstream.reply(STREAM_SUCCESS);

    const response = await chat({ ...TEXT_REQUEST, stream: true }).expect(200);

    expect(response.text.trim().split("\n\n").at(-1)).toContain('"code":"upstream_error"');
    expect(response.text).not.toContain("[DONE]");
    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it("ends a /v1/messages stream that breaks after its first chunk with an Anthropic error event, without Fallback", async () => {
    const firstChunk = openAiChatFixture("upstream-stream-tool-call.sse").split("\n\n")[0] + "\n\n";
    upstream.reply({ kind: "stream-then-reset", events: firstChunk });
    upstream.reply(STREAM_SUCCESS);

    const response = await request(app.getHttpServer())
      .post("/v1/messages")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ ...TEXT_REQUEST, max_tokens: 64, stream: true })
      .expect(200);

    expect(response.text.trim().split("\n\n").at(-1)).toMatch(
      /^event: error\ndata: \{"type":"error","error":\{.*"code":"upstream_error"/,
    );
    expect(response.text).not.toContain("message_stop");
    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });

  it("ends a /v1/responses stream that breaks after its first chunk with an error event, without Fallback", async () => {
    const firstChunk = openAiChatFixture("upstream-stream-tool-call.sse").split("\n\n")[0] + "\n\n";
    upstream.reply({ kind: "stream-then-reset", events: firstChunk });
    upstream.reply(STREAM_SUCCESS);

    const response = await request(app.getHttpServer())
      .post("/v1/responses")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ model: "smart", input: "Hi", stream: true })
      .expect(200);

    expect(response.text).toContain('"delta":"Paris"');
    expect(response.text.trim().split("\n\n").at(-1)).toMatch(
      /^event: error\ndata: \{"type":"error","code":"upstream_error",/,
    );
    expect(response.text).not.toContain("response.completed");
    expect(attemptedKeys()).toEqual([UPSTREAM_KEY]);
  });
});
