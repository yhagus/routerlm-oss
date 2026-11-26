import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { addJobOrLog } from "@/queue/models/add-job-or-log";
import { USAGE_QUEUE } from "@/queue/models/queue-names";
import { RECORD_USAGE_JOB, type UsageJob } from "@/usage/models/usage-job";

const WRITE_ATTEMPTS = 3;
const FIRST_RETRY_DELAY_MS = 1_000;

@Injectable()
export class UsageProducer {
  private readonly logger = new Logger(UsageProducer.name);

  constructor(@InjectQueue(USAGE_QUEUE) private readonly usageQueue: Queue) {}

  enqueue(job: UsageJob): void {
    void addJobOrLog(this.usageQueue, this.logger, RECORD_USAGE_JOB, job, {
      removeOnComplete: true,
      removeOnFail: true,
      attempts: WRITE_ATTEMPTS,
      backoff: { type: "exponential", delay: FIRST_RETRY_DELAY_MS },
    });
  }
}
