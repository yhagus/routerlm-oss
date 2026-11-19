import { getQueueToken } from "@nestjs/bullmq";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { type FakeReply, FakeUpstream, openAiChatFixture } from "../support/fake-upstream.js";
import { addProviderAccount, insertApiKey, insertOpenAiChatModel } from "../support/inference.js";
import { portOf } from "../support/port-of.js";
import { deleteAllUpstreamData } from "../support/upstream.js";
import { untilUsageQueueIsDrained } from "../support/usage-queue.js";

// Needs Redis at REDIS_URL, in its own database (see tests/usage/records.test.ts).
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import("../support/test-app.js");
const { WorkerModule } = await import("@/worker.module.js");
const { USAGE_QUEUE } = await import("@/queue/models/queue-names.js");

const ADA = { email: "ada@example.com", password: "correct horse battery staple" };
const CHAT_REQUEST = { model: "smart", messages: [{ role: "user", content: "Hi" }] };
const BACKUP_KEY = "sk-backup-secret-9876543210";
// Short Route timeouts, so the timeout case takes a fraction of a second.
const FAST_TIMEOUTS = { connectTimeoutMs: 300, firstTokenTimeoutMs: 300, totalTimeoutMs: 600 };
const SDK_USER_AGENT = "OpenAI/Python 1.99.0";
const FORGED_CLIENT_IP = "203.0.113.7";
const WORKER_WRITE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

const SUCCESS: FakeReply = {
  kind: "json",
  status: 200,
  body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
};
const SERVER_ERROR: FakeReply = { kind: "json", status: 503, body: { error: "overloaded" } };

