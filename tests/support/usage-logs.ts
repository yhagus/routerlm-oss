import { usageLogs } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";

const WORKER_WRITE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

export async function writtenUsageLogs(db: Database): Promise<(typeof usageLogs.$inferSelect)[]> {
  const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const written = await db.select().from(usageLogs);
    if (written.length > 0) {
      return written;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("The worker wrote no Usage Log");
}

export async function writtenUsageLog(db: Database): Promise<typeof usageLogs.$inferSelect> {
  const [usageLog] = await writtenUsageLogs(db);
  return usageLog;
}
