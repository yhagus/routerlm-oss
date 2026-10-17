import type { ProviderConnection, QuotaSnapshot } from "../../db/repositories";
import type { Runtime } from "../../runtime";
import { fetchConnectionUsageFromProvider, isUsageEligibleConnection } from "../providers/providerUsage";

const REFRESH_SCAN_MS = 10_000;
const MAX_CONCURRENT_REFRESHES = 4;
const DEFAULT_REFRESH_MS = 60_000;
const CLAUDE_REFRESH_MS = 180_000;
const MAX_FAILURE_DELAY_MS = 15 * 60_000;

type QueuedRefresh = {
  connectionId: string;
  resolve: (snapshot: QuotaSnapshot | null) => void;
};

function intervalFor(connection: ProviderConnection): number {
  return connection.provider === "claude" ? CLAUDE_REFRESH_MS : DEFAULT_REFRESH_MS;
}

function timestampAfter(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function snapshotPayload(snapshot: QuotaSnapshot | null): Record<string, unknown> {
  return snapshot?.payload || {};
}

export class QuotaSnapshotManager {
  private readonly running = new Set<string>();
  private readonly queued = new Map<string, QueuedRefresh[]>();
  private readonly priority = new Set<string>();
  private readonly activeWaiters = new Map<string, Array<(snapshot: QuotaSnapshot | null) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly runtime: Runtime) {}

  start(): void {
    if (this.timer) return;
    this.scan().catch(() => {});
    this.timer = setInterval(() => this.scan().catch(() => {}), REFRESH_SCAN_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot(connectionId: string): QuotaSnapshot | null {
    return this.runtime.repos.quotaSnapshots.get(connectionId);
  }

  getPayload(connectionId: string): Record<string, unknown> {
    const snapshot = this.getSnapshot(connectionId);
    if (snapshot) {
      const payload: Record<string, unknown> = {
        ...snapshot.payload,
        snapshot: {
          status: snapshot.status,
          fetchedAt: snapshot.fetchedAt,
          expiresAt: snapshot.expiresAt,
          lastError: snapshot.lastError,
        },
      };
      if (snapshot.status === "error" && !payload.message && snapshot.lastError) {
        payload.message = snapshot.lastError;
      }
      return payload;
    }
    return {
      message: "Quota refresh is pending.",
      snapshot: { status: "pending", fetchedAt: null, expiresAt: null, lastError: null },
    };
  }

  requestRefresh(connectionId: string): Promise<QuotaSnapshot | null> {
    return new Promise<any>((resolve) => {
      if (this.running.has(connectionId)) {
        const waiters = this.activeWaiters.get(connectionId) || [];
        waiters.push(resolve);
        this.activeWaiters.set(connectionId, waiters);
        return;
      }
      const waiters = this.queued.get(connectionId) || [];
      waiters.push({ connectionId, resolve });
      this.queued.set(connectionId, waiters);
      this.priority.add(connectionId);
      this.drain();
    });
  }

  // Refresh only the connections whose snapshot is stale (missing, error, or
  // past its due time), using the same due logic as the background scan. Fresh
  // snapshots never touch the upstream. Used when a dashboard page mounts so a
  // visit surfaces current numbers without spamming provider quota endpoints.
  async refreshStale(connectionIds: string[]): Promise<void> {
    const now = Date.now();
    const stale: string[] = [];
    for (const connectionId of connectionIds) {
      const connection = this.runtime.repos.providers.get(connectionId);
      if (!connection || !connection.isActive || !isUsageEligibleConnection(connection)) continue;
      const snapshot = this.getSnapshot(connectionId);
      if (!snapshot) {
        stale.push(connectionId);
        continue;
      }
      if (snapshot.status === "error") {
        stale.push(connectionId);
        continue;
      }
      const dueAt = snapshot.nextRefreshAt ? new Date(snapshot.nextRefreshAt).getTime() : 0;
      if (!Number.isFinite(dueAt) || dueAt <= now) stale.push(connectionId);
    }
    await Promise.all(stale.map((connectionId) => this.requestRefresh(connectionId).catch(() => null)));
  }

  private async scan(): Promise<void> {
    const now = Date.now();
    for (const connection of this.runtime.repos.providers.list(true)) {
      if (!connection.isActive || !isUsageEligibleConnection(connection)) continue;
      const snapshot = this.getSnapshot(connection.id);
      const dueAt = snapshot?.nextRefreshAt ? new Date(snapshot.nextRefreshAt).getTime() : 0;
      if (!Number.isFinite(dueAt) || dueAt <= now) this.enqueueBackground(connection.id);
    }
    this.drain();
  }

  private enqueueBackground(connectionId: string): void {
    if (this.running.has(connectionId) || this.queued.has(connectionId)) return;
    this.queued.set(connectionId, []);
  }

  private drain(): void {
    while (this.running.size < MAX_CONCURRENT_REFRESHES) {
      const connectionId = this.priority.values().next().value as string | undefined
        || this.queued.keys().next().value as string | undefined;
      if (!connectionId) return;
      this.priority.delete(connectionId);
      const waiters = this.queued.get(connectionId) || [];
      this.queued.delete(connectionId);
      this.running.add(connectionId);
      this.refresh(connectionId)
        .then((snapshot) => {
          waiters.forEach((waiter) => waiter.resolve(snapshot));
          this.activeWaiters.get(connectionId)?.forEach((resolve) => resolve(snapshot));
        })
        .catch(() => {
          const snapshot = this.getSnapshot(connectionId);
          waiters.forEach((waiter) => waiter.resolve(snapshot));
          this.activeWaiters.get(connectionId)?.forEach((resolve) => resolve(snapshot));
        })
        .finally(() => {
          this.activeWaiters.delete(connectionId);
          this.running.delete(connectionId);
          this.drain();
        });
    }
  }

  private async refresh(connectionId: string): Promise<QuotaSnapshot | null> {
    const connection = this.runtime.repos.providers.get(connectionId);
    if (!connection || !connection.isActive || !isUsageEligibleConnection(connection)) return this.getSnapshot(connectionId);

    const previous = this.getSnapshot(connectionId);
    const result = await fetchConnectionUsageFromProvider(this.runtime, connectionId);
    const successful = result.status === 200;
    const failureCount = successful ? 0 : (previous?.failureCount || 0) + 1;
    const delay = successful
      ? intervalFor(connection)
      : Math.min(intervalFor(connection) * 2 ** failureCount, MAX_FAILURE_DELAY_MS);
    const fetchedAt = successful ? new Date().toISOString() : previous?.fetchedAt || null;
    const payload = successful ? result.body : snapshotPayload(previous);
    const error = successful ? null : String(result.body.error || result.body.message || `Quota refresh failed with status ${result.status}.`);

    return this.runtime.repos.quotaSnapshots.upsert({
      connectionId,
      provider: connection.provider,
      payload,
      status: successful ? "ready" : "error",
      fetchedAt,
      expiresAt: fetchedAt ? timestampAfter(intervalFor(connection)) : null,
      nextRefreshAt: timestampAfter(delay),
      lastError: error,
      failureCount,
    });
  }
}
