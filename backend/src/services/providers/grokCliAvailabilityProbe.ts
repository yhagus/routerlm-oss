import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { getV2Executor } from "../chat/executors";
import { clearAccountError, markAccountUnavailable, resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import {
  isGrokCliFreeUsageExhausted,
  listGrokCliFamiliesDueForProbe,
  grokCliFamilyProbeModel,
} from "./grokCliQuotaFamily.js";
import { refreshExpiringCredentials } from "./refreshCoordinator";
import { providerSpecificPatch } from "./providerSpecificPatch";

const PROVIDER = "grok-cli";
const TICK_MS = 60_000;
const INITIAL_DELAY_MS = 60_000;
const MAX_DELAY_MS = 15 * 60_000;
const PROBE_CONCURRENCY = 5;

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;
const inFlight = new Set<string>();
const failures = new Map<string, Map<string, number>>();

function probeKey(connectionId: string, family: string): string {
  return `${connectionId}::${family}`;
}

function getAttempts(connectionId: string, family: string): number {
  return failures.get(connectionId)?.get(family) ?? 0;
}

function setAttempts(connectionId: string, family: string, attempt: number): void {
  let perConnection = failures.get(connectionId);
  if (!perConnection) {
    perConnection = new Map();
    failures.set(connectionId, perConnection);
  }
  perConnection.set(family, attempt);
}

function clearAttempts(connectionId: string, family: string): void {
  failures.get(connectionId)?.delete(family);
}

async function probe(runtime: Runtime, connection: ProviderConnection, family: string): Promise<void> {
  const key = probeKey(connection.id, family);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const executor = getV2Executor(PROVIDER);
    if (!executor) return;
    const psd = resolveV1ProviderSpecificData(connection.data);
    const proxyOptions = resolveConnectionProxyConfig(runtime, psd);
    const credentials: Record<string, any> = { ...connection.data, authType: connection.authType, connectionId: connection.id, connectionName: connection.name || connection.id, providerSpecificData: { ...psd, ...proxyOptions } };
    await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions });
    const probeModel = grokCliFamilyProbeModel(family);
    const result = await executor.execute({ model: probeModel, stream: true, credentials, proxyOptions, body: { model: probeModel, input: [{ type: "message", role: "user", content: "ping" }], max_output_tokens: 1, reasoning: { effort: "none", summary: "concise" }, stream: true, store: false } });
    if (result.response.ok) {
      await result.response.text().catch(() => {});
      clearAttempts(connection.id, family);
      clearAccountError(runtime, connection, probeModel);
      return;
    }
    const status = result.response.status;
    const message = await result.response.text().catch(() => "");
    if (isGrokCliFreeUsageExhausted(PROVIDER, status, message)) {
      clearAttempts(connection.id, family);
      await markAccountUnavailable(runtime, connection, status, message, PROVIDER, probeModel);
      return;
    }
    await retry(runtime, connection, family);
  } catch {
    await retry(runtime, connection, family);
  } finally {
    inFlight.delete(key);
  }
}

async function retry(runtime: Runtime, connection: ProviderConnection, family: string): Promise<void> {
  const attempt = getAttempts(connection.id, family) + 1;
  setAttempts(connection.id, family, attempt);
  const delay = Math.min(INITIAL_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  const current = runtime.repos.providers.get(connection.id);
  if (!current) return;
  const data = current.data as Record<string, unknown>;
  const existingProbes = (data.grokCliFamilyNextProbeAt as Record<string, unknown>) || {};
  const nextProbes = { ...existingProbes, [family]: new Date(Date.now() + delay).toISOString() };
  runtime.repos.providers.patch(connection.id, { data: providerSpecificPatch(current, { grokCliFamilyNextProbeAt: nextProbes }) });
}

// Runs at most `limit` tasks at once and resolves when all have settled.
async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      await task(item).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function runGrokCliAvailabilityProbeTick(runtime: Runtime): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const due: Array<{ connection: ProviderConnection; families: string[] }> = [];
    for (const connection of runtime.repos.providers.select(PROVIDER)) {
      if (connection.authType !== "oauth") continue;
      const data = resolveV1ProviderSpecificData(connection.data);
      const families = listGrokCliFamiliesDueForProbe(data, now);
      if (families.length) due.push({ connection, families });
    }
    // Connections run in parallel. Families of one connection stay sequential,
    // because every probe rewrites that connection's stored data.
    await runPool(due, PROBE_CONCURRENCY, async ({ connection, families }) => {
      for (const family of families) await probe(runtime, connection, family);
    });
  } finally { running = false; }
}

export function startGrokCliAvailabilityProbe(runtime: Runtime): void {
  if (interval) return;
  void runGrokCliAvailabilityProbeTick(runtime);
  interval = setInterval(() => { void runGrokCliAvailabilityProbeTick(runtime); }, TICK_MS);
  interval.unref?.();
}

export function stopGrokCliAvailabilityProbe(): void {
  if (interval) clearInterval(interval);
  interval = null;
  failures.clear();
}
