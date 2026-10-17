export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobSnapshot<T> {
  jobId: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: T | null;
  error: string | null;
  stage?: string;
  ownerId?: string;
  logs?: string[];
}

export type JobListener<T> = (snapshot: JobSnapshot<T>) => void;

export class InMemoryJobRegistry<T> {
  private readonly jobs = new Map<string, JobSnapshot<T>>();
  private readonly listeners = new Map<string, Set<JobListener<T>>>();

  create(ownerId?: string): JobSnapshot<T> {
    const timestamp = new Date().toISOString();
    const job: JobSnapshot<T> = {
      jobId: `job_${crypto.randomUUID().replaceAll("-", "")}`,
      status: "queued",
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      stage: undefined,
      ownerId,
      logs: [] as any[],
    };
    this.jobs.set(job.jobId, job);
    this.listeners.set(job.jobId, new Set());
    return job;
  }

  get(jobId: string): JobSnapshot<T> | null {
    return this.jobs.get(jobId) || null;
  }

  has(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  all(): JobSnapshot<T>[] {
    return [...this.jobs.values()];
  }

  subscribe(jobId: string, listener: JobListener<T>): () => void {
    const listeners = this.listeners.get(jobId);
    if (!listeners) return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  update(jobId: string, patch: Partial<JobSnapshot<T>>): JobSnapshot<T> | null {
    const current = this.jobs.get(jobId);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.jobs.set(jobId, next);
    for (const listener of [...(this.listeners.get(jobId) || [])]) {
      try {
        listener(next);
      } catch {
        // A dead stream cannot be allowed to break the job runner.
      }
    }
    return next;
  }

  remove(jobId: string): void {
    this.jobs.delete(jobId);
    this.listeners.delete(jobId);
  }
}
