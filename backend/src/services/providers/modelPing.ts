import type { Runtime } from "../../runtime";
import { handleMediaStt } from "../media/stt";
import { handleMediaEmbeddings } from "../media/embeddings";
import { handleMediaImages } from "../media/images";
import { dispatchChat } from "../chat/chat";

export interface ModelPingResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
  status: number;
}

// v1 probes STT models with a 250ms silent WAV so the transcription pipeline
// runs end to end without recording real audio.
function createSilentWav(): Blob {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const durationMs = 250;
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  return new Blob([buffer], { type: "audio/wav" });
}

async function readJson(response: Response): Promise<{ parsed: Record<string, unknown> | null; rawText: string }> {
  const rawText = await response.text().catch(() => "");
  if (!rawText) return { parsed: null, rawText };
  try { return { parsed: JSON.parse(rawText) as Record<string, unknown>, rawText }; } catch { return { parsed: null, rawText }; }
}

function httpError(status: number, detail: unknown): string {
  const text = detail === undefined || detail === null || detail === "" ? "" : String(detail).slice(0, 240);
  return `HTTP ${status}${text ? `: ${text}` : ""}`;
}

function errorObject(parsed: Record<string, unknown> | null): unknown {
  return parsed?.error;
}

// v1 detail order: error.message -> msg -> message -> error -> raw body.
function standardDetail(parsed: Record<string, unknown> | null, rawText: string): unknown {
  const error = errorObject(parsed) as Record<string, unknown> | string | undefined;
  const message = error && typeof error === "object" ? error.message : undefined;
  return message || parsed?.msg || parsed?.message || error || rawText;
}

// v1 embeddings detail order: error.message -> error -> raw body.
function embeddingDetail(parsed: Record<string, unknown> | null, rawText: string): unknown {
  const error = errorObject(parsed) as Record<string, unknown> | string | undefined;
  const message = error && typeof error === "object" ? error.message : undefined;
  return message || error || rawText;
}

export async function pingModelByKind(runtime: Runtime, model: string, kind: string): Promise<ModelPingResult> {
  // Probe the upstream connection directly, bypassing the API-key model-access
  // gate. The test answers "is this provider connection able to serve this
  // model?" — a question about the upstream, not about client-key permissions.
  // Passing null makes enforceApiKeyAccess a no-op (it returns null when no
  // apiKey is provided), so the request reaches the provider unblocked.
  const apiKey = null;
  const start = Date.now();
  const send = async (endpoint: string, body: Record<string, unknown>) => {
    const dispatched = await dispatchChat(runtime, {
      body,
      source: "openai",
      endpoint,
      pathname: endpoint,
      apiKey,
      headers: {} as Record<string, any>,
      userAgent: "lobakai-model-test",
    });
    return dispatched || runtime.gateway.chat({ body, source: "openai", endpoint, apiKey });
  };

  if (kind === "embedding") {
    const response = await handleMediaEmbeddings(runtime, { body: { model, input: "test" }, apiKey });
    const latencyMs = Date.now() - start;
    const { parsed, rawText } = await readJson(response);
    if (!response.ok) return { ok: false, latencyMs, error: httpError(response.status, embeddingDetail(parsed, rawText)), status: response.status };
    const data = Array.isArray(parsed?.data) ? (parsed?.data as Array<Record<string, unknown>>) : [];
    const hasEmbedding = data.length > 0 && Array.isArray(data[0]?.embedding);
    if (!hasEmbedding) return { ok: false, latencyMs, status: response.status, error: "Provider returned no embedding data" };
    return { ok: true, latencyMs, error: null, status: response.status };
  }

  if (kind === "image") {
    const response = await handleMediaImages(runtime, { body: { model, prompt: "test" }, binaryOutput: false, stream: false, apiKey });
    const latencyMs = Date.now() - start;
    const { parsed, rawText } = await readJson(response);
    if (!response.ok) return { ok: false, latencyMs, error: httpError(response.status, standardDetail(parsed, rawText)), status: response.status };
    const hasImages = Array.isArray(parsed?.data) && (parsed?.data as unknown[]).length > 0;
    if (!hasImages) return { ok: false, latencyMs, status: response.status, error: "Provider returned no image data for this model" };
    return { ok: true, latencyMs, error: null, status: response.status };
  }

  if (kind === "stt") {
    // Probe with the real multipart transcription pipeline.
    const form = new FormData();
    form.append("file", createSilentWav(), "test.wav");
    form.append("model", model);
    const response = await handleMediaStt(runtime, { formData: form, apiKey });
    const latencyMs = Date.now() - start;
    const { parsed, rawText } = await readJson(response);
    if (!response.ok) return { ok: false, latencyMs, error: httpError(response.status, standardDetail(parsed, rawText)), status: response.status };
    const text = typeof parsed?.text === "string" ? parsed.text : "";
    if (!text.trim()) return { ok: false, latencyMs, status: response.status, error: "Provider returned no transcription text for this model" };
    return { ok: true, latencyMs, error: null, status: response.status };
  }

  const response = await send("/v1/chat/completions", {
    model,
    // A 1-token probe yields false negatives on providers whose per-request
    // budget is spent before the first content token emits.
    max_tokens: 16,
    stream: false,
    messages: [{ role: "user", content: "hi" }],
  });
  const latencyMs = Date.now() - start;
  const { parsed, rawText } = await readJson(response);

  if (!response.ok) return { ok: false, latencyMs, error: httpError(response.status, standardDetail(parsed, rawText)), status: response.status };

  const providerStatus = parsed?.status;
  const providerMsg = parsed?.msg || parsed?.message;
  const hasProviderErrorStatus = providerStatus !== undefined
    && providerStatus !== null
    && String(providerStatus) !== "200"
    && String(providerStatus) !== "0";
  if (hasProviderErrorStatus && providerMsg) {
    return { ok: false, latencyMs, status: response.status, error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}` };
  }

  if (parsed?.error) {
    const error = errorObject(parsed) as Record<string, unknown> | string | undefined;
    const providerError = (error && typeof error === "object" ? error.message : error) || "Provider returned an error";
    return { ok: false, latencyMs, status: response.status, error: String(providerError).slice(0, 240) };
  }

  const hasChoices = Array.isArray(parsed?.choices) && (parsed?.choices as unknown[]).length > 0;
  if (!hasChoices) return { ok: false, latencyMs, status: response.status, error: "Provider returned no completion choices for this model" };
  return { ok: true, latencyMs, error: null, status: response.status };
}