/** One openai-chat stream chunk that carries a single tool call delta. */
function toolCallChunk(toolCall: object): string {
  const chunk = {
    id: "chatcmpl-upstream-1",
    object: "chat.completion.chunk",
    created: 1794700000,
    model: "upstream-model",
    choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

interface UsageLogItem {
  id: string;
  httpStatus: number;
  errorCode: string | null;
  errorOrigin: string | null;
  userAgent: string | null;
  clientIp: string | null;
}

interface RecordingApp {
  app: NestNodeApplication;
  db: Database;
  apiKey: string;
  providerId: string;
  cookie: string;
}

async function startRecordingApp(): Promise<RecordingApp> {
  const { app, db } = await createTestApp();
  return { app, db, apiKey: "", providerId: "", cookie: "" };
}

/** Empties the records, then serves Model "smart" from one Provider Account of the fake upstream. */
async function resetRecordingApp(gateway: RecordingApp, upstream: FakeUpstream): Promise<void> {
  const usageQueue = gateway.app.get<Queue>(getQueueToken(USAGE_QUEUE));
  // The previous test's job must not land after the tables are emptied.
  await untilUsageQueueIsDrained(usageQueue);
  await deleteAllUpstreamData(gateway.db);
  ({ providerId: gateway.providerId } = await insertOpenAiChatModel(gateway.app, gateway.db, {
    modelName: "smart",
    baseUrl: upstream.baseUrl,
    ...FAST_TIMEOUTS,
  }));
  ({ key: gateway.apiKey } = await insertApiKey(gateway.app, gateway.db));
  gateway.cookie = await setUpFirstUser(gateway.app, ADA);
}

function chat(gateway: RecordingApp, body: object = CHAT_REQUEST, key = gateway.apiKey) {
  return request(gateway.app.getHttpServer())
    .post("/v1/chat/completions")
    .set("Authorization", `Bearer ${key}`)
    .set("User-Agent", SDK_USER_AGENT)
    .set("X-Forwarded-For", FORGED_CLIENT_IP)
    .send(body);
}

/** The Usage Page's newest row, once the worker has written `count` Usage Logs. */
async function newestUsageLog(gateway: RecordingApp, count = 1): Promise<UsageLogItem> {
  const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await request(gateway.app.getHttpServer())
      .get("/api/usage")
      .set("Cookie", gateway.cookie)
      .expect(200);
    const items: UsageLogItem[] = response.body.items;
    const [newest] = items;
    if (items.length >= count && newest) {
      return newest;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`The worker wrote fewer than ${count} Usage Logs`);
}

interface UsageLogAttemptItem {
  upstreamRequestId: string | null;
  failureReason: string | null;
}

/** The Attempts of the Usage Page's newest row, from its detail view. */
async function newestUsageLogAttempts(gateway: RecordingApp): Promise<UsageLogAttemptItem[]> {
  const { id } = await newestUsageLog(gateway);
  const detail = await request(gateway.app.getHttpServer())
    .get(`/api/usage/${id}`)
    .set("Cookie", gateway.cookie)
    .expect(200);
  return detail.body.attempts;
}

/** The one Error Capture, whole, once the worker has written it. */
async function onlyErrorCapture(gateway: RecordingApp) {
  await newestUsageLog(gateway);
  const list = await request(gateway.app.getHttpServer())
    .get("/api/error-captures")
    .set("Cookie", gateway.cookie)
    .expect(200);
  expect(list.body.items).toHaveLength(1);
  const detail = await request(gateway.app.getHttpServer())
    .get(`/api/error-captures/${list.body.items[0].id}`)
    .set("Cookie", gateway.cookie)
    .expect(200);
  return detail.body;
}

describe("Error Origin, client and Provider request id of recorded requests (e2e)", () => {
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let gateway: RecordingApp;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    gateway = await startRecordingApp();
    await gateway.app.get<Queue>(getQueueToken(USAGE_QUEUE)).obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
  });

  beforeEach(async () => {
    upstream.reset();
    await resetRecordingApp(gateway, upstream);
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await gateway.app.get<Queue>(getQueueToken(USAGE_QUEUE)).obliterate({ force: true });
    await gateway.app.close();
  });

  it("records Error Origin client for a bad API Key, with who sent it", async () => {
    const response = await chat(gateway, CHAT_REQUEST, "sk-not-a-key").expect(401);

    expect(response.body.error).toMatchObject({
      code: "invalid_api_key",
      message: "Missing, invalid, revoked or expired API Key",
    });
    expect(await newestUsageLog(gateway)).toMatchObject({
      httpStatus: 401,
      errorCode: "invalid_api_key",
      errorOrigin: "client",
      userAgent: SDK_USER_AGENT,
    });
  });

  it("records Error Origin client for a body that is not JSON", async () => {
    const response = await request(gateway.app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${gateway.apiKey}`)
      .set("Content-Type", "application/json")
      .send("{not json")
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: "invalid_request",
      message: "The request body could not be read as JSON",
    });
    expect(await newestUsageLog(gateway)).toMatchObject({
      errorCode: "invalid_request",
      errorOrigin: "client",
    });
  });

  it("records Error Origin client for an unknown Model", async () => {
    const response = await chat(gateway, { ...CHAT_REQUEST, model: "missing" }).expect(404);

    expect(response.body.error).toMatchObject({
      code: "model_not_found",
      message: 'The Model "missing" does not exist',
    });
    expect(await newestUsageLog(gateway)).toMatchObject({
      errorCode: "model_not_found",
      errorOrigin: "client",
    });
  });

  it.each<[string, FakeReply, number, string]>([
    ["5xx", SERVER_ERROR, 502, "upstream_error"],
    ["timeout", { kind: "hang" }, 504, "upstream_timeout"],
    ["400", { kind: "json", status: 400, body: { error: "bad schema" } }, 400, "invalid_request"],
  ])(
    "records Error Origin upstream for an upstream %s, keeping the client's error code",
    async (_failure, failedReply, status, code) => {
      upstream.reply(failedReply);

      const response = await chat(gateway).expect(status);

      expect(response.body.error.code).toBe(code);
      expect(await newestUsageLog(gateway)).toMatchObject({
        httpStatus: status,
        errorCode: code,
        errorOrigin: "upstream",
      });
    },
  );

  it("records Error Origin upstream when every Provider Account is in Cooldown", async () => {
    upstream.reply(SERVER_ERROR);
    await chat(gateway).expect(502);

    const response = await chat(gateway).expect(502);

    expect(response.body.error.code).toBe("upstream_error");
    expect(upstream.requests).toHaveLength(1);
    expect(await newestUsageLog(gateway, 2)).toMatchObject({
      errorCode: "upstream_error",
      errorOrigin: "upstream",
    });
  });

  it("records a Messages stream the gateway refused mid-way as an upstream error whose Attempt broke off", async () => {
    // Arguments for call 0 after call 1 began can't be written as Messages
    // content blocks, so the gateway ends the stream with an error event.
    upstream.reply({
      kind: "stream",
      events:
        toolCallChunk({ index: 0, id: "call_a", type: "function", function: { name: "a" } }) +
        toolCallChunk({ index: 1, id: "call_b", type: "function", function: { name: "b" } }) +
        toolCallChunk({ index: 0, function: { arguments: "{}" } }) +
        "data: [DONE]\n\n",
    });

    await request(gateway.app.getHttpServer())
      .post("/v1/messages")
      .set("x-api-key", gateway.apiKey)
      .send({ ...CHAT_REQUEST, max_tokens: 256, stream: true })
      .expect(200);

    expect(await newestUsageLog(gateway)).toMatchObject({
      errorCode: "upstream_error",
      errorOrigin: "upstream",
    });
    expect(await newestUsageLogAttempts(gateway)).toMatchObject([
      { failureReason: "stream_interrupted" },
    ]);
  });

  it("records no Error Origin for a successful request", async () => {
    upstream.reply(SUCCESS);

    await chat(gateway).expect(200);

    expect(await newestUsageLog(gateway)).toMatchObject({ httpStatus: 200, errorOrigin: null });
  });

  it("records no Error Origin for a request Fallback recovered", async () => {
    await addProviderAccount(gateway.app, gateway.db, gateway.providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    upstream.reply(SERVER_ERROR);
    upstream.reply(SUCCESS);

    await chat(gateway).expect(200);

    expect(await newestUsageLog(gateway)).toMatchObject({
      httpStatus: 200,
      errorCode: null,
      errorOrigin: null,
    });
  });

  it("records no Error Origin for a stream the client left", async () => {
    const firstChunk = openAiChatFixture("upstream-stream-tool-call.sse").split("\n\n")[0] + "\n\n";
    upstream.reply({ kind: "stream", events: firstChunk, holdOpen: true });
    const server = await gateway.app.listen(0, "127.0.0.1");
    const client = new AbortController();

    const response = await fetch(
      `http://127.0.0.1:${portOf(server.address())}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${gateway.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...CHAT_REQUEST, stream: true }),
        signal: client.signal,
      },
    );
    await response.body?.getReader().read();
    client.abort();

    expect(await newestUsageLog(gateway)).toMatchObject({ errorOrigin: null });
  });

  it("records the User-Agent and the socket's IP, ignoring a forged X-Forwarded-For", async () => {
    await chat(gateway, { ...CHAT_REQUEST, model: "missing" }).expect(404);

    const usageLog = await newestUsageLog(gateway);
    expect(usageLog.userAgent).toBe(SDK_USER_AGENT);
    expect(usageLog.clientIp).toMatch(/127\.0\.0\.1|::1/);
    const capture = await onlyErrorCapture(gateway);
    expect(capture.userAgent).toBe(SDK_USER_AGENT);
    expect(capture.clientIp).toBe(usageLog.clientIp);
  });

  it("truncates a User-Agent over 512 characters", async () => {
    upstream.reply(SUCCESS);

    await chat(gateway).set("User-Agent", "a".repeat(600)).expect(200);

    expect((await newestUsageLog(gateway)).userAgent).toBe("a".repeat(512));
  });

  it("records the Provider request id of a failed Attempt", async () => {
    upstream.reply({ ...SERVER_ERROR, headers: { "x-request-id": "req_failed_1" } });

    await chat(gateway).expect(502);

    const capture = await onlyErrorCapture(gateway);
    expect(capture.failedHop).toMatchObject({
      kind: "gateway-to-provider-account",
      upstreamRequestId: "req_failed_1",
    });
  });

  it("records the Provider request id of an answered Attempt", async () => {
    upstream.reply({ ...SUCCESS, headers: { "request-id": "req_answered_1" } });

    await chat(gateway).expect(200);

    expect(await newestUsageLogAttempts(gateway)).toMatchObject([
      { upstreamRequestId: "req_answered_1" },
    ]);
  });

  it("records the Provider request id of an answered stream Attempt", async () => {
    upstream.reply({
      kind: "stream",
      events: openAiChatFixture("upstream-stream-tool-call.sse"),
      headers: { "x-request-id": "req_streamed_1" },
    });

    await chat(gateway, { ...CHAT_REQUEST, stream: true }).expect(200);

    expect(await newestUsageLogAttempts(gateway)).toMatchObject([
      { upstreamRequestId: "req_streamed_1" },
    ]);
  });

  it("records no Provider request id when no response arrived", async () => {
    upstream.reply({ kind: "hang" });

    await chat(gateway).expect(504);

    expect(await newestUsageLogAttempts(gateway)).toMatchObject([{ upstreamRequestId: null }]);
  });
});

describe("Client IP behind a trusted proxy (e2e)", () => {
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let gateway: RecordingApp;

  beforeAll(async () => {
    process.env.TRUST_PROXY = "true";
    upstream = await FakeUpstream.start();
    gateway = await startRecordingApp();
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
  });

  beforeEach(async () => {
    upstream.reset();
    await resetRecordingApp(gateway, upstream);
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await gateway.app.close();
    delete process.env.TRUST_PROXY;
  });

  it("records the IP the proxy forwarded on the Usage Log and Error Capture", async () => {
    await chat(gateway, { ...CHAT_REQUEST, model: "missing" }).expect(404);

    expect((await newestUsageLog(gateway)).clientIp).toBe(FORGED_CLIENT_IP);
    expect((await onlyErrorCapture(gateway)).clientIp).toBe(FORGED_CLIENT_IP);
  });
});
