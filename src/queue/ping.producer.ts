import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import type { Job, Queue } from "bullmq";
import { addJobOrLog } from "./add-job-or-log.js";
import { PING_QUEUE } from "./queue-names.js";

export type PingJob = Job<Record<string, never>>;

@Injectable()
export class PingProducer {
  private readonly logger = new Logger(PingProducer.name);

  constructor(@InjectQueue(PING_QUEUE) private readonly pingQueue: Queue) {}

  /** Asks the worker to report its process id. Undefined when Redis is unreachable. */
  ping(): Promise<PingJob | undefined> {
    return addJobOrLog(this.pingQueue, this.logger, "ping", {}, { removeOnComplete: true });
  }
}
