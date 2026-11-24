import cluster, { type Worker } from "node:cluster";
import { Logger } from "@nestjs/common";
import { SECOND_MS } from "./duration.js";

const MAX_UNEXPECTED_EXITS = 5;
const UNEXPECTED_EXIT_WINDOW_MS = 60 * SECOND_MS;
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

const logger = new Logger("GatewayProcesses");

export async function runGatewayProcesses(
  processCount: number,
  startGateway: () => Promise<void>,
): Promise<void> {
  if (cluster.isWorker || processCount === 1) {
    return startGateway();
  }
  if (process.platform !== "linux") {
    logger.warn(
      `BACKEND_PROCESSES=${processCount} needs Linux to share a port between processes; running one process`,
    );
    return startGateway();
  }
  superviseWorkers(processCount);
}

function superviseWorkers(processCount: number): void {
  const workers = new Set<Worker>();
  const unexpectedExitTimes: number[] = [];
  let isStopping = false;

  const startWorker = (): void => {
    const worker = cluster.fork();
    workers.add(worker);
    logger.log(`Gateway process ${worker.process.pid} started`);
  };

  const stopAll = (signal: NodeJS.Signals, exitCode: number): void => {
    isStopping = true;
    process.exitCode = exitCode;
    if (workers.size === 0) process.exit(exitCode);
    for (const worker of workers) worker.process.kill(signal);
  };

  cluster.on("exit", (worker, code, signal) => {
    workers.delete(worker);
    if (isStopping) {
      if (workers.size === 0) process.exit();
      return;
    }

    const now = Date.now();
    unexpectedExitTimes.push(now);
    while (unexpectedExitTimes[0] <= now - UNEXPECTED_EXIT_WINDOW_MS) unexpectedExitTimes.shift();
    const exitReason = signal ?? `code ${code}`;
    if (unexpectedExitTimes.length > MAX_UNEXPECTED_EXITS) {
      logger.error(
        `Gateway process ${worker.process.pid} exited (${exitReason}); more than ${MAX_UNEXPECTED_EXITS} exits within ${UNEXPECTED_EXIT_WINDOW_MS / SECOND_MS} s, stopping`,
      );
      stopAll("SIGTERM", 1);
      return;
    }
    logger.warn(`Gateway process ${worker.process.pid} exited (${exitReason}); replacing it`);
    startWorker();
  });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => stopAll(signal, 0));
  }
  for (let started = 0; started < processCount; started += 1) startWorker();
}
