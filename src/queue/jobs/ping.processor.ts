import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { PingJob } from "./ping.producer";
import { PING_QUEUE } from "@/queue/models/queue-names";

export type PingResult = { workerPid: number };

@Processor(PING_QUEUE)
export class PingProcessor extends WorkerHost {
  async process(_job: PingJob): Promise<PingResult> {
    return { workerPid: process.pid };
  }
}
