import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { USAGE_QUEUE } from "../queue/queue-names.js";
import type { UsageJob } from "./usage-job.js";
import { UsageWriter } from "./usage-writer.js";

/** Registered only in WorkerModule: Usage Logs are written by the worker, never the backend. */
@Processor(USAGE_QUEUE)
export class UsageProcessor extends WorkerHost {
  constructor(private readonly usageWriter: UsageWriter) {
    super();
  }

  async process(job: Job<UsageJob>): Promise<void> {
    await this.usageWriter.writeUsage(job.data);
  }
}
