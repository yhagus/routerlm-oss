import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { getV2Executor } from "../chat/executors";
import {
  clearAccountError,
  markAccountUnavailable,
  resolveConnectionProxyConfig,
  resolveV1ProviderSpecificData,
} from "../chat/credentials";
import { InMemoryJobRegistry, type JobSnapshot } from "../platform/jobs";
import { registerJobRegistry } from "../platform/jobRegistry";
import { refreshExpiringCredentials } from "./refreshCoordinator";

const PROVIDER = "grok-cli";
const DEFAULT_MODEL = "grok-4.6";
const PROBE_PROMPT = "Reply exactly with '407'";
// An account that gives no complete reply within this time counts as damaged.
export const DEFAULT_PROBE_TIMEOUT_MS = 7_000;
const MIN_PROBE_TIMEOUT_MS = 1_000;
const MAX_PROBE_TIMEOUT_MS = 120_000;

export function normalizeProbeTimeoutMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.min(MAX_PROBE_TIMEOUT_MS, Math.max(MIN_PROBE_TIMEOUT_MS, Math.round(parsed)));
}
export const DEFAULT_PROBE_CONCURRENCY = 5;
const MAX_PROBE_CONCURRENCY = 50;

export function normalizeProbeConcurrency(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PROBE_CONCURRENCY;
  return Math.min(MAX_PROBE_CONCURRENCY, parsed);
}

export type Probe407Status = "queued" | "probing" | "healthy" | "damaged" | "error";

export interface Probe407Item {
  connectionId: string;
  name: string | null;
  email: string | null;
  status: Probe407Status;
  reply: string | null;
  error: string | null;
}

export interface Probe407Result {
  provider: string;
  total: number;
  completed: number;
  healthy: number;
  damaged: number;
  errors: number;
  items: Probe407Item[];
}

const jobs = new InMemoryJobRegistry<Probe407Result>();
registerJobRegistry("grok-cli-probe-407", jobs);

// Persists the probe verdict on the account itself, so the UI can find damaged
// accounts later. lastError alone is not enough: other errors overwrite it, and
// an unexpected reply never wrote it.
function setDamagedFlag(runtime: Runtime, connectionId: string, damaged: boolean): void {
  const current = runtime.repos.providers.get(connectionId);
  if (!current) return;
  if (!damaged && !("probe407DamagedAt" in current.data)) return;
  runtime.repos.providers.patch(connectionId, { data: { probe407DamagedAt: damaged ? new Date().toISOString() : null } });
}

function extractReplyText(response: Response): Promise<string> {
  const body = response.body;
  if (!body?.getReader) return Promise.resolve("");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  async function pump(): Promise<string> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            text += event.delta;
          } else if (event.type === "response.completed" && Array.isArray(event.response?.output)) {
            for (const item of event.response.output) {
              if (item?.type === "message" && Array.isArray(item.content)) {
                for (const part of item.content) {
                  if (typeof part?.text === "string") text += part.text;
                }
              }
            }
          }
        } catch {
          // Ignore malformed JSON lines.
        }
      }
    }
    return text;
  }

  return pump();
}

