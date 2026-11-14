import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { PingJob } from "./ping.producer.js";
import { PING_QUEUE } from "../models/queue-names.js";

export type PingResult = { workerPid: number };

/** Registered only in WorkerModule, so ping jobs run in the worker process. */
@Processor(PING_QUEUE)
export class PingProcessor extends WorkerHost {
  async process(_job: PingJob): Promise<PingResult> {
    return { workerPid: process.pid };
  }
}
