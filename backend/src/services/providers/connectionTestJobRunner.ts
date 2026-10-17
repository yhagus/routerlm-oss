import type { Runtime } from "../../runtime";
import type { ConnectionTestJobRecord } from "../../db/repositories";
import { testSingleConnection } from "./connectionTest";

const POLL_MS = 50;
const CANCEL_POLL_MS = 25;

export class ConnectionTestJobRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private stopped = true;

  constructor(private readonly runtime: Runtime) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.runtime.repos.connectionTestJobs.recoverInterrupted();
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.processing) return;
    this.processing = true;
    try {
      const job = this.runtime.repos.connectionTestJobs.claimNextQueued();
      if (job) await this.process(job);
    } finally {
      this.processing = false;
      if (!this.stopped) this.schedule(POLL_MS);
    }
  }

  private async process(job: ConnectionTestJobRecord): Promise<void> {
    for (const item of job.items) {
      const current = this.runtime.repos.connectionTestJobs.get(job.id);
      if (!current || current.status === "cancelled" || current.status === "failed") return;
      if (item.status !== "queued") continue;
      this.runtime.repos.connectionTestJobs.markItemTesting(job.id, item.connectionId);
      try {
        const result = await testSingleConnection(this.runtime, item.connectionId);
        this.runtime.repos.connectionTestJobs.markItemResult(job.id, item.connectionId, {
          status: result.valid ? "success" : "failed",
          error: result.valid ? null : result.error,
          latencyMs: result.latencyMs,
        });
      } catch (error) {
        this.runtime.repos.connectionTestJobs.markItemResult(job.id, item.connectionId, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const after = this.runtime.repos.connectionTestJobs.get(job.id);
      if (!after || after.status === "cancelled") return;
      if (after.delayMs > 0 && after.items.some((candidate) => candidate.status === "queued")) {
        await this.wait(after.delayMs, job.id);
      }
    }
    const latest = this.runtime.repos.connectionTestJobs.get(job.id);
    if (!latest || latest.status === "cancelled" || latest.status === "failed") return;
    this.runtime.repos.connectionTestJobs.finish(job.id, "completed");
  }

  private async wait(delayMs: number, jobId: string): Promise<void> {
    const deadline = Date.now() + delayMs;
    while (Date.now() < deadline) {
      if (this.stopped) return;
      const current = this.runtime.repos.connectionTestJobs.get(jobId);
      if (!current || current.status === "cancelled") return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(CANCEL_POLL_MS, deadline - Date.now())));
    }
  }
}
