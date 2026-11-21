import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { vi } from "vitest";
import type { ControlPlaneTransport } from "./key-scenarios.js";

// Each suite's beforeAll starts a worker process, which takes a few seconds.
const WORKER_STARTUP_TIMEOUT_MS = 30_000;
vi.setConfig({ hookTimeout: WORKER_STARTUP_TIMEOUT_MS });

// The worker processes queue jobs as it serves the control plane. Its own
// Redis database keeps jobs that other test files enqueued out of its way.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { portOf } = await import("../support/port-of.js");
const { grpcControlPlaneClient } = await import("../support/grpc-control-plane-client.js");
const { describeKeyScenarios } = await import("./key-scenarios.js");
const { describeModelScenarios } = await import("./model-scenarios.js");
const { describeUsageScenarios } = await import("./usage-scenarios.js");

async function freePort(): Promise<number> {
  const server = createServer().listen(0);
  await once(server, "listening");
  const port = portOf(server.address());
  server.close();
  return port;
}

async function stop(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  const exited = once(worker, "exit");
  worker.kill("SIGTERM");
  await exited;
}

// Stopped once more at the end, in case a suite's setup failed before it could.
const startedWorkers = new Set<ChildProcess>();
afterAll(async () => {
  await Promise.all([...startedWorkers].map(stop));
});

/**
 * The gRPC adapter of a worker started as in production (`bun src/worker.ts`)
 * with CONTROL_PLANE_PORT set, against the same database as the test's app.
 */
const GRPC_TRANSPORT: ControlPlaneTransport = {
  name: "gRPC",
  connect: async () => {
    const port = await freePort();
    const worker = spawn("bun", ["src/worker.ts"], {
      env: { ...process.env, CONTROL_PLANE_PORT: String(port) },
      stdio: "inherit",
    });
    startedWorkers.add(worker);
    try {
      const { client, close } = await grpcControlPlaneClient(`127.0.0.1:${port}`);
      return {
        client,
        close: async () => {
          await close();
          await stop(worker);
        },
      };
    } catch (error) {
      await stop(worker);
      throw error;
    }
  },
};

describeKeyScenarios(GRPC_TRANSPORT);
describeModelScenarios(GRPC_TRANSPORT);
describeUsageScenarios(GRPC_TRANSPORT);
