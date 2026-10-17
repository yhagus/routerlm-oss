// Port of v1's requestDetailsRepo write path (src/lib/db/repos/requestDetailsRepo.js):
// observability-gated buffered writes, header sanitization, field truncation,
// upsert on id, and trim to the configured max records. The read side lives in
// repos.usage.requestDetails; this service owns writes from the chat pipeline.
import type { Runtime } from "../../runtime";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

interface ObservabilityConfig {
  enabled: boolean;
  maxRecords: number;
  batchSize: number;
  flushIntervalMs: number;
  maxJsonSize: number;
}

// Per runtime, so a second runtime in the same process reads its own settings.
const cachedConfigs = new WeakMap<Runtime, { config: ObservabilityConfig; at: number }>();

function observabilityConfig(runtime: Runtime): ObservabilityConfig {
  const cached = cachedConfigs.get(runtime);
  if (cached && Date.now() - cached.at < CONFIG_CACHE_TTL_MS) return cached.config;
  let cachedConfig: ObservabilityConfig;
  try {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled = typeof settings.enableObservability2 === "boolean" ? settings.enableObservability2 : envEnabled;
    cachedConfig = {
      enabled,
      maxRecords: Number(settings.observabilityMaxRecords) || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: Number(settings.observabilityBatchSize) || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: Number(settings.observabilityFlushIntervalMs) || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (Number(settings.observabilityMaxJsonSize) || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = { enabled: false, maxRecords: DEFAULT_MAX_RECORDS, batchSize: DEFAULT_BATCH_SIZE, flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS, maxJsonSize: DEFAULT_MAX_JSON_SIZE };
  }
  cachedConfigs.set(runtime, { config: cachedConfig, at: Date.now() });
  return cachedConfig;
}

function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

function generateDetailId(model: string): string {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj: unknown, maxSize: number): unknown {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

// Buffered writers per runtime instance (one runtime per process).
const writeBuffers = new WeakMap<Runtime, Array<Record<string, any>>>();
const flushTimers = new WeakMap<Runtime, ReturnType<typeof setTimeout>>();
const flushing = new WeakSet<Runtime>();
// Row count of requestDetails per runtime. One COUNT(*) on the first flush;
// later flushes add inserts and subtract trims. This service is the only writer.
const rowCounts = new WeakMap<Runtime, number>();

function bufferOf(runtime: Runtime): Array<Record<string, any>> {
  let buffer = writeBuffers.get(runtime);
  if (!buffer) {
    buffer = [];
    writeBuffers.set(runtime, buffer);
  }
  return buffer;
}

function flushToDatabase(runtime: Runtime): void {
  if (flushing.has(runtime)) return;
  const writeBuffer = bufferOf(runtime);
  if (writeBuffer.length === 0) return;
  flushing.add(runtime);
  try {
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      const config = observabilityConfig(runtime);
      const insert = runtime.sqlite.query(
        `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      );
      const update = runtime.sqlite.query(
        `UPDATE requestDetails SET timestamp = ?, provider = ?, model = ?, connectionId = ?, status = ?, data = ? WHERE id = ?`,
      );
      if (!rowCounts.has(runtime)) {
        rowCounts.set(runtime, Number((runtime.sqlite.query("SELECT COUNT(*) AS c FROM requestDetails").get() as { c: number }).c) || 0);
      }
      runtime.sqlite.transaction(() => {
        let count = rowCounts.get(runtime) || 0;
        for (const item of items) {
          if (!item.id) item.id = generateDetailId(String(item.model || ""));
          if (!item.timestamp) item.timestamp = new Date().toISOString();
          if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);
          if (item.requestHeaders) item.requestHeaders = sanitizeHeaders(item.requestHeaders);
          if (item.responseHeaders) item.responseHeaders = sanitizeHeaders(item.responseHeaders);
          const record = {
            id: item.id,
            provider: item.provider || null,
            model: item.model || null,
            connectionId: item.connectionId || null,
            timestamp: item.timestamp,
            status: item.status || null,
            latency: item.latency || {},
            tokens: item.tokens || {},
            request: truncateField(item.request, config.maxJsonSize),
            requestHeaders: item.requestHeaders || {},
            providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
            providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
            response: truncateField(item.response, config.maxJsonSize),
            responseHeaders: item.responseHeaders || null,
            pxpipe: item.pxpipe || undefined,
            clientIp: item.clientIp || undefined,
            comboName: item.comboName || undefined,
            hasTokenUsage: item.hasTokenUsage === true,
          };
          const data = JSON.stringify(record);
          if (insert.run(record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, data).changes > 0) count += 1;
          else update.run(record.timestamp, record.provider, record.model, record.connectionId, record.status, data, record.id);
        }
        if (count > config.maxRecords) {
          count -= runtime.sqlite.query(`DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`).run(count - config.maxRecords).changes;
        }
        rowCounts.set(runtime, count);
      })();
    }
  } catch {
    // Recount on the next flush: a failed transaction leaves the count unknown.
    rowCounts.delete(runtime);
    // v1 logs and drops the batch; observability must never break requests.
  } finally {
    flushing.delete(runtime);
  }
}

export function saveRequestDetail(runtime: Runtime, detail: Record<string, any>): void {
  const config = observabilityConfig(runtime);
  if (!config.enabled) return;
  const writeBuffer = bufferOf(runtime);
  writeBuffer.push(detail);
  if (writeBuffer.length >= config.batchSize) {
    const timer = flushTimers.get(runtime);
    if (timer) {
      clearTimeout(timer);
      flushTimers.delete(runtime);
    }
    flushToDatabase(runtime);
  } else if (!flushTimers.has(runtime)) {
    flushTimers.set(runtime, setTimeout(() => {
      flushTimers.delete(runtime);
      flushToDatabase(runtime);
    }, config.flushIntervalMs));
  }
}

export function flushRequestDetails(runtime: Runtime): void {
  const timer = flushTimers.get(runtime);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(runtime);
  }
  flushToDatabase(runtime);
}

// — Ports of open-sse/handlers/chatCore/requestDetail.js builders —

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls",
];

export function extractRequestConfig(body: Record<string, any>, stream: boolean): Record<string, any> {
  // Deep-copy the request body so the detail is a point-in-time snapshot.
  // Without this, the messages array is a live reference to input.body.messages;
  // if a translator/mutator or the stream pipeline modifies that array later
  // (before saveRequestDetail flushes to SQLite), the stored detail would
  // reflect the mutated state instead of what the client actually sent.
  const config: Record<string, any> = {
    messages: Array.isArray(body.messages) ? JSON.parse(JSON.stringify(body.messages)) : [],
    model: body.model,
    stream,
  };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = JSON.parse(JSON.stringify(body[param]));
  }
  return config;
}

function hasTokenUsage(tokens: Record<string, any> | null | undefined): boolean {
  if (!tokens || typeof tokens !== "object") return false;
  return [
    tokens.input_tokens,
    tokens.prompt_tokens,
    tokens.output_tokens,
    tokens.completion_tokens,
    tokens.cached_tokens,
    tokens.cache_read_input_tokens,
    tokens.cache_creation_input_tokens,
  ].some((value) => Number(value) > 0);
}

// Output-token throughput.
// Uses the streaming window (total minus ttft) when the stream phase is meaningful.
// Falls back to end-to-end throughput when that window collapses to timer noise.
// Such noise arises in reasoning-model bursts and non-streaming bodies.
// Returns 0 for no tokens or nonsensical measurements.
export function computeTokensPerSecond(outTokens: number, totalMs: number, ttftMs: number = 0): number {
  const total = Math.max(0, Number(totalMs) || 0);
  const ttft = Math.max(0, Number(ttftMs) || 0);
  const tokens = Math.max(0, Number(outTokens) || 0);
  if (tokens <= 0 || total <= 0 || ttft > total) return 0;
  const generationMs = total - ttft;
  const windowMs = generationMs < total * 0.1 ? total : generationMs;
  return Math.round((tokens / (windowMs / 1000)) * 100) / 100;
}

export function buildRequestDetail(base: Record<string, any>, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    requestHeaders: base.requestHeaders || {},
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    responseHeaders: base.responseHeaders || null,
    pxpipe: base.pxpipe || undefined,
    clientIp: base.clientIp || undefined,
    comboName: base.comboName || undefined,
    hasTokenUsage: base.hasTokenUsage ?? hasTokenUsage(base.tokens),
    status: base.status || "success",
    ...overrides,
  };
}
