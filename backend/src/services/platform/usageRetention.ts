// Usage retention job. When settings.usageRetentionDays is a positive number,
// raw Usage rows older than that many local days move into daily rollups
// (see db/usageQueries.ts). The default (unset or 0) keeps every raw row.
import type { Runtime } from "../../runtime";

export const USAGE_RETENTION_BATCH = 2000;
const RUN_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;

// Whole days; 0 means retention is off.
export function usageRetentionDays(settings: Record<string, unknown>): number {
  const days = Math.floor(Number(settings.usageRetentionDays));
  return Number.isFinite(days) && days > 0 ? days : 0;
}

// Local midnight `days` days before today. Raw rows from this time on stay.
export function usageRetentionCutoff(days: number, now = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString();
}

const running = new WeakMap<Runtime["repos"], Promise<UsageRetentionResult>>();

export interface UsageRetentionResult {
  retentionDays: number;
  cutoff: string | null;
  moved: number;
}

// Runs the job to the end. Each batch is one transaction. The job yields to
// the event loop between batches. A call during a run joins that run.
export function runUsageRetention(runtime: Pick<Runtime, "repos">): Promise<UsageRetentionResult> {
  const current = running.get(runtime.repos);
  if (current) return current;
  const run = (async () => {
    const retentionDays = usageRetentionDays(runtime.repos.settings.get() as Record<string, unknown>);
    if (!retentionDays) return { retentionDays, cutoff: null, moved: 0 };
    const cutoff = usageRetentionCutoff(retentionDays);
    let moved = 0;
    while (true) {
      const count = runtime.repos.usage.rollupBefore(cutoff, USAGE_RETENTION_BATCH);
      moved += count;
      if (count < USAGE_RETENTION_BATCH) return { retentionDays, cutoff, moved };
      await new Promise((resolve) => setImmediate(resolve));
    }
  })().finally(() => running.delete(runtime.repos));
  running.set(runtime.repos, run);
  return run;
}

// Runs the job shortly after start and then every hour. Returns a stop function.
export function startUsageRetention(runtime: Pick<Runtime, "repos">): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (delay: number) => {
    timer = setTimeout(async () => {
      timer = null;
      try {
        const result = await runUsageRetention(runtime);
        if (result.moved) console.log(`[usage-retention] moved ${result.moved} raw Usage rows before ${result.cutoff} into daily rollups`);
      } catch (error) {
        if (!stopped) console.warn(`[usage-retention] run failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!stopped) schedule(RUN_INTERVAL_MS);
    }, delay);
    timer.unref?.();
  };
  schedule(FIRST_RUN_DELAY_MS);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
