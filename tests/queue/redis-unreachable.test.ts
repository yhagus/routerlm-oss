import { Logger } from "@nestjs/common";
import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import { FakeUpstream, openAiChatFixture } from "@tests/support/fake-upstream.js";
import { insertApiKey, insertOpenAiChatModel } from "@tests/support/inference.js";
import { deleteAllUpstreamData } from "@tests/support/upstream.js";

process.env.REDIS_URL = "redis://localhost:1";
const { createTestApp } = await import("@tests/support/test-app.js");
const { PingProducer } = await import("@/queue/jobs/ping.producer.js");

describe("Queue with Redis unreachable (e2e)", () => {
  let app: NestNodeApplication;
  let db: Database;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it("logs the failed enqueue and keeps serving requests", async () => {
    const loggedErrors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

    const job = await app.get(PingProducer).ping();

    expect(job).toBeUndefined();
    expect(loggedErrors).toHaveBeenCalledWith(expect.stringContaining('"ping"'));
    await request(app.getHttpServer()).get("/").expect(200);
  });

  it("answers an inference request whose usage job cannot be enqueued, and logs it", async () => {
    const loggedErrors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const upstream = await FakeUpstream.start();
    await deleteAllUpstreamData(db);
    await insertOpenAiChatModel(app, db, { modelName: "smart", baseUrl: upstream.baseUrl });
    const { key } = await insertApiKey(app, db);
    upstream.reply({
      kind: "json",
      status: 200,
      body: JSON.parse(openAiChatFixture("upstream-response-tool-call.json")),
    });

    await request(app.getHttpServer())
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${key}`)
      .send({ model: "smart", messages: [{ role: "user", content: "Hello" }] })
      .expect(200);

    await vi.waitFor(() =>
      expect(loggedErrors).toHaveBeenCalledWith(expect.stringContaining('queue "usage"')),
    );
    await upstream.close();
  });
});
