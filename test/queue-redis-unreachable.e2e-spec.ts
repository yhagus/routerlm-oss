import { Logger } from "@nestjs/common";
import { NestNodeApplication, NodeAdapter } from "@nestjs/platform-node";
import { Test } from "@nestjs/testing";
import request from "supertest";

// Nothing listens on port 1, so every Redis connection is refused. Set before
// AppModule loads, because ConfigModule reads the environment at import time.
process.env.REDIS_URL = "redis://localhost:1";
const { AppModule } = await import("../src/app.module.js");
const { PingProducer } = await import("../src/queue/ping.producer.js");

describe("Queue with Redis unreachable (e2e)", () => {
  let app: NestNodeApplication;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestNodeApplication>(new NodeAdapter());
    await app.init();
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
});
