import type { Queue } from 'bullmq';

const DRAIN_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

export async function untilUsageQueueIsDrained(usageQueue: Queue): Promise<void> {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const counts = await usageQueue.getJobCounts('waiting', 'active', 'delayed');
    if (Object.values(counts).every((count) => count === 0)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('The worker did not finish the usage jobs');
}
