import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { addJobOrLog } from "../queue/add-job-or-log.js";
import { USAGE_QUEUE } from "../queue/queue-names.js";
import { RECORD_USAGE_JOB, type UsageJob } from "./models/usage-job.js";

const WRITE_ATTEMPTS = 3;
const FIRST_RETRY_DELAY_MS = 1_000;

/** Hands each inference request's measurements to the worker (spec "Inference path" step 9). */
@Injectable()
export class UsageProducer {
  private readonly logger = new Logger(UsageProducer.name);

  constructor(@InjectQueue(USAGE_QUEUE) private readonly usageQueue: Queue) {}

  /** Never waits and never throws: a failed enqueue is logged and the request carries on. */
  enqueue(job: UsageJob): void {
    void addJobOrLog(this.usageQueue, this.logger, RECORD_USAGE_JOB, job, {
      removeOnComplete: true,
      attempts: WRITE_ATTEMPTS,
      backoff: { type: "exponential", delay: FIRST_RETRY_DELAY_MS },
    });
  }
}
