import type { Logger } from "@nestjs/common";
import type { Job, JobsOptions, Queue } from "bullmq";

export async function addJobOrLog<Data>(
  queue: Queue,
  logger: Logger,
  jobName: string,
  data: Data,
  options?: JobsOptions,
): Promise<Job<Data> | undefined> {
  try {
    return await queue.add(jobName, data, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Could not enqueue job "${jobName}" on queue "${queue.name}": ${reason}`);
    return undefined;
  }
}
