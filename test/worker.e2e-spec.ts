import { type ChildProcess, spawn } from "node:child_process";
import { getQueueToken } from "@nestjs/bullmq";
import { Test, type TestingModule } from "@nestjs/testing";
import { type Queue, QueueEvents } from "bullmq";

// Needs a reachable Redis at REDIS_URL. Each run uses its own Redis database,
// so parallel runs never process each other's jobs.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { AppModule } = await import("../src/app.module.js");
const { PingProducer } = await import("../src/queue/jobs/ping.producer.js");
const { PING_QUEUE } = await import("../src/queue/models/queue-names.js");

const WORKER_STARTUP_AND_JOB_TIMEOUT_MS = 20_000;

describe("Worker (e2e)", () => {
  let backend: TestingModule;
  let worker: ChildProcess;
  let pingEvents: QueueEvents;

  beforeAll(async () => {
    backend = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await backend.init();
    pingEvents = new QueueEvents(PING_QUEUE, { connection: { url: redisUrl.toString() } });
    await pingEvents.waitUntilReady();
    worker = spawn("bun", ["src/worker.ts"], { env: process.env, stdio: "inherit" });
  });

  afterAll(async () => {
    worker.kill("SIGTERM");
    await pingEvents.close();
    await backend.get<Queue>(getQueueToken(PING_QUEUE)).obliterate({ force: true });
    await backend.close();
  });

  it(
    "processes a job enqueued by the backend in the worker process",
    async () => {
      const job = await backend.get(PingProducer).ping();
      if (!job) throw new Error("the ping job was not enqueued");

      const result: unknown = await job.waitUntilFinished(pingEvents);

      expect(result).toEqual({ workerPid: worker.pid });
      expect(worker.pid).not.toBe(process.pid);
    },
    WORKER_STARTUP_AND_JOB_TIMEOUT_MS,
  );
});
