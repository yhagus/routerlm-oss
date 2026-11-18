import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { vi } from "vitest";
import { portOf } from "../support/port-of.js";

// ADR 0025: processes share a port only on Linux (CI, or a Linux container).
// Elsewhere the backend runs one process and there is nothing to supervise.
const PROCESS_COUNT = 2;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const STARTED_PROCESS_LINE = /Gateway process (\d+) started/g;

async function freePort(): Promise<number> {
  const server = createServer().listen(0);
  await once(server, "listening");
  const port = portOf(server.address());
  server.close();
  return port;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(process.platform === "linux")("Backend with BACKEND_PROCESSES=2 (e2e)", () => {
  let primary: ChildProcess;
  let healthUrl: string;
  let output = "";

  /** The pids the primary has logged as started, oldest first. */
  const startedPids = (): number[] =>
    [...output.matchAll(STARTED_PROCESS_LINE)].map((match) => Number(match[1]));

  const expectHealthy = async (): Promise<void> => {
    const response = await fetch(healthUrl);
    expect(response.status).toBe(200);
  };

  beforeAll(async () => {
    const port = await freePort();
    healthUrl = `http://127.0.0.1:${port}/health`;
    primary = spawn("bun", ["src/main.ts"], {
      env: {
        ...process.env,
        PORT: String(port),
        BACKEND_PROCESSES: String(PROCESS_COUNT),
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    primary.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    await vi.waitFor(expectHealthy, { timeout: STARTUP_TIMEOUT_MS, interval: POLL_INTERVAL_MS });
  }, STARTUP_TIMEOUT_MS);

  afterAll(() => {
    if (primary.exitCode === null) primary.kill("SIGKILL");
  });

  it(
    "replaces a gateway process that dies and keeps serving",
    async () => {
      expect(startedPids()).toHaveLength(PROCESS_COUNT);
      const [killedPid] = startedPids();

      process.kill(killedPid, "SIGKILL");

      await vi.waitFor(() => expect(startedPids()).toHaveLength(PROCESS_COUNT + 1), {
        timeout: STARTUP_TIMEOUT_MS,
        interval: POLL_INTERVAL_MS,
      });
      await vi.waitFor(expectHealthy, { timeout: STARTUP_TIMEOUT_MS, interval: POLL_INTERVAL_MS });
      expect(isRunning(killedPid)).toBe(false);
    },
    STARTUP_TIMEOUT_MS * 2,
  );

  it(
    "stops every gateway process and exits 0 on SIGTERM",
    async () => {
      const exited = once(primary, "exit");

      primary.kill("SIGTERM");

      const [exitCode] = await exited;
      expect(exitCode).toBe(0);
      expect(startedPids().filter(isRunning)).toEqual([]);
    },
    STARTUP_TIMEOUT_MS,
  );
});
