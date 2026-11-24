import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { USAGE_QUEUE } from "@/queue/models/queue-names.js";
import type { UsageJob } from "@/usage/models/usage-job.js";
import { UsageWriter } from "@/usage/providers/usage-writer.js";

@Processor(USAGE_QUEUE)
export class UsageProcessor extends WorkerHost {
  constructor(private readonly usageWriter: UsageWriter) {
    super();
  }

  async process(job: Job<UsageJob>): Promise<void> {
    await this.usageWriter.writeUsage(job.data);
  }
}