async function probeConnection(
  runtime: Runtime,
  connection: ProviderConnection,
  model: string,
  timeoutMs: number,
): Promise<Probe407Item> {
  const base: Probe407Item = {
    connectionId: connection.id,
    name: connection.name,
    email: connection.email,
    status: "error",
    reply: null,
    error: null,
  };

  try {
    const executor = getV2Executor(PROVIDER);
    if (!executor) {
      return { ...base, error: "Grok CLI executor unavailable." };
    }

    const psd = resolveV1ProviderSpecificData(connection.data);
    const proxyOptions = resolveConnectionProxyConfig(runtime, psd);
    const credentials: Record<string, any> = {
      ...connection.data,
      authType: connection.authType,
      connectionId: connection.id,
      connectionName: connection.name || connection.id,
      providerSpecificData: { ...psd, ...proxyOptions },
    };

    await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions });

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, timeoutMs);
    });
    const work = (async () => {
      const response = await executor.execute({
        model,
        stream: true,
        credentials,
        proxyOptions,
        signal: controller.signal,
        body: {
          model,
          input: [{ type: "message", role: "user", content: PROBE_PROMPT }],
          max_output_tokens: 16,
          stream: true,
          store: false,
        },
      });
      const text = response?.response?.ok ? (await extractReplyText(response.response)).trim() : "";
      return { result: response, reply: text };
    })();
    // The abort makes `work` reject after the deadline wins the race. Nobody awaits it then.
    work.catch(() => {});
    let outcome: Awaited<typeof work> | "timeout";
    try {
      outcome = await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }

    if (outcome === "timeout") {
      await markAccountUnavailable(runtime, connection, 0, "probe-407:damaged", PROVIDER, model);
      setDamagedFlag(runtime, connection.id, true);
      return {
        ...base,
        status: "damaged",
        error: `No reply within ${timeoutMs / 1000}s.`,
      };
    }

    const { result, reply } = outcome;
    if (!result?.response?.ok) {
      const status = result?.response?.status ?? 0;
      const bodyText = await result?.response?.text?.().catch(() => "");
      const message = bodyText ? `HTTP ${status}: ${bodyText.slice(0, 200)}` : `HTTP ${status}`;
      return { ...base, status: "error", error: message };
    }

    if (/407/.test(reply) && !/202/.test(reply)) {
      clearAccountError(runtime, connection, null);
      setDamagedFlag(runtime, connection.id, false);
      return {
        ...base,
        status: "healthy",
        reply,
      };
    }

    if (/202/.test(reply)) {
      await markAccountUnavailable(runtime, connection, 0, "probe-407:damaged", PROVIDER, model);
      setDamagedFlag(runtime, connection.id, true);
      return {
        ...base,
        status: "damaged",
        reply,
      };
    }

    setDamagedFlag(runtime, connection.id, true);
    return {
      ...base,
      status: "damaged",
      reply,
      error: "Unexpected reply.",
    };
  } catch (error: any) {
    return {
      ...base,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createProbe407Job(
  runtime: Runtime,
  connectionIds: string[],
  modelOverride?: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  concurrency: number = DEFAULT_PROBE_CONCURRENCY,
): JobSnapshot<Probe407Result> {
  const connections = runtime.repos.providers
    .list(true)
    .filter(
      (connection) =>
        connection.provider === PROVIDER &&
        connectionIds.includes(connection.id),
    );

  const items: Probe407Item[] = connections.map((connection) => ({
    connectionId: connection.id,
    name: connection.name,
    email: connection.email,
    status: "queued",
    reply: null,
    error: null,
  }));

  const initialResult: Probe407Result = {
    provider: PROVIDER,
    total: items.length,
    completed: 0,
    healthy: 0,
    damaged: 0,
    errors: 0,
    items,
  };

  const job = jobs.create();
  jobs.update(job.jobId, { status: "running", startedAt: new Date().toISOString(), result: initialResult });

  const model = modelOverride ?? DEFAULT_MODEL;

  // Each connection has its own credentials and stored data, so probes can overlap.
  // The get/update pairs below contain no await, so concurrent workers never clobber each other.
  const probeOne = async (i: number): Promise<void> => {
    const current = jobs.get(job.jobId);
    if (!current || current.status === "failed") return;

    const connection = connections[i];
    const updatedItems = [...current.result!.items];
    updatedItems[i] = { ...updatedItems[i], status: "probing" };
    jobs.update(job.jobId, {
      result: { ...current.result!, items: updatedItems },
    });

    const probed = await probeConnection(runtime, connection, model, normalizeProbeTimeoutMs(timeoutMs));
    const snapshot = jobs.get(job.jobId);
    if (!snapshot || snapshot.status === "failed") return;
    const finalItems = [...snapshot.result!.items];
    finalItems[i] = probed;
    const completed = snapshot.result!.completed + 1;
    const healthy = finalItems.filter((item) => item.status === "healthy").length;
    const damaged = finalItems.filter((item) => item.status === "damaged").length;
    const errors = finalItems.filter((item) => item.status === "error").length;
    jobs.update(job.jobId, {
      result: { ...snapshot.result!, completed, healthy, damaged, errors, items: finalItems },
    });
  };

  void (async () => {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < items.length) await probeOne(next++);
    };
    await Promise.all(Array.from({ length: Math.min(normalizeProbeConcurrency(concurrency), items.length) }, worker));

    const finished = jobs.get(job.jobId);
    if (finished && finished.status !== "failed") {
      jobs.update(job.jobId, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });
    }
  })();

  return jobs.get(job.jobId)!;
}

// An account counts as damaged when Probe 407 flagged it. Older runs only left
// the marker text in lastError, so accept both.
export function isProbe407Damaged(connection: ProviderConnection): boolean {
  const data = connection.data as Record<string, unknown>;
  return Boolean(data.probe407DamagedAt) || String(data.lastError ?? "").includes("probe-407:damaged");
}

export function listProbe407Damaged(runtime: Runtime): ProviderConnection[] {
  return runtime.repos.providers.list(true).filter((connection) => connection.provider === PROVIDER && isProbe407Damaged(connection));
}

export function deleteProbe407Damaged(runtime: Runtime): { deleted: string[]; failed: string[] } {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const connection of listProbe407Damaged(runtime)) {
    let removed = false;
    try { removed = runtime.repos.providers.remove(connection.id); } catch { removed = false; }
    (removed ? deleted : failed).push(connection.id);
  }
  return { deleted, failed };
}

export function getProbe407Job(jobId: string): JobSnapshot<Probe407Result> | null {
  return jobs.get(jobId);
}
