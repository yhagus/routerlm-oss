import { InMemoryJobRegistry, type JobSnapshot } from "./jobs";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface QueueJobSummary {
  jobId: string;
  source: string;
  status: JobStatus;
  stage: string | null;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ownerId?: string;
  detail?: Record<string, unknown>;
}

export interface QueueJobAdapter {
  source: string;
  list(): QueueJobSummary[];
  remove(jobId: string): boolean;
}

const adapters: QueueJobAdapter[] = [];
const registries: Array<{ source: string; registry: InMemoryJobRegistry<unknown> }> = [];

export function registerJobAdapter(adapter: QueueJobAdapter): void {
  if (!adapters.some((a) => a.source === adapter.source)) adapters.push(adapter);
}

export function registerJobRegistry<T>(source: string, registry: InMemoryJobRegistry<T>): void {
  if (!registries.some((r) => r.source === source)) registries.push({ source, registry: registry as InMemoryJobRegistry<unknown> });
}

export function listAllJobs(): QueueJobSummary[] {
  const out: QueueJobSummary[] = [];
  for (const { source, registry } of registries) {
    for (const job of registry.all()) out.push(snapshotToSummary(source, job));
  }
  for (const adapter of adapters) out.push(...adapter.list());
  out.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });
  return out;
}

export function removeJob(jobId: string): boolean {
  for (const { registry } of registries) {
    if (registry.has(jobId)) {
      registry.remove(jobId);
      return true;
    }
  }
  for (const adapter of adapters) {
    if (adapter.remove(jobId)) return true;
  }
  return false;
}

function snapshotToSummary(source: string, job: JobSnapshot<unknown>): QueueJobSummary {
  return {
    jobId: job.jobId,
    source,
    status: job.status as JobStatus,
    stage: job.stage ?? null,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    ownerId: job.ownerId,
    detail: job.result ? (typeof job.result === "object" ? { result: job.result as Record<string, unknown> } : { result: String(job.result) }) : undefined,
  };
}
